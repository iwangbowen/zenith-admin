import { and, eq, gte, ilike, isNull, like, lte, or } from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';
import type { PgColumn, PgSelect } from 'drizzle-orm/pg-core';
import { parseDateRangeEnd, parseDateRangeStart } from './datetime';
import { pageOffset } from './pagination';

/**
 * 用户输入参与 LIKE / ILIKE 的唯一入口：单列或跨列模糊匹配。
 *
 * 关键字先 trim，再转义 `%`、`_`、`\`，为空或纯空格时返回 `undefined`（不参与 WHERE），
 * 调用方无需自行判空或转义。列参数接受裸列或任意 SQL 表达式（`COALESCE(...)`、`col::text` 等）。
 *
 * @param mode  `like` 区分大小写（PostgreSQL 默认），`ilike` 不区分，按各表语义选择。
 * @param match `contains` 生成 `%kw%`；`prefix` 生成 `kw%`（路径 / 编号前缀匹配）。
 *
 * @example
 * const where = buildWhere(
 *   keywordCondition(q.keyword, [positions.name, positions.code]),
 *   keywordCondition(q.pathPrefix, [files.objectKey], 'like', 'prefix'),
 *   q.status ? eq(positions.status, q.status) : undefined,
 * );
 */
export function keywordCondition(
  keyword: string | null | undefined,
  columns: readonly (PgColumn | SQL)[],
  mode: 'like' | 'ilike' = 'like',
  match: 'contains' | 'prefix' = 'contains',
): SQL | undefined {
  const trimmed = keyword?.trim();
  if (!trimmed || columns.length === 0) return undefined;
  const escaped = trimmed.replaceAll('\\', String.raw`\\`).replaceAll('%', String.raw`\%`).replaceAll('_', String.raw`\_`);
  const pattern = match === 'prefix' ? `${escaped}%` : `%${escaped}%`;
  const op = mode === 'ilike' ? ilike : like;
  return or(...columns.map((column) => op(column, pattern)));
}

/**
 * 时间范围条件（闭区间）。
 *
 * 末端经 `parseDateRangeEnd` 解析：传入纯日期 `2026-08-01` 时取当天 `23:59:59.999`，
 * 保证「到 8 月 1 日」包含整个 8 月 1 日。
 *
 * 返回数组便于直接展开进 `buildWhere(...)`；两端都为空时返回空数组。
 */
export function dateRangeConditions(
  column: PgColumn,
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): SQL[] {
  const conditions: SQL[] = [];
  const from = parseDateRangeStart(start);
  if (from) conditions.push(gte(column, from));
  const to = parseDateRangeEnd(end);
  if (to) conditions.push(lte(column, to));
  return conditions;
}

/**
 * 可空列与已知值的行到行等值匹配：`null` → `IS NULL`，其它 → `=`。
 *
 * 用于 parentId / appId / definitionId / createdBy 这类「与一条已知记录的归属做精确匹配」的可空外键；
 * 租户归属请用 `lib/tenant.ts` 的 `exactTenantCondition`（同一实现，语义命名不同）。
 *
 * @example
 * eq(driveNodes.spaceId, spaceId), nullableEq(driveNodes.parentId, parentId)
 */
export function nullableEq(column: SQLWrapper, value: number | string | null): SQL {
  return value === null ? isNull(column) : eq(column, value);
}

/**
 * 合并任意多个可选条件为 WHERE：过滤 `undefined`，全空返回 `undefined`（即不加 WHERE），
 * 单条件原样返回，多条件 `and(...)`。既用于条件数组，也用于追加租户 / 数据权限条件。
 *
 * @example
 * const where = buildWhere(
 *   keywordCondition(q.keyword, [tags.name, tags.description]),
 *   q.status ? eq(tags.status, q.status) : undefined,
 *   ...dateRangeConditions(tags.createdAt, q.startTime, q.endTime),
 *   tenantCondition(tags, currentUser()),
 * );
 */
export function buildWhere(...conditions: (SQL | undefined)[]): SQL | undefined {
  const kept = conditions.filter((condition): condition is SQL => condition !== undefined);
  if (kept.length === 0) return undefined;
  if (kept.length === 1) return kept[0];
  return and(...kept);
}

/**
 * 为 `.$dynamic()` 查询添加分页（LIMIT + OFFSET），参考 Drizzle 官方 Dynamic Query 文档。
 * @see https://orm.drizzle.team/docs/dynamic-query-building
 *
 * @example
 * const [total, list] = await Promise.all([
 *   db.$count(table, where),
 *   withPagination(db.select().from(table).where(where).$dynamic(), page, pageSize),
 * ]);
 */
export function withPagination<T extends PgSelect>(qb: T, page: number, pageSize: number) {
  return qb.limit(pageSize).offset(pageOffset(page, pageSize));
}
