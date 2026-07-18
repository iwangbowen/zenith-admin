import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { aiKnowledgeBases, aiKbDocuments, aiKbChunks, aiConversations } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { estimateTokens } from '../../lib/ai/tokens';
import { getConfigValue } from '../../lib/system-config';
import { getRawDefaultProviderConfig } from './ai-providers.service';
import { httpRequest } from '../../lib/http-client';
import { AI_SSRF_OPTIONS } from '../../lib/ai/outbound';
import { HTTPException } from 'hono/http-exception';
import logger from '../../lib/logger';
import type { CreateAiKnowledgeBaseInput, UpdateAiKnowledgeBaseInput, AddAiKbDocumentInput, ImportAiKbUrlInput } from '@zenith/shared';

/** 分块目标大小（估算 token） */
const CHUNK_TOKENS = 500;
/** 单知识库分块上限（JS 余弦检索的规模保护） */
const MAX_CHUNKS_PER_KB = 5000;
/** 混合检索权重：向量相似度 0.7 + 关键词命中 0.3 */
const HYBRID_VECTOR_WEIGHT = 0.7;
const HYBRID_KEYWORD_WEIGHT = 0.3;

// ─── pgvector 运行时探测（不可用时回退 JS 余弦） ─────────────────────────────

let pgVectorAvailable: boolean | null = null;

async function hasPgVector(): Promise<boolean> {
  if (pgVectorAvailable !== null) return pgVectorAvailable;
  try {
    const rows = await db.execute(sql`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
    const list = Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows ?? [];
    pgVectorAvailable = list.length > 0;
  } catch {
    pgVectorAvailable = false;
  }
  if (pgVectorAvailable) logger.info('[ai-kb] pgvector enabled, using SQL vector search');
  return pgVectorAvailable;
}

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
}

export async function listKbDocuments(kbId: number) {
  await ensureKbOwner(kbId);
  const rows = await db.select().from(aiKbDocuments).where(eq(aiKbDocuments.kbId, kbId)).orderBy(desc(aiKbDocuments.createdAt));
  return rows.map(mapDoc);
}

/** 按段落 + 长度分块（目标 ~CHUNK_TOKENS token，段落边界优先） */
export function chunkText(text: string): string[] {
  const paragraphs = text.replaceAll('\r\n', '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    const candidate = current ? `${current}\n\n${p}` : p;
    if (estimateTokens(candidate) > CHUNK_TOKENS && current) {
      chunks.push(current);
      current = p;
    } else {
      current = candidate;
    }
    // 单段落超长：硬切
    while (estimateTokens(current) > CHUNK_TOKENS * 2) {
      const hardLen = Math.max(200, Math.floor(current.length * (CHUNK_TOKENS / estimateTokens(current))));
      chunks.push(current.slice(0, hardLen));
      current = current.slice(hardLen);
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** 调用系统默认服务商的 /embeddings 接口批量向量化（未配置模型返回 null） */
async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const model = (await getConfigValue('ai_embedding_model', '')).trim();
  if (!model) return null;
  const cfg = await getRawDefaultProviderConfig();
  if (!cfg) return null;
  try {
    const res = await httpRequest(`${cfg.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
      timeout: 60000,
      ...AI_SSRF_OPTIONS,
    });
    if (!res.ok) {
      logger.warn('[ai-kb] embeddings API failed', { status: res.status });
      return null;
    }
    const data = await res.json<{ data?: { index: number; embedding: number[] }[] }>();
    if (!Array.isArray(data.data) || data.data.length !== texts.length) return null;
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  } catch (err) {
    logger.warn('[ai-kb] embeddings request error', err);
    return null;
  }
}

/** 添加文档：分块 → （可选）向量化 → 入库（pgvector 可用时同步物化 embedding_vec 列） */
export async function addKbDocument(kbId: number, input: AddAiKbDocumentInput, sourceUrl: string | null = null) {
  const kb = await ensureKbOwner(kbId);
  const chunks = chunkText(input.content);
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
    const embeddingModel = embeddings ? (await getConfigValue('ai_embedding_model', '')).trim() : null;
    await db.insert(aiKbChunks).values(
      chunks.map((content, i) => ({
        kbId,
        docId: doc.id,
        content,
        embedding: embeddings?.[i] ?? null,
        tokenCount: estimateTokens(content),
      })),
    );
    // pgvector：real[] 直接 cast 物化到 vector 列，检索走 SQL 余弦距离
    if (embeddings && (await hasPgVector())) {
      await db.execute(sql`UPDATE ai_kb_chunks SET embedding_vec = embedding::vector WHERE doc_id = ${doc.id} AND embedding IS NOT NULL`);
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

export async function deleteKbDocument(kbId: number, docId: number) {
  await ensureKbOwner(kbId);
  const [doc] = await db.select().from(aiKbDocuments).where(and(eq(aiKbDocuments.id, docId), eq(aiKbDocuments.kbId, kbId)));
  if (!doc) throw new HTTPException(404, { message: '文档不存在' });
  await db.delete(aiKbDocuments).where(eq(aiKbDocuments.id, docId));
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
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
 * 知识库混合检索：向量相似度（pgvector SQL 优先，JS 余弦兜底）0.7 + 关键词命中 0.3 加权；
 * 向量不可用（未配置 embedding / 模型不一致）时退化为纯关键词。返回 top N 分块（附综合分数）。
 */
export async function retrieveKbContext(kbId: number, ownerId: number, query: string, topN = 4): Promise<KbRetrievedChunk[]> {
  const [kb] = await db.select().from(aiKnowledgeBases).where(eq(aiKnowledgeBases.id, kbId));
  if (!kb || kb.userId !== ownerId) return [];

  const terms = splitTerms(query);
  const docNameOf = async (docIds: number[]) => {
    const docs = docIds.length > 0
      ? await db.select({ id: aiKbDocuments.id, name: aiKbDocuments.name }).from(aiKbDocuments).where(inArray(aiKbDocuments.id, docIds))
      : [];
    return new Map(docs.map((d) => [d.id, d.name]));
  };

  // 向量检索：仅当入库所用 embedding 模型与当前配置一致时启用，
  // 否则（管理员更换了 ai_embedding_model）向量空间不可比，直接走关键词兜底
  const currentModel = (await getConfigValue('ai_embedding_model', '')).trim();
  if (currentModel && kb.embeddingModel === currentModel) {
    const queryEmbedding = await embedTexts([query]);
    const queryVec = queryEmbedding?.[0];
    if (queryVec) {
      // 路径一：pgvector SQL 余弦（大规模高效，取候选池后做混合加权）
      if (await hasPgVector()) {
        try {
          const vecLiteral = `[${queryVec.join(',')}]`;
          const raw = await db.execute(sql`
            SELECT content, doc_id AS "docId", 1 - (embedding_vec <=> ${vecLiteral}::vector) AS score
            FROM ai_kb_chunks
            WHERE kb_id = ${kbId} AND embedding_vec IS NOT NULL
            ORDER BY embedding_vec <=> ${vecLiteral}::vector
            LIMIT ${Math.max(topN * 5, 20)}
          `);
          const rows = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as Array<{ content: string; docId: number; score: number }>;
          if (rows.length > 0) {
            const nameMap = await docNameOf([...new Set(rows.map((r) => r.docId))]);
            const scored = rows
              .map((r) => ({
                docName: nameMap.get(r.docId) ?? '未知文档',
                content: r.content,
                score: Math.round((HYBRID_VECTOR_WEIGHT * Number(r.score) + HYBRID_KEYWORD_WEIGHT * keywordScore(r.content, terms)) * 1000) / 1000,
              }))
              .sort((a, b) => b.score - a.score)
              .slice(0, topN)
              .filter((c) => c.score > 0.3);
            if (scored.length > 0) return scored;
          }
        } catch (err) {
          // 维度不一致等 pgvector 错误：回退 JS 路径
          logger.warn('[ai-kb] pgvector search failed, fallback to JS cosine', err);
        }
      }

      // 路径二：JS 余弦（全量加载，规模受 MAX_CHUNKS_PER_KB 保护）
      const chunks = await db
        .select({ content: aiKbChunks.content, embedding: aiKbChunks.embedding, docId: aiKbChunks.docId })
        .from(aiKbChunks)
        .where(eq(aiKbChunks.kbId, kbId))
        .limit(MAX_CHUNKS_PER_KB);
      const withEmbedding = chunks.filter((c) => Array.isArray(c.embedding) && c.embedding.length === queryVec.length);
      if (withEmbedding.length > 0) {
        const nameMap = await docNameOf([...new Set(withEmbedding.map((c) => c.docId))]);
        const scored = withEmbedding
          .map((c) => ({
            docName: nameMap.get(c.docId) ?? '未知文档',
            content: c.content,
            score: Math.round((HYBRID_VECTOR_WEIGHT * cosineSimilarity(queryVec, c.embedding!) + HYBRID_KEYWORD_WEIGHT * keywordScore(c.content, terms)) * 1000) / 1000,
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, topN)
          .filter((c) => c.score > 0.3);
        if (scored.length > 0) return scored;
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
  const nameMap = await docNameOf([...new Set(chunks.map((c) => c.docId))]);
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
