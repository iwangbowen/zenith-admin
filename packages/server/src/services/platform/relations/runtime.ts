import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../../db';
import { runWithCurrentUser } from '../../../lib/context';
import logger from '../../../lib/logger';
import type { RelationAccessContext } from './types';
import { recordRelationMetric } from './metrics';

let active = 0;
/** Bounded admission without an unbounded queue; PostgreSQL cancels expensive statements. */
export async function withRelationRead<T>(operation: string, caller: Pick<RelationAccessContext, 'user'>,
  fn: (access: RelationAccessContext) => Promise<T>): Promise<T> {
  if (active >= 8) throw new HTTPException(503, { message: '关联查询繁忙，请稍后重试' });
  active++;
  const started = performance.now();
  try {
    const result = await runWithCurrentUser(caller.user, () => db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('statement_timeout', '1500', true), set_config('lock_timeout', '750', true)`);
      return fn({ user: caller.user, db: tx, deadlineAt: performance.now() + 2500 });
    }, { accessMode: 'read only' }));
    recordRelationMetric(operation, 'success', started);
    return result;
  } catch (error) {
    recordRelationMetric(operation, isStatementTimeout(error) ? 'timeout' : 'error', started);
    if (error instanceof HTTPException || isStatementTimeout(error)) throw error;
    logger.error({ err: error, operation }, '[entity-relations] query failed');
    throw new HTTPException(503, { message: '关联服务暂不可用' });
  } finally { active--; }
}
export function assertRelationBudget(access: RelationAccessContext): void {
  if (access.deadlineAt !== undefined && performance.now() >= access.deadlineAt) {
    throw new HTTPException(503, { message: '关联查询超出时间预算，请稍后重试' });
  }
}
export function isStatementTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '57014') return true;
  return 'cause' in error ? isStatementTimeout(error.cause) : false;
}
