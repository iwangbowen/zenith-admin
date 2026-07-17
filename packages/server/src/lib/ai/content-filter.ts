import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { dicts, dictItems } from '../../db/schema';
import { getConfigBoolean } from '../system-config';
import logger from '../logger';

let cache: { words: string[]; loadedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 1000;

/** 加载启用的敏感词（字典 code: ai_sensitive_word，value 即敏感词），60s 内存缓存 */
async function loadSensitiveWords(): Promise<string[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.words;
  try {
    const rows = await db
      .select({ value: dictItems.value })
      .from(dictItems)
      .innerJoin(dicts, eq(dictItems.dictId, dicts.id))
      .where(and(eq(dicts.code, 'ai_sensitive_word'), eq(dictItems.status, 'enabled')));
    const words = rows.map((r) => r.value.trim()).filter((w) => w.length > 0);
    cache = { words, loadedAt: Date.now() };
    return words;
  } catch (err) {
    logger.warn('[ai-content-filter] load sensitive words failed', err);
    return cache?.words ?? [];
  }
}

/**
 * 输入侧敏感词检查：开关开启且命中词库时返回命中的词，否则返回 null。
 */
export async function checkSensitiveContent(text: string): Promise<string | null> {
  const enabled = await getConfigBoolean('ai_content_filter_enabled', false);
  if (!enabled || !text) return null;
  const words = await loadSensitiveWords();
  for (const w of words) {
    if (text.includes(w)) return w;
  }
  return null;
}
