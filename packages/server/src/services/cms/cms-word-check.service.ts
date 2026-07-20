import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { cmsSensitiveWords, cmsErrorProneWords } from '../../db/schema';
import type { CmsTextCheckResult } from '@zenith/shared';

/**
 * 内容编辑词库检查：一次扫描同时命中敏感词与易错词（Aho-Corasick 多模式匹配）。
 * 与提交拦截用的 sanitizeUserText（cms-sensitive-words.service）不同，
 * 本服务只报告命中情况（含次数），不拦截、不改写，供编辑页“内容检查”按钮使用。
 */

interface CheckWord {
  kind: 'sensitive' | 'errorProne';
  word: string;
  /** 敏感词=replaceWith（可空），易错词=correction */
  extra: string | null;
}

interface AcNode {
  children: Map<string, AcNode>;
  fail: AcNode | null;
  hits: CheckWord[];
}

function buildAutomaton(words: CheckWord[]): AcNode {
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

/** 词库变更（敏感词/易错词增删改）后调用，即时失效检查缓存 */
export function invalidateWordCheckCache(): void {
  cache = null;
}

async function getAutomaton(): Promise<AcNode> {
  if (!cache || Date.now() - cache.loadedAt >= CACHE_TTL_MS) {
    const [sensitive, errorProne] = await Promise.all([
      db.select().from(cmsSensitiveWords).where(eq(cmsSensitiveWords.status, 'enabled')),
      db.select().from(cmsErrorProneWords).where(eq(cmsErrorProneWords.status, 'enabled')),
    ]);
    const words: CheckWord[] = [
      ...sensitive.map((w) => ({ kind: 'sensitive' as const, word: w.word, extra: w.replaceWith ?? null })),
      ...errorProne.map((w) => ({ kind: 'errorProne' as const, word: w.word, extra: w.correction })),
    ];
    cache = { automaton: buildAutomaton(words), loadedAt: Date.now() };
  }
  return cache.automaton;
}

const MAX_CHECK_LENGTH = 200_000;

/** 扫描文本，返回敏感词与易错词命中清单（含命中次数），单次扫描 O(文本长度) */
export async function checkCmsText(text: string): Promise<CmsTextCheckResult> {
  const root = await getAutomaton();
  const result: CmsTextCheckResult = { sensitive: [], errorProne: [] };
  if (root.children.size === 0 || !text) return result;

  const sensitiveHits = new Map<string, { word: string; replaceWith: string | null; count: number }>();
  const errorProneHits = new Map<string, { word: string; correction: string; count: number }>();
  let node: AcNode = root;
  const chars = [...text.slice(0, MAX_CHECK_LENGTH)];
  for (const ch of chars) {
    while (node !== root && !node.children.has(ch)) node = node.fail ?? root;
    node = node.children.get(ch) ?? root;
    for (const w of node.hits) {
      if (w.kind === 'sensitive') {
        const hit = sensitiveHits.get(w.word) ?? { word: w.word, replaceWith: w.extra, count: 0 };
        hit.count += 1;
        sensitiveHits.set(w.word, hit);
      } else {
        const hit = errorProneHits.get(w.word) ?? { word: w.word, correction: w.extra ?? '', count: 0 };
        hit.count += 1;
        errorProneHits.set(w.word, hit);
      }
    }
  }
  result.sensitive = [...sensitiveHits.values()].sort((a, b) => b.count - a.count);
  result.errorProne = [...errorProneHits.values()].sort((a, b) => b.count - a.count);
  return result;
}
