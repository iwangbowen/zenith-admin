import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../../db';
import { runWithCurrentUser } from '../../../lib/context';
import logger from '../../../lib/logger';
import type { RelationAccessContext } from './types';
import { recordRelationMetric } from './metrics';

let active = 0;
export class RelationBudgetExceeded extends HTTPException {
  constructor() { super(503, { message: '关联查询超出时间预算，请稍后重试' }); }
}
/** Bounded admission without an unbounded queue; PostgreSQL cancels expensive statements. */
export async function withRelationRead<T>(operation: string, caller: Pick<RelationAccessContext, 'user'>,
  fn: (access: RelationAccessContext) => Promise<T>): Promise<T> {
  const started = performance.now();
  if (active >= 8) {
    recordRelationMetric(operation, 'busy', started);
    throw new HTTPException(503, { message: '关联查询繁忙，请稍后重试' });
  }
  active++;
  try {
    const result = await runWithCurrentUser(caller.user, () => db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('statement_timeout', '1500', true), set_config('lock_timeout', '750', true)`);
      return fn({ user: caller.user, db: tx, deadlineAt: performance.now() + 2500 });
    }, { accessMode: 'read only' }));
    recordRelationMetric(operation, 'success', started);
    return result;
  } catch (error) {
    const result = error instanceof RelationBudgetExceeded ? 'budget'
      : error instanceof HTTPException && (error.status === 403 || error.status === 404) ? 'denied'
        : isStatementTimeout(error) ? 'timeout' : 'error';
    recordRelationMetric(operation, result, started);
    if (error instanceof HTTPException || isStatementTimeout(error)) throw error;
    logger.error({ err: error, operation }, '[entity-relations] query failed');
    throw new HTTPException(503, { message: '关联服务暂不可用' });
  } finally { active--; }
}
export function assertRelationBudget(access: RelationAccessContext): void {
  if (access.deadlineAt !== undefined && performance.now() >= access.deadlineAt) {
    throw new RelationBudgetExceeded();
  }
}

/**
 * Call sequentially on a request transaction. PostgreSQL errors abort their
 * savepoint only, so one advisory summary cannot poison the remaining groups.
 */
export async function withRelationSummaryRead<T>(access: RelationAccessContext,
  fn: (isolated: RelationAccessContext) => Promise<T>, timeoutMs = 250): Promise<T> {
  assertRelationBudget(access);
  const remaining = access.deadlineAt === undefined ? timeoutMs : Math.max(1, Math.ceil(access.deadlineAt - performance.now()));
  return access.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('statement_timeout', ${String(Math.min(timeoutMs, remaining))}, true)`);
    const result = await fn({ ...access, db: tx });
    await tx.execute(sql`select set_config('statement_timeout', '1500', true)`);
    return result;
  });
}
export function isStatementTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '57014') return true;
  return 'cause' in error ? isStatementTimeout(error.cause) : false;
}
