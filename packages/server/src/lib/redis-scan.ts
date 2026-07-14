import redis from './redis';

/** 使用 SCAN 遍历匹配 key（生产安全，替代 KEYS）*/
export async function scanKeys(pattern: string, count = 100): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', count);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}
