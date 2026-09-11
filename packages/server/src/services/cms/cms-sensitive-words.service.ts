import { requireRow } from '../../lib/db-assert';
import type { QueryOutputOf } from '@zenith/shared/core';
import { buildListResult } from '../../lib/list-query';
import { eq, asc, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { cmsSensitiveWordContract } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsSensitiveWords } from '../../db/schema';
import type { CmsSensitiveWordRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { AhoCorasick, applyReplacements, createTtlCache, toCodePoints, type AcMatch } from '../../lib/aho-corasick';
import { invalidateWordCheckCache } from './cms-word-check.service';
import type { CreateCmsSensitiveWordInput, UpdateCmsSensitiveWordInput } from '@zenith/shared/cms';

// ─── 内存缓存 + Aho-Corasick 自动机 ────────────────────────────────────────────
const CACHE_TTL_MS = 60_000;

const automatonCache = createTtlCache(async () => {
  const words = await db.select().from(cmsSensitiveWords).where(eq(cmsSensitiveWords.status, 'enabled'));
  return new AhoCorasick(words.map((w) => ({ word: w.word, payload: w })));
}, CACHE_TTL_MS);

function invalidateSensitiveWordCache() {
  automatonCache.invalidate();
  invalidateWordCheckCache();
}

/**
 * 敏感词过滤（Aho-Corasick 多模式匹配，O(文本长度)）：
 * 拦截词（replaceWith 为空）命中直接抛 400；替换词命中则替换为指定文本。
 */
export async function sanitizeUserText(text: string): Promise<string> {
  const automaton = await automatonCache.get();
  if (automaton.isEmpty) return text;
  // 单次扫描收集所有命中区间；拦截词命中立即抛出，不再继续扫描
  const matches: AcMatch<CmsSensitiveWordRow>[] = [];
  const chars = toCodePoints(text);
  automaton.scan(chars, (w, endIndex) => {
    if (w.replaceWith == null || w.replaceWith === '') {
      throw new HTTPException(400, { message: '内容包含敏感词，提交被拒绝' });
    }
    matches.push({ start: endIndex - toCodePoints(w.word).length + 1, end: endIndex + 1, payload: w });
  });
  if (matches.length === 0) return text;
  return applyReplacements(chars, matches, (w) => w.replaceWith ?? '');
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
  return requireRow(row, '敏感词不存在');
}

export async function listCmsSensitiveWords(q: QueryOutputOf<typeof cmsSensitiveWordContract.list>) {
  const conditions: (SQL | undefined)[] = [];
  conditions.push(keywordCondition(q.keyword, [cmsSensitiveWords.word]));
  if (q.status) conditions.push(eq(cmsSensitiveWords.status, q.status));
  const where = buildWhere(...conditions);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(cmsSensitiveWords, where),
    rows: () => withPagination(
      db.select().from(cmsSensitiveWords).where(where).orderBy(asc(cmsSensitiveWords.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
    map: mapCmsSensitiveWord,
  });
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
    requireRow(row, '敏感词不存在');
    invalidateSensitiveWordCache();
    return mapCmsSensitiveWord(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该敏感词已存在');
  }
}

export async function deleteCmsSensitiveWord(id: number) {
  const [row] = await db.delete(cmsSensitiveWords).where(eq(cmsSensitiveWords.id, id)).returning();
  requireRow(row, '敏感词不存在');
  invalidateSensitiveWordCache();
}
