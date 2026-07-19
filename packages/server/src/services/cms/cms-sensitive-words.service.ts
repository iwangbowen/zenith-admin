import { eq, asc, and, like, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsSensitiveWords } from '../../db/schema';
import type { CmsSensitiveWordRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CreateCmsSensitiveWordInput, UpdateCmsSensitiveWordInput } from '@zenith/shared';

// ─── 内存缓存 ─────────────────────────────────────────────────────────────────
let cache: { words: CmsSensitiveWordRow[]; loadedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

function invalidateSensitiveWordCache() {
  cache = null;
}

async function getEnabledWords(): Promise<CmsSensitiveWordRow[]> {
  if (!cache || Date.now() - cache.loadedAt >= CACHE_TTL_MS) {
    const words = await db.select().from(cmsSensitiveWords).where(eq(cmsSensitiveWords.status, 'enabled'));
    cache = { words, loadedAt: Date.now() };
  }
  return cache.words;
}

/**
 * 敏感词过滤：拦截词（replaceWith 为空）命中直接抛 400；
 * 替换词命中则替换为指定文本，返回净化后的文本。
 */
export async function sanitizeUserText(text: string): Promise<string> {
  const words = await getEnabledWords();
  let out = text;
  for (const w of words) {
    if (!out.includes(w.word)) continue;
    if (w.replaceWith == null || w.replaceWith === '') {
      throw new HTTPException(400, { message: '内容包含敏感词，提交被拒绝' });
    }
    out = out.replaceAll(w.word, w.replaceWith);
  }
  return out;
}

// ─── 数据映射 / CRUD ──────────────────────────────────────────────────────────
export function mapCmsSensitiveWord(row: CmsSensitiveWordRow) {
  return {
    id: row.id,
    word: row.word,
    replaceWith: row.replaceWith ?? null,
    status: row.status,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureCmsSensitiveWordExists(id: number): Promise<CmsSensitiveWordRow> {
  const [row] = await db.select().from(cmsSensitiveWords).where(eq(cmsSensitiveWords.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '敏感词不存在' });
  return row;
}

export interface ListCmsSensitiveWordsQuery {
  keyword?: string;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listCmsSensitiveWords(q: ListCmsSensitiveWordsQuery) {
  const conditions: SQL[] = [];
  if (q.keyword) conditions.push(like(cmsSensitiveWords.word, `%${escapeLike(q.keyword)}%`));
  if (q.status) conditions.push(eq(cmsSensitiveWords.status, q.status));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(cmsSensitiveWords, where),
    withPagination(
      db.select().from(cmsSensitiveWords).where(where).orderBy(asc(cmsSensitiveWords.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
  ]);
  return { list: list.map(mapCmsSensitiveWord), total, page: q.page, pageSize: q.pageSize };
}

export async function createCmsSensitiveWord(data: CreateCmsSensitiveWordInput) {
  try {
    const [row] = await db.insert(cmsSensitiveWords).values(data).returning();
    invalidateSensitiveWordCache();
    return mapCmsSensitiveWord(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该敏感词已存在');
  }
}

export async function updateCmsSensitiveWord(id: number, data: UpdateCmsSensitiveWordInput) {
  try {
    const [row] = await db.update(cmsSensitiveWords).set(data).where(eq(cmsSensitiveWords.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '敏感词不存在' });
    invalidateSensitiveWordCache();
    return mapCmsSensitiveWord(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该敏感词已存在');
  }
}

export async function deleteCmsSensitiveWord(id: number) {
  const [row] = await db.delete(cmsSensitiveWords).where(eq(cmsSensitiveWords.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '敏感词不存在' });
  invalidateSensitiveWordCache();
}
