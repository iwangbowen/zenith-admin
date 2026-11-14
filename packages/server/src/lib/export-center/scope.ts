import { HTTPException } from 'hono/http-exception';

/** Select only from the already authorized source; never publish a partial selection. */
export async function* selectExportRows(
  rows: Iterable<Record<string, unknown>> | AsyncIterable<Record<string, unknown>>,
  rowIds: Array<string | number> | null,
  checkpoint?: () => Promise<void>,
) {
  const remaining = rowIds ? new Set(rowIds.map(String)) : null;
  let scanned = 0;
  for await (const row of rows) {
    if (++scanned % 250 === 0) await checkpoint?.();
    if (!remaining || remaining.delete(String(row.id))) yield row;
    if (remaining?.size === 0) break;
  }
  if (remaining?.size) throw new HTTPException(400, { message: '所选记录已变更、被筛选排除或不再可访问，请刷新列表后重新导出' });
}
