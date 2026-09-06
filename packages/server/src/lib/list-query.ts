import type { PaginatedResponse } from '@zenith/shared/core';

export interface ListPageInput<Row, Item = Row> {
  page: number;
  pageSize: number;
  /** 总数查询：`() => db.$count(table, where)` 或自定义聚合 count */
  count: () => Promise<number>;
  /** 当前页行查询：自带 where / orderBy / `withPagination` 或 `pageOffset` */
  rows: () => Promise<Row[]>;
  /** 行 → 契约实体；可为异步（需要补充关联数据时） */
  map?: (row: Row) => Item | Promise<Item>;
}

/**
 * 分页列表结果编排：count 与 rows 并行发出，映射后套上 `{ list, total, page, pageSize }` 包络。
 * 只负责编排，不改动任何 SQL——条件、排序、投影仍由调用方在 `count` / `rows` 里显式书写。
 *
 * @example
 * return buildListResult({
 *   page, pageSize,
 *   count: () => db.$count(tags, where),
 *   rows: () => withPagination(db.select().from(tags).where(where).orderBy(desc(tags.id)).$dynamic(), page, pageSize),
 *   map: mapTag,
 * });
 */
export async function buildListResult<Row, Item = Row>({ page, pageSize, count, rows, map }: ListPageInput<Row, Item>): Promise<PaginatedResponse<Item>> {
  const [total, rawRows] = await Promise.all([count(), rows()]);
  const list = map ? await Promise.all(rawRows.map((row) => map(row))) : (rawRows as unknown as Item[]);
  return { list, total, page, pageSize };
}
