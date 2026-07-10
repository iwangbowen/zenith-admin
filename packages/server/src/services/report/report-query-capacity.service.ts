import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type {
  CreateReportQueryQuotaInput,
  ReportQueryCostLog,
  ReportQueryQuota,
  ReportQueryQuotaUsage,
  UpdateReportQueryQuotaInput,
} from '@zenith/shared';
import { config } from '../../config';
import { db } from '../../db';
import { reportQueryCostLogs, reportQueryQuotas, users } from '../../db/schema';
import { currentUserId, currentUserOrNull } from '../../lib/context';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import {
  DATE_FORMAT,
  formatDateTime,
  parseDateRangeEnd,
  parseDateRangeStart,
} from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import redis from '../../lib/redis';
import { escapeLike } from '../../lib/where-helpers';
import { reportCreateTenantId, reportScopedWhere, reportTenantScope } from './report-access';
import { reportTimeBucketExpression } from './report-time-bucket';

const RESERVE_QUOTA_LUA = `
for i, key in ipairs(KEYS) do
  local offset = (i - 1) * 6
  local maxConcurrent = tonumber(ARGV[offset + 1])
  local maxQueries = tonumber(ARGV[offset + 2])
  local maxRows = tonumber(ARGV[offset + 3])
  local maxBytes = tonumber(ARGV[offset + 4])
  local maxCost = tonumber(ARGV[offset + 5])
  local concurrent = tonumber(redis.call('HGET', key, 'concurrent') or '0')
  local queries = tonumber(redis.call('HGET', key, 'queries') or '0')
  local rows = tonumber(redis.call('HGET', key, 'rows') or '0')
  local bytes = tonumber(redis.call('HGET', key, 'bytes') or '0')
  local cost = tonumber(redis.call('HGET', key, 'cost') or '0')
  if maxConcurrent > 0 and concurrent >= maxConcurrent then return i * 10 + 1 end
  if maxQueries > 0 and queries >= maxQueries then return i * 10 + 2 end
  if maxRows > 0 and rows >= maxRows then return i * 10 + 3 end
  if maxBytes > 0 and bytes >= maxBytes then return i * 10 + 4 end
  if maxCost > 0 and cost >= maxCost then return i * 10 + 5 end
end
for i, key in ipairs(KEYS) do
  local offset = (i - 1) * 6
  redis.call('HINCRBY', key, 'concurrent', 1)
  redis.call('HINCRBY', key, 'queries', 1)
  redis.call('EXPIRE', key, tonumber(ARGV[offset + 6]))
end
return 0
`;

const SETTLE_QUOTA_LUA = `
for i, key in ipairs(KEYS) do
  local concurrent = tonumber(redis.call('HGET', key, 'concurrent') or '0')
  if concurrent > 0 then redis.call('HINCRBY', key, 'concurrent', -1) end
  redis.call('HINCRBYFLOAT', key, 'rows', ARGV[1])
  redis.call('HINCRBYFLOAT', key, 'bytes', ARGV[2])
  redis.call('HINCRBYFLOAT', key, 'cost', ARGV[3])
  redis.call('EXPIRE', key, tonumber(ARGV[3 + i]))
end
return 0
`;

type QuotaRow = typeof reportQueryQuotas.$inferSelect;
type CostRow = typeof reportQueryCostLogs.$inferSelect;

export interface QuotaIdentity {
  tenantId: number | null;
  userId: number | null;
}

interface QuotaCounter {
  quota: QuotaRow;
  key: string;
  day: string;
  ttlSeconds: number;
}

export interface QueryQuotaLease {
  counters: QuotaCounter[];
  settled: boolean;
}

export interface CapacityLease {
  queuedMs: number;
  release(): void;
}

interface SemaphoreWaiter {
  resolve: (lease: CapacityLease) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
  timer: NodeJS.Timeout;
}

export class BoundedSemaphore {
  private running = 0;
  private readonly waiters: SemaphoreWaiter[] = [];

  constructor(
    readonly limit: number,
    private readonly queueLimit: number,
    private readonly timeoutMs: number,
  ) {}

  get activeCount(): number {
    return this.running;
  }

  get queueDepth(): number {
    return this.waiters.length;
  }

  acquire(): Promise<CapacityLease> {
    const enqueuedAt = Date.now();
    if (this.running < this.limit) {
      this.running++;
      return Promise.resolve(this.createLease(enqueuedAt));
    }
    if (this.waiters.length >= this.queueLimit) {
      throw new HTTPException(429, { message: '报表查询队列已满，请稍后重试' });
    }
    return new Promise((resolve, reject) => {
      const waiter: SemaphoreWaiter = {
        resolve,
        reject,
        enqueuedAt,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new HTTPException(429, { message: '报表查询排队超时，请稍后重试' }));
        }, this.timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private createLease(enqueuedAt: number): CapacityLease {
    let released = false;
    return {
      queuedMs: Math.max(0, Date.now() - enqueuedAt),
      release: () => {
        if (released) return;
        released = true;
        this.releaseOne();
      },
    };
  }

  private releaseOne(): void {
    const waiter = this.waiters.shift();
    if (!waiter) {
      this.running = Math.max(0, this.running - 1);
      return;
    }
    clearTimeout(waiter.timer);
    waiter.resolve(this.createLease(waiter.enqueuedAt));
  }
}

const datasourceLimit = Math.max(1, config.report.dashboardMaxConcurrent);
const globalCapacity = new BoundedSemaphore(Math.max(4, datasourceLimit * 4), 200, 30_000);
const datasourceCapacities = new Map<number, BoundedSemaphore>();

function datasourceCapacity(datasourceId: number): BoundedSemaphore {
  let semaphore = datasourceCapacities.get(datasourceId);
  if (!semaphore) {
    semaphore = new BoundedSemaphore(datasourceLimit, 50, 30_000);
    datasourceCapacities.set(datasourceId, semaphore);
  }
  return semaphore;
}

export async function acquireReportQueryCapacity(datasourceId: number): Promise<CapacityLease> {
  const startedAt = Date.now();
  const globalLease = await globalCapacity.acquire();
  try {
    const sourceLease = await datasourceCapacity(datasourceId).acquire();
    let released = false;
    return {
      queuedMs: Date.now() - startedAt,
      release: () => {
        if (released) return;
        released = true;
        sourceLease.release();
        globalLease.release();
      },
    };
  } catch (error) {
    globalLease.release();
    throw error;
  }
}

export function getReportQueryCapacitySnapshot() {
  return {
    globalLimit: globalCapacity.limit,
    running: globalCapacity.activeCount,
    queueDepth: globalCapacity.queueDepth,
    datasourceQueues: [...datasourceCapacities.values()].reduce((sum, item) => sum + item.queueDepth, 0),
  };
}

export function resolveQuotaDay(now: Date, timezone: string): { day: string; ttlSeconds: number } {
  const local = dayjs(now).tz(timezone);
  const nextDay = local.add(1, 'day').startOf('day');
  return {
    day: local.format(DATE_FORMAT),
    ttlSeconds: Math.max(60, nextDay.diff(local, 'second') + 3600),
  };
}

function quotaCounterKey(quotaId: number, day: string): string {
  return `${config.redis.keyPrefix}report:quota:${quotaId}:${day}`;
}

async function loadApplicableQuotaRows(identity: QuotaIdentity): Promise<QuotaRow[]> {
  const tenantCondition = identity.tenantId === null
    ? isNull(reportQueryQuotas.tenantId)
    : eq(reportQueryQuotas.tenantId, identity.tenantId);
  return db.select().from(reportQueryQuotas).where(and(
    tenantCondition,
    eq(reportQueryQuotas.enabled, true),
    or(
      and(eq(reportQueryQuotas.scope, 'tenant'), isNull(reportQueryQuotas.userId)),
      identity.userId
        ? and(eq(reportQueryQuotas.scope, 'user'), eq(reportQueryQuotas.userId, identity.userId))
        : sql`false`,
    ),
  ));
}

function quotaLimitMessage(code: number, counters: QuotaCounter[]): string {
  const quotaIndex = Math.floor(code / 10) - 1;
  const limit = code % 10;
  const scope = counters[quotaIndex]?.quota.scope === 'user' ? '用户' : '租户';
  const labels: Record<number, string> = {
    1: '并发查询数',
    2: '每日查询次数',
    3: '每日返回行数',
    4: '每日返回字节数',
    5: '每日成本额度',
  };
  return `${scope}${labels[limit] ?? '查询'}配额已用尽，请稍后或次日重试`;
}

export async function reserveReportQueryQuota(identity: QuotaIdentity): Promise<QueryQuotaLease> {
  const quotas = await loadApplicableQuotaRows(identity);
  if (!quotas.length) return { counters: [], settled: false };
  const now = new Date();
  const counters = quotas.map((quota) => {
    const { day, ttlSeconds } = resolveQuotaDay(now, quota.resetTimezone);
    return { quota, day, ttlSeconds, key: quotaCounterKey(quota.id, day) };
  });
  const args = counters.flatMap(({ quota, ttlSeconds }) => [
    quota.maxConcurrent,
    quota.dailyQueryLimit,
    quota.dailyRowLimit,
    quota.dailyByteLimit,
    quota.dailyCostLimit,
    ttlSeconds,
  ]);
  const result = Number(await redis.eval(RESERVE_QUOTA_LUA, counters.length, ...counters.map((item) => item.key), ...args));
  if (result !== 0) throw new HTTPException(429, { message: quotaLimitMessage(result, counters) });
  return { counters, settled: false };
}

export async function settleReportQueryQuota(
  lease: QueryQuotaLease,
  usage: { rows: number; bytes: number; costUnits: number },
): Promise<void> {
  if (lease.settled) return;
  lease.settled = true;
  if (!lease.counters.length) return;
  await redis.eval(
    SETTLE_QUOTA_LUA,
    lease.counters.length,
    ...lease.counters.map((item) => item.key),
    Math.max(0, Math.trunc(usage.rows)),
    Math.max(0, Math.trunc(usage.bytes)),
    Math.max(0, usage.costUnits),
    ...lease.counters.map((item) => item.ttlSeconds),
  );
}

export function calculateQueryCost(input: {
  durationMs: number;
  rows: number;
  bytes: number;
  cacheHit: boolean;
}): number {
  const base = input.durationMs / 1000 + input.rows / 10_000 + input.bytes / (1024 * 1024);
  return Math.round(base * (input.cacheHit ? 0.25 : 1) * 10_000) / 10_000;
}

export function newReportQueryRequestId(): string {
  return randomUUID();
}

export async function persistReportQueryCost(input: {
  identity: QuotaIdentity;
  datasetId: number | null;
  datasourceId: number;
  scene: string;
  requestId: string;
  queuedMs: number;
  durationMs: number;
  rowCount: number;
  byteSize: number;
  costUnits: number;
  cacheHit: boolean;
  success: boolean;
  errorCode?: string | null;
}): Promise<void> {
  await db.insert(reportQueryCostLogs).values({
    tenantId: input.identity.tenantId,
    userId: input.identity.userId,
    datasetId: input.datasetId,
    datasourceId: input.datasourceId,
    scene: input.scene.slice(0, 64),
    requestId: input.requestId,
    queuedMs: Math.max(0, Math.round(input.queuedMs)),
    durationMs: Math.max(0, Math.round(input.durationMs)),
    rowCount: Math.max(0, Math.trunc(input.rowCount)),
    byteSize: Math.max(0, Math.trunc(input.byteSize)),
    costUnits: Math.max(0, input.costUnits),
    cacheHit: input.cacheHit,
    success: input.success,
    errorCode: input.errorCode?.slice(0, 64) ?? null,
  }).onConflictDoNothing({ target: reportQueryCostLogs.requestId });
}

export function mapReportQueryQuota(row: QuotaRow): ReportQueryQuota {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    scope: row.scope,
    userId: row.userId ?? null,
    maxConcurrent: row.maxConcurrent,
    dailyQueryLimit: row.dailyQueryLimit,
    dailyRowLimit: row.dailyRowLimit,
    dailyByteLimit: row.dailyByteLimit,
    dailyCostLimit: row.dailyCostLimit,
    resetTimezone: row.resetTimezone,
    enabled: row.enabled,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapReportQueryCost(row: CostRow): ReportQueryCostLog {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    userId: row.userId ?? null,
    datasetId: row.datasetId ?? null,
    datasourceId: row.datasourceId ?? null,
    scene: row.scene,
    requestId: row.requestId,
    queuedMs: row.queuedMs,
    durationMs: row.durationMs,
    rowCount: row.rowCount,
    byteSize: row.byteSize,
    costUnits: row.costUnits,
    cacheHit: row.cacheHit,
    success: row.success,
    errorCode: row.errorCode ?? null,
    occurredAt: formatDateTime(row.occurredAt),
  };
}

async function ensureQuota(id: number): Promise<QuotaRow> {
  const row = await db.query.reportQueryQuotas.findFirst({
    where: reportScopedWhere(reportQueryQuotas, eq(reportQueryQuotas.id, id)),
  });
  if (!row) throw new HTTPException(404, { message: '查询配额不存在' });
  return row;
}

async function validateQuotaUser(scope: 'tenant' | 'user', userId: number | null | undefined): Promise<void> {
  if (scope !== 'user' || !userId) return;
  const tenantId = reportCreateTenantId();
  const tenantWhere = tenantId === null ? isNull(users.tenantId) : eq(users.tenantId, tenantId);
  const [user] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), tenantWhere)).limit(1);
  if (!user) throw new HTTPException(400, { message: '配额用户不存在或不属于当前租户' });
}

export async function listReportQueryQuotas(page = 1, pageSize = 20) {
  const where = reportTenantScope(reportQueryQuotas);
  const [total, rows] = await Promise.all([
    db.$count(reportQueryQuotas, where),
    db.select().from(reportQueryQuotas).where(where).orderBy(desc(reportQueryQuotas.id))
      .limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapReportQueryQuota), total, page, pageSize };
}

export async function getReportQueryQuota(id: number): Promise<ReportQueryQuota> {
  return mapReportQueryQuota(await ensureQuota(id));
}

export async function createReportQueryQuota(input: CreateReportQueryQuotaInput): Promise<ReportQueryQuota> {
  await validateQuotaUser(input.scope, input.userId);
  try {
    const [row] = await db.insert(reportQueryQuotas).values({
      tenantId: reportCreateTenantId(),
      scope: input.scope,
      userId: input.scope === 'user' ? input.userId : null,
      maxConcurrent: input.maxConcurrent,
      dailyQueryLimit: input.dailyQueryLimit,
      dailyRowLimit: input.dailyRowLimit,
      dailyByteLimit: input.dailyByteLimit,
      dailyCostLimit: input.dailyCostLimit,
      resetTimezone: input.resetTimezone,
      enabled: input.enabled,
      createdBy: currentUserId(),
      updatedBy: currentUserId(),
    }).returning();
    return mapReportQueryQuota(row!);
  } catch (error) {
    rethrowPgUniqueViolation(error, '同一范围的查询配额已存在');
  }
}

export async function updateReportQueryQuota(id: number, input: UpdateReportQueryQuotaInput): Promise<ReportQueryQuota> {
  const existing = await ensureQuota(id);
  const scope = input.scope ?? existing.scope;
  const userId = input.userId === undefined ? existing.userId : input.userId;
  await validateQuotaUser(scope, userId);
  try {
    const [row] = await db.update(reportQueryQuotas).set({
      ...input,
      userId: scope === 'user' ? userId : null,
      updatedBy: currentUserId(),
    }).where(eq(reportQueryQuotas.id, id)).returning();
    return mapReportQueryQuota(row!);
  } catch (error) {
    rethrowPgUniqueViolation(error, '同一范围的查询配额已存在');
  }
}

export async function deleteReportQueryQuota(id: number): Promise<void> {
  await ensureQuota(id);
  await db.delete(reportQueryQuotas).where(eq(reportQueryQuotas.id, id));
}

async function readQuotaUsage(row: QuotaRow, scopeDate?: string): Promise<ReportQueryQuotaUsage> {
  const { day } = resolveQuotaDay(new Date(), row.resetTimezone);
  const selectedDay = scopeDate ?? day;
  const values = await redis.hgetall(quotaCounterKey(row.id, selectedDay));
  return {
    tenantId: row.tenantId,
    userId: row.userId,
    timezone: row.resetTimezone,
    day: selectedDay,
    concurrent: Number(values.concurrent ?? 0),
    queries: Number(values.queries ?? 0),
    rows: Number(values.rows ?? 0),
    bytes: Number(values.bytes ?? 0),
    costUnits: Number(values.cost ?? 0),
    maxConcurrent: row.maxConcurrent,
    dailyQueryLimit: row.dailyQueryLimit,
    dailyRowLimit: row.dailyRowLimit,
    dailyByteLimit: row.dailyByteLimit,
    dailyCostLimit: row.dailyCostLimit,
  };
}

export async function getReportQueryQuotaUsage(id: number, scopeDate?: string): Promise<ReportQueryQuotaUsage> {
  return readQuotaUsage(await ensureQuota(id), scopeDate);
}

export async function resetReportQueryQuotaUsage(id: number, scopeDate?: string): Promise<void> {
  const row = await ensureQuota(id);
  const { day } = resolveQuotaDay(new Date(), row.resetTimezone);
  await redis.del(quotaCounterKey(id, scopeDate ?? day));
}

export function parseReportQueryCostRange(start?: string, end?: string): { startAt: Date; endAt: Date } {
  const endAt = parseDateRangeEnd(end) ?? new Date();
  const startAt = parseDateRangeStart(start) ?? dayjs(endAt).subtract(7, 'day').toDate();
  if (startAt > endAt) throw new HTTPException(400, { message: '开始时间不能晚于结束时间' });
  if (dayjs(endAt).diff(startAt, 'day', true) > 90) {
    throw new HTTPException(400, { message: '查询时间范围不能超过 90 天' });
  }
  return { startAt, endAt };
}

export async function listReportQueryCostLogs(query: {
  page?: number;
  pageSize?: number;
  userId?: number;
  datasetId?: number;
  datasourceId?: number;
  scene?: string;
  success?: boolean;
  start?: string;
  end?: string;
}) {
  const { page = 1, pageSize = 20 } = query;
  const { startAt, endAt } = parseReportQueryCostRange(query.start, query.end);
  const conds = [gte(reportQueryCostLogs.occurredAt, startAt), lte(reportQueryCostLogs.occurredAt, endAt)];
  const scope = reportTenantScope(reportQueryCostLogs);
  if (scope) conds.push(scope);
  if (query.userId) conds.push(eq(reportQueryCostLogs.userId, query.userId));
  if (query.datasetId) conds.push(eq(reportQueryCostLogs.datasetId, query.datasetId));
  if (query.datasourceId) conds.push(eq(reportQueryCostLogs.datasourceId, query.datasourceId));
  if (query.scene) conds.push(sql`${reportQueryCostLogs.scene} ilike ${`%${escapeLike(query.scene)}%`} escape '\\'`);
  if (query.success !== undefined) conds.push(eq(reportQueryCostLogs.success, query.success));
  const where = and(...conds);
  const [total, rows] = await Promise.all([
    db.$count(reportQueryCostLogs, where),
    db.select().from(reportQueryCostLogs).where(where).orderBy(desc(reportQueryCostLogs.occurredAt))
      .limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapReportQueryCost), total, page, pageSize };
}

export async function getReportQueryCostStats(query: {
  datasetId?: number;
  datasourceId?: number;
  start?: string;
  end?: string;
}) {
  const { startAt, endAt } = parseReportQueryCostRange(query.start, query.end);
  const conds = [gte(reportQueryCostLogs.occurredAt, startAt), lte(reportQueryCostLogs.occurredAt, endAt)];
  const scope = reportTenantScope(reportQueryCostLogs);
  if (scope) conds.push(scope);
  if (query.datasetId) conds.push(eq(reportQueryCostLogs.datasetId, query.datasetId));
  if (query.datasourceId) conds.push(eq(reportQueryCostLogs.datasourceId, query.datasourceId));
  const [row] = await db.select({
    queries: sql<number>`count(*)::int`,
    rows: sql<number>`coalesce(sum(${reportQueryCostLogs.rowCount}), 0)::bigint`,
    bytes: sql<number>`coalesce(sum(${reportQueryCostLogs.byteSize}), 0)::bigint`,
    costUnits: sql<number>`coalesce(sum(${reportQueryCostLogs.costUnits}), 0)::double precision`,
    avgDurationMs: sql<number>`coalesce(round(avg(${reportQueryCostLogs.durationMs})), 0)::int`,
    failures: sql<number>`sum(case when not ${reportQueryCostLogs.success} then 1 else 0 end)::int`,
  }).from(reportQueryCostLogs).where(and(...conds));
  return {
    queries: Number(row?.queries ?? 0),
    rows: Number(row?.rows ?? 0),
    bytes: Number(row?.bytes ?? 0),
    costUnits: Number(row?.costUnits ?? 0),
    avgDurationMs: Number(row?.avgDurationMs ?? 0),
    failures: Number(row?.failures ?? 0),
    capacity: getReportQueryCapacitySnapshot(),
  };
}

export async function getReportQueryCostTrend(query: {
  bucket?: 'hour' | 'day';
  datasetId?: number;
  datasourceId?: number;
  start?: string;
  end?: string;
}) {
  const bucket = query.bucket ?? 'day';
  const { startAt, endAt } = parseReportQueryCostRange(query.start, query.end);
  const conds = [gte(reportQueryCostLogs.occurredAt, startAt), lte(reportQueryCostLogs.occurredAt, endAt)];
  const scope = reportTenantScope(reportQueryCostLogs);
  if (scope) conds.push(scope);
  if (query.datasetId) conds.push(eq(reportQueryCostLogs.datasetId, query.datasetId));
  if (query.datasourceId) conds.push(eq(reportQueryCostLogs.datasourceId, query.datasourceId));
  const bucketSql = reportTimeBucketExpression(bucket, reportQueryCostLogs.occurredAt);
  const rows = await db.select({
    bucket: bucketSql,
    queries: sql<number>`count(*)::int`,
    rows: sql<number>`coalesce(sum(${reportQueryCostLogs.rowCount}), 0)::bigint`,
    bytes: sql<number>`coalesce(sum(${reportQueryCostLogs.byteSize}), 0)::bigint`,
    costUnits: sql<number>`coalesce(sum(${reportQueryCostLogs.costUnits}), 0)::double precision`,
    avgDurationMs: sql<number>`coalesce(round(avg(${reportQueryCostLogs.durationMs})), 0)::int`,
    queueMs: sql<number>`coalesce(round(avg(${reportQueryCostLogs.queuedMs})), 0)::int`,
  }).from(reportQueryCostLogs).where(and(...conds))
    .groupBy(bucketSql).orderBy(bucketSql);
  return rows.map((row) => ({
    bucket: formatDateTime(row.bucket),
    queries: Number(row.queries),
    rows: Number(row.rows),
    bytes: Number(row.bytes),
    costUnits: Number(row.costUnits),
    avgDurationMs: Number(row.avgDurationMs),
    queueMs: Number(row.queueMs),
  }));
}

export function resolveReportQueryIdentity(
  tenantId: number | null,
  runtime?: { effectiveTenantId?: number | null; effectiveUserId?: number | null },
): QuotaIdentity {
  const user = currentUserOrNull();
  return {
    tenantId: runtime?.effectiveTenantId === undefined ? tenantId : runtime.effectiveTenantId,
    userId: runtime?.effectiveUserId === undefined ? user?.userId ?? null : runtime.effectiveUserId,
  };
}
