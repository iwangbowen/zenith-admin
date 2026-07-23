export async function* streamByDescendingId<T extends { id: number }>(
  loadPage: (beforeId: number | null, limit: number) => Promise<T[]>,
  batchSize = 1000,
): AsyncGenerator<T> {
  const size = Math.min(Math.max(batchSize, 1), 5000);
  let beforeId: number | null = null;
  for (;;) {
    const rows = await loadPage(beforeId, size);
    if (rows.length === 0) return;
    for (const row of rows) yield row;
    const next = rows.at(-1)!.id;
    if (beforeId !== null && next >= beforeId) {
      throw new Error('导出游标未向前推进');
    }
    beforeId = next;
    if (rows.length < size) return;
  }
}
