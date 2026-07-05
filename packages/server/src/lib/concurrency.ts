/**
 * 并发受限映射：最多 concurrency 个并发执行 mapper，保持结果与输入顺序一致。
 * 用于仪表盘批量取数等「一次请求扇出 N 个子查询」的场景，防止大盘一次性打爆连接池/外部数据源。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
