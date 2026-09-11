import { requireRow } from '../../lib/db-assert';
import type { QueryOutputOf } from '@zenith/shared/core';
import { buildListResult } from '../../lib/list-query';
import { eq, asc, type SQL } from 'drizzle-orm';
import { cmsErrorProneWordContract } from '@zenith/shared/cms';
import { db } from '../../db';
import { cmsErrorProneWords } from '../../db/schema';
import type { CmsErrorProneWordRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { AhoCorasick, applyReplacements, createTtlCache, toCodePoints, type AcMatch } from '../../lib/aho-corasick';
import { invalidateWordCheckCache } from './cms-word-check.service';
import type { CreateCmsErrorProneWordInput, UpdateCmsErrorProneWordInput } from '@zenith/shared/cms';

// ─── 易错词自动替换（Aho-Corasick 多模式匹配，与敏感词同构）────────────────────
const REPLACE_CACHE_TTL_MS = 60_000;

const automatonCache = createTtlCache(async () => {
  const words = await db.select().from(cmsErrorProneWords).where(eq(cmsErrorProneWords.status, 'enabled'));
  return new AhoCorasick(words.map((w) => ({ word: w.word, payload: w })));
}, REPLACE_CACHE_TTL_MS);

function invalidateErrorProneCaches(): void {
  automatonCache.invalidate();
  invalidateWordCheckCache();
}

/**
 * 易错词批量替换：命中词替换为 correction，单次扫描 O(文本长度)。
 * 与 checkCmsText（只报告）不同，本函数直接改写文本，供内容保存管线按站点开关调用。
 */
export async function replaceErrorProneWords(text: string): Promise<string> {
  if (!text) return text;
  const automaton = await automatonCache.get();
  if (automaton.isEmpty) return text;

  const matches: AcMatch<CmsErrorProneWordRow>[] = [];
  const chars = toCodePoints(text);
  automaton.scan(chars, (w, endIndex) => {
    matches.push({ start: endIndex - toCodePoints(w.word).length + 1, end: endIndex + 1, payload: w });
  });
  if (matches.length === 0) return text;

  return applyReplacements(chars, matches, (w) => w.correction);
}

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsErrorProneWord(row: CmsErrorProneWordRow) {
  return {
    id: row.id,
    word: row.word,
    correction: row.correction,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureCmsErrorProneWordExists(id: number): Promise<CmsErrorProneWordRow> {
  const [row] = await db.select().from(cmsErrorProneWords).where(eq(cmsErrorProneWords.id, id)).limit(1);
  return requireRow(row, '易错词不存在');
}

// ─── 查询 ─────────────────────────────────────────────────────────────────────
export async function listCmsErrorProneWords(q: QueryOutputOf<typeof cmsErrorProneWordContract.list>) {
  const conditions: (SQL | undefined)[] = [];
  conditions.push(keywordCondition(q.keyword, [cmsErrorProneWords.word, cmsErrorProneWords.correction]));
  if (q.status) conditions.push(eq(cmsErrorProneWords.status, q.status));
  const where = buildWhere(...conditions);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(cmsErrorProneWords, where),
    rows: () => withPagination(
      db.select().from(cmsErrorProneWords).where(where).orderBy(asc(cmsErrorProneWords.id)).$dynamic(),
      q.page,
      q.pageSize,
    ),
    map: mapCmsErrorProneWord,
  });
}

// ─── 写入 ─────────────────────────────────────────────────────────────────────
export async function createCmsErrorProneWord(data: CreateCmsErrorProneWordInput) {
  try {
    const [row] = await db.insert(cmsErrorProneWords).values(data).returning();
    invalidateErrorProneCaches();
    return mapCmsErrorProneWord(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该易错词已存在');
  }
}

export async function updateCmsErrorProneWord(id: number, data: UpdateCmsErrorProneWordInput) {
  try {
    const [row] = await db.update(cmsErrorProneWords).set(data).where(eq(cmsErrorProneWords.id, id)).returning();
    requireRow(row, '易错词不存在');
    invalidateErrorProneCaches();
    return mapCmsErrorProneWord(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该易错词已存在');
  }
}

export async function deleteCmsErrorProneWord(id: number) {
  const [row] = await db.delete(cmsErrorProneWords).where(eq(cmsErrorProneWords.id, id)).returning();
  requireRow(row, '易错词不存在');
  invalidateErrorProneCaches();
}
