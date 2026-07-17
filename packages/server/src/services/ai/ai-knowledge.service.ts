import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { aiKnowledgeBases, aiKbDocuments, aiKbChunks, aiConversations } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { estimateTokens } from '../../lib/ai/tokens';
import { getConfigValue } from '../../lib/system-config';
import { getRawDefaultProviderConfig } from './ai-providers.service';
import { httpRequest } from '../../lib/http-client';
import { HTTPException } from 'hono/http-exception';
import logger from '../../lib/logger';
import type { CreateAiKnowledgeBaseInput, UpdateAiKnowledgeBaseInput, AddAiKbDocumentInput } from '@zenith/shared';

/** 分块目标大小（估算 token） */
const CHUNK_TOKENS = 500;
/** 单知识库分块上限（JS 余弦检索的规模保护） */
const MAX_CHUNKS_PER_KB = 5000;

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

/** 添加文档：分块 → （可选）向量化 → 入库 */
export async function addKbDocument(kbId: number, input: AddAiKbDocumentInput) {
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
    .values({ kbId, name: input.name, status: 'processing', charCount: input.content.length })
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

/**
 * 知识库检索：优先向量余弦（query embedding 可用且分块有向量），否则关键词匹配兜底。
 * 返回 top N 分块（附相似度分数）。
 */
export async function retrieveKbContext(kbId: number, ownerId: number, query: string, topN = 4): Promise<KbRetrievedChunk[]> {
  const [kb] = await db.select().from(aiKnowledgeBases).where(eq(aiKnowledgeBases.id, kbId));
  if (!kb || kb.userId !== ownerId) return [];

  const chunks = await db
    .select({
      content: aiKbChunks.content,
      embedding: aiKbChunks.embedding,
      docId: aiKbChunks.docId,
    })
    .from(aiKbChunks)
    .where(eq(aiKbChunks.kbId, kbId))
    .limit(MAX_CHUNKS_PER_KB);
  if (chunks.length === 0) return [];

  const docIds = [...new Set(chunks.map((c) => c.docId))];
  const docs = await db.select({ id: aiKbDocuments.id, name: aiKbDocuments.name }).from(aiKbDocuments).where(inArray(aiKbDocuments.id, docIds));
  const docNameMap = new Map(docs.map((d) => [d.id, d.name]));

  // 向量检索
  const withEmbedding = chunks.filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0);
  if (withEmbedding.length > 0) {
    const queryEmbedding = await embedTexts([query]);
    if (queryEmbedding?.[0]) {
      return withEmbedding
        .map((c) => ({
          docName: docNameMap.get(c.docId) ?? '未知文档',
          content: c.content,
          score: Math.round(cosineSimilarity(queryEmbedding[0], c.embedding!) * 1000) / 1000,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topN)
        .filter((c) => c.score > 0.3);
    }
  }

  // 关键词兜底：按查询词命中数排序
  const terms = query.toLowerCase().split(/[\s,，。？?!！、]+/).filter((t) => t.length >= 2).slice(0, 10);
  if (terms.length === 0) return [];
  return chunks
    .map((c) => {
      const lower = c.content.toLowerCase();
      const hits = terms.reduce((acc, t) => acc + (lower.includes(t) ? 1 : 0), 0);
      return {
        docName: docNameMap.get(c.docId) ?? '未知文档',
        content: c.content,
        score: Math.round((hits / terms.length) * 1000) / 1000,
      };
    })
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
