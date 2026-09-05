import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { aiKnowledgeBases, aiKbDocuments, aiKbChunks, aiConversations } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { estimateTokens } from '../../lib/ai/tokens';
import { getSettings } from '../../lib/settings';
import { getMastraVector, resolveEmbedderConfig } from '../../lib/mastra';
import { toMastraModel } from '../../lib/ai/mastra-models';
import { httpRequest } from '../../lib/http-client';
import { AI_SSRF_OPTIONS } from '../../lib/ai/outbound';
import { HTTPException } from 'hono/http-exception';
import logger from '../../lib/logger';
import type { CreateAiKnowledgeBaseInput, UpdateAiKnowledgeBaseInput, AddAiKbDocumentInput, ImportAiKbUrlInput } from '@zenith/shared/ai';

/** 分块目标大小（字符,recursive 策略段落边界优先） */
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 80;
/** 单知识库分块上限 */
const MAX_CHUNKS_PER_KB = 5000;
/** 混合检索权重：向量相似度 0.7 + 关键词命中 0.3 */
const HYBRID_VECTOR_WEIGHT = 0.7;
const HYBRID_KEYWORD_WEIGHT = 0.3;

/** 知识库向量索引名(每库一个,维度由首次入库的 embedding 模型决定) */
const kbIndexName = (kbId: number) => `kb_${kbId}`;

function mapKb(row: typeof aiKnowledgeBases.$inferSelect, documentCount = 0, chunkCount = 0) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    userId: row.userId,
    embeddingModel: row.embeddingModel,
    documentCount,
    chunkCount,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function mapDoc(row: typeof aiKbDocuments.$inferSelect) {
  return {
    id: row.id,
    kbId: row.kbId,
    name: row.name,
    sourceUrl: row.sourceUrl,
    status: row.status as 'ready' | 'processing' | 'failed',
    chunkCount: row.chunkCount,
    charCount: row.charCount,
    error: row.error,
    createdAt: formatDateTime(row.createdAt),
  };
}

async function ensureKbOwner(id: number) {
  const user = currentUser();
  const [row] = await db.select().from(aiKnowledgeBases).where(eq(aiKnowledgeBases.id, id));
  if (!row) throw new HTTPException(404, { message: '知识库不存在' });
  if (row.userId !== user.userId) throw new HTTPException(403, { message: '无权访问此知识库' });
  return row;
}

export async function listKnowledgeBases() {
  const user = currentUser();
  const rows = await db
    .select({
      kb: aiKnowledgeBases,
      documentCount: sql<number>`(select count(*) from ai_kb_documents d where d.kb_id = ${aiKnowledgeBases.id})::int`,
      chunkCount: sql<number>`(select count(*) from ai_kb_chunks c where c.kb_id = ${aiKnowledgeBases.id})::int`,
    })
    .from(aiKnowledgeBases)
    .where(eq(aiKnowledgeBases.userId, user.userId))
    .orderBy(desc(aiKnowledgeBases.updatedAt));
  return rows.map((r) => mapKb(r.kb, r.documentCount, r.chunkCount));
}

export async function createKnowledgeBase(input: CreateAiKnowledgeBaseInput) {
  const user = currentUser();
  const [row] = await db
    .insert(aiKnowledgeBases)
    .values({ name: input.name, description: input.description ?? null, userId: user.userId })
    .returning();
  return mapKb(row);
}

export async function updateKnowledgeBase(id: number, input: UpdateAiKnowledgeBaseInput) {
  await ensureKbOwner(id);
  const [row] = await db
    .update(aiKnowledgeBases)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
    })
    .where(eq(aiKnowledgeBases.id, id))
    .returning();
  return mapKb(row);
}

export async function deleteKnowledgeBase(id: number) {
  await ensureKbOwner(id);
  await db.delete(aiKnowledgeBases).where(eq(aiKnowledgeBases.id, id));
  // 软引用清理：解除已挂载该知识库的对话
  await db.update(aiConversations).set({ knowledgeBaseId: null }).where(eq(aiConversations.knowledgeBaseId, id));
  // 向量索引随库删除(失败仅告警)
  try {
    const vector = await getMastraVector();
    await vector.deleteIndex({ indexName: kbIndexName(id) });
  } catch (err) {
    logger.warn('[ai-kb] delete vector index failed', { kbId: id, err });
  }
}

export async function listKbDocuments(kbId: number) {
  await ensureKbOwner(kbId);
  const rows = await db.select().from(aiKbDocuments).where(eq(aiKbDocuments.kbId, kbId)).orderBy(desc(aiKbDocuments.createdAt));
  return rows.map(mapDoc);
}

/** 文档分块内容（回看原文）：按分块顺序返回 */
export async function listKbChunks(kbId: number, docId: number) {
  await ensureKbOwner(kbId);
  const [doc] = await db.select().from(aiKbDocuments)
    .where(and(eq(aiKbDocuments.id, docId), eq(aiKbDocuments.kbId, kbId)));
  if (!doc) throw new HTTPException(404, { message: '文档不存在' });
  const rows = await db.select({ id: aiKbChunks.id, content: aiKbChunks.content, tokenCount: aiKbChunks.tokenCount })
    .from(aiKbChunks)
    .where(and(eq(aiKbChunks.kbId, kbId), eq(aiKbChunks.docId, docId)))
    .orderBy(aiKbChunks.id);
  return rows;
}

/** 分块(@mastra/rag MDocument recursive 策略:段落/句子边界优先,超长硬切) */
export async function chunkText(text: string): Promise<string[]> {
  const { MDocument } = await import('@mastra/rag');
  const doc = MDocument.fromText(text);
  const chunks = await doc.chunk({ strategy: 'recursive', maxSize: CHUNK_SIZE, overlap: CHUNK_OVERLAP });
  return chunks.map((c) => c.text.trim()).filter(Boolean);
}

/** 批量向量化(Mastra 模型路由,支持任意目录服务商与 custom 端点;未配置返回 null) */
async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const embedder = await resolveEmbedderConfig();
  if (!embedder) return null;
  try {
    const { ModelRouterEmbeddingModel } = await import('@mastra/core/llm');
    const model = new ModelRouterEmbeddingModel(toMastraModel(embedder.source, embedder.model));
    const out: number[][] = [];
    const BATCH = 32;
    for (let i = 0; i < texts.length; i += BATCH) {
      const { embeddings } = await model.doEmbed({ values: texts.slice(i, i + BATCH) });
      out.push(...embeddings);
    }
    return out.length === texts.length ? out : null;
  } catch (err) {
    logger.warn('[ai-kb] embeddings request error', err);
    return null;
  }
}

/** 添加文档（校验当前用户为知识库属主）：分块 → （可选）向量化 → 入库 */
export async function addKbDocument(kbId: number, input: AddAiKbDocumentInput, sourceUrl: string | null = null) {
  await ensureKbOwner(kbId);
  return ingestKbDocument(kbId, input, sourceUrl);
}

/**
 * 低层入库（不做属主校验）：供本域 addKbDocument 与知识中心（Wiki）发布同步复用。
 * 分块 → （可选）向量化 → 入库（分块文本进 ai_kb_chunks，向量进 Mastra PgVector 索引 kb_{kbId}）。
 */
export async function ingestKbDocument(kbId: number, input: { name: string; content: string }, sourceUrl: string | null = null) {
  const kb = await db.query.aiKnowledgeBases.findFirst({ where: eq(aiKnowledgeBases.id, kbId) });
  if (!kb) throw new HTTPException(404, { message: '知识库不存在' });
  const chunks = await chunkText(input.content);
  if (chunks.length === 0) throw new HTTPException(400, { message: '内容为空，无法入库' });

  const [existingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiKbChunks)
    .where(eq(aiKbChunks.kbId, kbId));
  if ((existingCount?.count ?? 0) + chunks.length > MAX_CHUNKS_PER_KB) {
    throw new HTTPException(400, { message: `知识库分块数超出上限（${MAX_CHUNKS_PER_KB}），请拆分知识库` });
  }

  const [doc] = await db
    .insert(aiKbDocuments)
    .values({ kbId, name: input.name, status: 'processing', charCount: input.content.length, sourceUrl })
    .returning();

  try {
    const embeddings = await embedTexts(chunks);
    const embeddingModel = embeddings ? (await getSettings('ai')).embeddingModel : null;
    // 账本只存文本(关键词兜底检索 + UI 计数);向量归 Mastra PgVector
    const inserted = await db.insert(aiKbChunks).values(
      chunks.map((content) => ({
        kbId,
        docId: doc.id,
        content,
        tokenCount: estimateTokens(content),
      })),
    ).returning({ id: aiKbChunks.id });

    if (embeddings && embeddings.length > 0) {
      const vector = await getMastraVector();
      const indexName = kbIndexName(kbId);
      // 幂等建索引:已存在同维度时为 no-op;维度不一致(更换 embedding 模型)会抛错走 failed
      await vector.createIndex({ indexName, dimension: embeddings[0].length });
      await vector.upsert({
        indexName,
        vectors: embeddings,
        ids: inserted.map((r) => `chunk-${r.id}`),
        metadata: chunks.map((content, i) => ({
          kbId,
          docId: doc.id,
          chunkId: inserted[i].id,
          docName: input.name,
          content,
        })),
      });
    }
    await db.update(aiKbDocuments)
      .set({ status: 'ready', chunkCount: chunks.length })
      .where(eq(aiKbDocuments.id, doc.id));
    if (embeddingModel && kb.embeddingModel !== embeddingModel) {
      await db.update(aiKnowledgeBases).set({ embeddingModel }).where(eq(aiKnowledgeBases.id, kbId));
    }
    return mapDoc({ ...doc, status: 'ready', chunkCount: chunks.length });
  } catch (err) {
    await db.update(aiKbDocuments)
      .set({ status: 'failed', error: err instanceof Error ? err.message.slice(0, 500) : '处理失败' })
      .where(eq(aiKbDocuments.id, doc.id));
    throw err;
  }
}

// ─── URL 网页抓取入库 ─────────────────────────────────────────────────────────

/** 抓取内容大小上限（字节） */
const URL_FETCH_MAX_BYTES = 2 * 1024 * 1024;

/** 极简 HTML → 纯文本（去 script/style、块级标签转换行、实体解码） */
function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 200) : '';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return { title, text };
}

/** 从 URL 抓取网页正文入库（SSRF 防护出站；仅 text/html 与 text/*） */
export async function importKbUrl(kbId: number, input: ImportAiKbUrlInput) {
  await ensureKbOwner(kbId);
  let res;
  try {
    res = await httpRequest(input.url, { method: 'GET', timeout: 20_000, ...AI_SSRF_OPTIONS });
  } catch (err) {
    throw new HTTPException(400, { message: `网页抓取失败：${err instanceof Error ? err.message : '连接错误'}` });
  }
  if (!res.ok) throw new HTTPException(400, { message: `网页抓取失败：HTTP ${res.status}` });
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType && !contentType.includes('text/') && !contentType.includes('html')) {
    throw new HTTPException(400, { message: `不支持的内容类型：${contentType.split(';')[0]}（仅支持网页/文本）` });
  }
  const raw = (await res.text()).slice(0, URL_FETCH_MAX_BYTES);
  const isHtml = contentType.includes('html') || /<html[\s>]/i.test(raw.slice(0, 2000));
  const { title, text } = isHtml ? htmlToText(raw) : { title: '', text: raw };
  if (!text.trim()) throw new HTTPException(400, { message: '未能从该网页提取到正文内容' });
  const name = (input.name?.trim() || title || new URL(input.url).hostname).slice(0, 200);
  return addKbDocument(kbId, { name, content: text.slice(0, 500_000) }, input.url);
}

/** 删除文档对应的向量(低频操作,分批逐个删除;失败仅告警) */
async function deleteDocVectors(kbId: number, docIds: number[]): Promise<void> {
  if (docIds.length === 0) return;
  try {
    const chunkRows = await db
      .select({ id: aiKbChunks.id })
      .from(aiKbChunks)
      .where(and(eq(aiKbChunks.kbId, kbId), inArray(aiKbChunks.docId, docIds)));
    if (chunkRows.length === 0) return;
    const vector = await getMastraVector();
    const indexName = kbIndexName(kbId);
    const BATCH = 50;
    for (let i = 0; i < chunkRows.length; i += BATCH) {
      await Promise.all(chunkRows.slice(i, i + BATCH).map((r) =>
        vector.deleteVector({ indexName, id: `chunk-${r.id}` }).catch(() => {}),
      ));
    }
  } catch (err) {
    logger.warn('[ai-kb] delete doc vectors failed', { kbId, docIds, err });
  }
}

export async function deleteKbDocument(kbId: number, docId: number) {
  await ensureKbOwner(kbId);
  const [doc] = await db.select().from(aiKbDocuments).where(and(eq(aiKbDocuments.id, docId), eq(aiKbDocuments.kbId, kbId)));
  if (!doc) throw new HTTPException(404, { message: '文档不存在' });
  await deleteDocVectors(kbId, [docId]);
  await db.delete(aiKbDocuments).where(eq(aiKbDocuments.id, docId));
}

/** 按来源标识移除文档（不做属主校验）：供知识中心（Wiki）同步取消/更新时清理旧副本 */
export async function removeKbDocumentsBySource(kbId: number, sourceUrl: string) {
  const docs = await db
    .select({ id: aiKbDocuments.id })
    .from(aiKbDocuments)
    .where(and(eq(aiKbDocuments.kbId, kbId), eq(aiKbDocuments.sourceUrl, sourceUrl)));
  await deleteDocVectors(kbId, docs.map((d) => d.id));
  await db.delete(aiKbDocuments).where(and(eq(aiKbDocuments.kbId, kbId), eq(aiKbDocuments.sourceUrl, sourceUrl)));
}

export interface KbRetrievedChunk {
  docName: string;
  content: string;
  score: number;
}

/** 关键词命中率评分（0-1） */
function keywordScore(content: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const lower = content.toLowerCase();
  const hits = terms.reduce((acc, t) => acc + (lower.includes(t) ? 1 : 0), 0);
  return hits / terms.length;
}

function splitTerms(query: string): string[] {
  return query.toLowerCase().split(/[\s,，。？?!！、]+/).filter((t) => t.length >= 2).slice(0, 10);
}

/**
 * 知识库混合检索：Mastra PgVector 相似度 0.7 + 关键词命中 0.3 加权；
 * 向量不可用（未配置 embedding / 模型不一致 / 索引缺失）时退化为纯关键词。返回 top N 分块（附综合分数）。
 */
export async function retrieveKbContext(kbId: number, ownerId: number, query: string, topN = 4): Promise<KbRetrievedChunk[]> {
  const [kb] = await db.select().from(aiKnowledgeBases).where(eq(aiKnowledgeBases.id, kbId));
  if (!kb || kb.userId !== ownerId) return [];

  const terms = splitTerms(query);

  // 向量检索：仅当入库所用 embedding 模型与当前配置一致时启用，
  // 否则（管理员更换了 ai.embeddingModel）向量空间不可比，直接走关键词兜底
  const currentModel = (await getSettings('ai')).embeddingModel;
  if (currentModel && kb.embeddingModel === currentModel) {
    const queryEmbedding = await embedTexts([query]);
    const queryVec = queryEmbedding?.[0];
    if (queryVec) {
      try {
        const vector = await getMastraVector();
        const results = await vector.query({
          indexName: kbIndexName(kbId),
          queryVector: queryVec,
          topK: Math.max(topN * 5, 20),
        });
        if (results.length > 0) {
          const scored = results
            .map((r) => {
              const meta = (r.metadata ?? {}) as { docName?: string; content?: string };
              const content = meta.content ?? '';
              return {
                docName: meta.docName ?? '未知文档',
                content,
                score: Math.round((HYBRID_VECTOR_WEIGHT * (r.score ?? 0) + HYBRID_KEYWORD_WEIGHT * keywordScore(content, terms)) * 1000) / 1000,
              };
            })
            .filter((c) => c.content)
            .sort((a, b) => b.score - a.score)
            .slice(0, topN)
            .filter((c) => c.score > 0.3);
          if (scored.length > 0) return scored;
        }
      } catch (err) {
        // 索引缺失 / 维度不一致等:回退关键词
        logger.warn('[ai-kb] vector search failed, fallback to keyword', { kbId, err });
      }
    }
  }

  // 关键词兜底：按查询词命中率排序
  if (terms.length === 0) return [];
  const chunks = await db
    .select({ content: aiKbChunks.content, docId: aiKbChunks.docId })
    .from(aiKbChunks)
    .where(eq(aiKbChunks.kbId, kbId))
    .limit(MAX_CHUNKS_PER_KB);
  if (chunks.length === 0) return [];
  const docs = await db
    .select({ id: aiKbDocuments.id, name: aiKbDocuments.name })
    .from(aiKbDocuments)
    .where(inArray(aiKbDocuments.id, [...new Set(chunks.map((c) => c.docId))]));
  const nameMap = new Map(docs.map((d) => [d.id, d.name]));
  return chunks
    .map((c) => ({
      docName: nameMap.get(c.docId) ?? '未知文档',
      content: c.content,
      score: Math.round(keywordScore(c.content, terms) * 1000) / 1000,
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/** 设置 / 清除对话挂载的知识库（校验知识库归属） */
export async function setConversationKnowledgeBase(conversationId: number, kbId: number | null) {
  const user = currentUser();
  const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, conversationId));
  if (!conv) throw new HTTPException(404, { message: '对话不存在' });
  if (conv.userId !== user.userId) throw new HTTPException(403, { message: '无权访问此对话' });
  if (kbId !== null) await ensureKbOwner(kbId);
  await db.update(aiConversations).set({ knowledgeBaseId: kbId }).where(eq(aiConversations.id, conversationId));
  return kbId;
}
