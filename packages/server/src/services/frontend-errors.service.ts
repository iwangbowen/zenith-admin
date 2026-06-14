import { and, desc, gte, like, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { frontendErrors } from '../db/schema';
import { currentUser } from '../lib/context';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import { mergeWhere, escapeLike } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { pageOffset } from '../lib/pagination';

export interface ErrorReportInput {
  errorType: 'js_error' | 'promise_rejection' | 'resource_error' | 'console_error';
  message: string;
  stack?: string;
  sourceUrl?: string;
  lineNo?: number;
  colNo?: number;
  pageUrl?: string;
  userAgent?: string;
  sessionId?: string;
  fingerprint: string;
}

export async function reportError(input: ErrorReportInput) {
  const user = currentUser();
  const tenantId = currentCreateTenantId();
  const now = new Date();

  // Upsert: if fingerprint exists, increment count + update lastSeenAt; otherwise insert
  await db
    .insert(frontendErrors)
    .values({
      fingerprint: input.fingerprint,
      errorType: input.errorType,
      message: input.message,
      stack: input.stack ?? null,
      sourceUrl: input.sourceUrl ?? null,
      lineNo: input.lineNo ?? null,
      colNo: input.colNo ?? null,
      pageUrl: input.pageUrl ?? null,
      userAgent: input.userAgent ?? null,
      userId: user.userId,
      username: user.username,
      tenantId,
      sessionId: input.sessionId ?? null,
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: frontendErrors.fingerprint,
      set: {
        count: sql`${frontendErrors.count} + 1`,
        lastSeenAt: now,
      },
    });
}

export interface ErrorListQuery {
  page?: number;
  pageSize?: number;
  errorType?: 'js_error' | 'promise_rejection' | 'resource_error' | 'console_error';
  username?: string;
  message?: string;
}

export async function listErrors(q: ErrorListQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);

  const conditions = [];
  if (q.errorType) conditions.push(eq(frontendErrors.errorType, q.errorType));
  if (q.username) conditions.push(like(frontendErrors.username, `%${escapeLike(q.username)}%`));
  if (q.message) conditions.push(like(frontendErrors.message, `%${escapeLike(q.message)}%`));

  const where = mergeWhere(and(...conditions), tenantScope(frontendErrors));

  const [list, total] = await Promise.all([
    db
      .select()
      .from(frontendErrors)
      .where(where)
      .orderBy(desc(frontendErrors.lastSeenAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.$count(frontendErrors, where),
  ]);

  return {
    list: list.map((r) => ({
      ...r,
      firstSeenAt: formatDateTime(r.firstSeenAt),
      lastSeenAt: formatDateTime(r.lastSeenAt),
    })),
    total,
    page,
    pageSize,
  };
}

export async function cleanErrors(days: number): Promise<number> {
  const where = days > 0
    ? mergeWhere(
        gte(frontendErrors.lastSeenAt, new Date(Date.now() - days * 24 * 60 * 60 * 1000)),
        tenantScope(frontendErrors),
      )
    : tenantScope(frontendErrors);

  // For "days > 0", we want to DELETE records where lastSeenAt < cutoff (not >=)
  const cutoffWhere = days > 0
    ? mergeWhere(
        sql`${frontendErrors.lastSeenAt} < NOW() - INTERVAL '${sql.raw(String(days))} days'`,
        tenantScope(frontendErrors),
      )
    : tenantScope(frontendErrors);

  const result = await db.delete(frontendErrors).where(cutoffWhere);
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}

export async function getErrorStats(days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const where = mergeWhere(
    gte(frontendErrors.lastSeenAt, startDate),
    tenantScope(frontendErrors),
  );

  const [totalRow, byType] = await Promise.all([
    db
      .select({ total: sql<number>`COUNT(*)::integer`, totalOccurrences: sql<number>`SUM(${frontendErrors.count})::integer` })
      .from(frontendErrors)
      .where(where),
    db
      .select({ errorType: frontendErrors.errorType, count: sql<number>`COUNT(*)::integer`, occurrences: sql<number>`SUM(${frontendErrors.count})::integer` })
      .from(frontendErrors)
      .where(where)
      .groupBy(frontendErrors.errorType),
  ]);

  return {
    totalDistinct: Number(totalRow[0]?.total ?? 0),
    totalOccurrences: Number(totalRow[0]?.totalOccurrences ?? 0),
    byType: byType.map((r) => ({
      errorType: r.errorType,
      count: Number(r.count),
      occurrences: Number(r.occurrences),
    })),
  };
}
