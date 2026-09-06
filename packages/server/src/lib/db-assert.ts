import { HTTPException } from 'hono/http-exception';

type AssertStatus = 400 | 403 | 404 | 409;

/**
 * 行存在性断言：查询仍由调用方书写（投影、租户 / 数据范围条件都留在调用方可见），
 * 这里只收口「取不到就抛 HTTPException」这一句。
 *
 * @example
 * const [row] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
 * return requireRow(row, '标签不存在');
 */
export function requireRow<T>(row: T | null | undefined, message: string, status: AssertStatus = 404): T {
  if (row == null) throw new HTTPException(status, { message });
  return row;
}

/**
 * `requireRow` 的查询直连形态：接收返回行数组的查询（Promise），取首行断言。
 *
 * @example
 * const tag = await requireFirstRow(db.select().from(tags).where(eq(tags.id, id)).limit(1), '标签不存在');
 */
export async function requireFirstRow<T>(rows: Promise<T[]> | T[], message: string, status: AssertStatus = 404): Promise<T> {
  const [row] = await rows;
  return requireRow(row, message, status);
}
