import { eq, asc, and, like, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsSensitiveWords } from '../../db/schema';
import type { CmsSensitiveWordRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { invalidateWordCheckCache } from './cms-word-check.service';
import type { CreateCmsSensitiveWordInput, UpdateCmsSensitiveWordInput } from '@zenith/shared';

// ─── 内存缓存 + Aho-Corasick 自动机 ────────────────────────────────────────────
interface AcNode {
  children: Map<string, AcNode>;
  fail: AcNode | null;
  /** 命中词（在词库中的行引用），到该节点结束的所有词 */
  hits: CmsSensitiveWordRow[];
}

function buildAutomaton(words: CmsSensitiveWordRow[]): AcNode {
  const root: AcNode = { children: new Map(), fail: null, hits: [] };
  for (const w of words) {
    let node = root;
    for (const ch of w.word) {
      let next = node.children.get(ch);
      if (!next) {
        next = { children: new Map(), fail: null, hits: [] };
        node.children.set(ch, next);
      }
      node = next;
    }
    node.hits.push(w);
  }
  // BFS 构建 fail 指针
  const queue: AcNode[] = [];
  for (const child of root.children.values()) {
    child.fail = root;
    queue.push(child);
  }
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const [ch, child] of node.children) {
      let fail = node.fail;
      while (fail && !fail.children.has(ch)) fail = fail.fail;
      child.fail = fail?.children.get(ch) ?? root;
      child.hits.push(...child.fail.hits);
      queue.push(child);
    }
  }
  return root;
}

let cache: { automaton: AcNode; loadedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

function invalidateSensitiveWordCache() {
  cache = null;
  invalidateWordCheckCache();
}

async function getAutomaton(): Promise<AcNode> {
  if (!cache || Date.now() - cache.loadedAt >= CACHE_TTL_MS) {
    const words = await db.select().from(cmsSensitiveWords).where(eq(cmsSensitiveWords.status, 'enabled'));
    cache = { automaton: buildAutomaton(words), loadedAt: Date.now() };
  }
  return cache.automaton;
}

/**
 * 敏感词过滤（Aho-Corasick 多模式匹配，O(文本长度)）：
 * 拦截词（replaceWith 为空）命中直接抛 400；替换词命中则替换为指定文本。
 */
export async function sanitizeUserText(text: string): Promise<string> {
  const root = await getAutomaton();
  if (root.children.size === 0) return text;
  // 单次扫描收集所有命中区间
  const matches: { start: number; end: number; word: CmsSensitiveWordRow }[] = [];
  let node: AcNode = root;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    while (node !== root && !node.children.has(ch)) node = node.fail ?? root;
    node = node.children.get(ch) ?? root;
    for (const w of node.hits) {
      if (w.replaceWith == null || w.replaceWith === '') {
        throw new HTTPException(400, { message: '内容包含敏感词，提交被拒绝' });
      }
      matches.push({ start: i - [...w.word].length + 1, end: i + 1, word: w });
    }
  }
  if (matches.length === 0) return text;
  // 按起点排序，跳过重叠区间，从后往前替换
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const applied: typeof matches = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      applied.push(m);
      lastEnd = m.end;
    }
  }
  let out = '';
  let cursor = 0;
  for (const m of applied) {
    out += chars.slice(cursor, m.start).join('') + (m.word.replaceWith ?? '');
    cursor = m.end;
  }
  out += chars.slice(cursor).join('');
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
