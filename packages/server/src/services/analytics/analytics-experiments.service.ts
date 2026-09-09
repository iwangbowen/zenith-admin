
import { createHash } from 'node:crypto';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { and, desc, eq, gte, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AnalyticsExperimentAssignment, AnalyticsExperimentReport, AnalyticsExperimentReportVariant, AnalyticsExperimentVariant, CreateAnalyticsExperimentInput, UpdateAnalyticsExperimentInput, AnalyticsExperimentListQueryInput } from '@zenith/shared/analytics';
import { ANALYTICS_EXPERIMENT_EXPOSURE_EVENT } from '@zenith/shared/analytics';
import { db } from '../../db';
import { analyticsExperiments, userEvents } from '../../db/schema';
import type { AnalyticsExperimentRow } from '../../db/schema';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart, parseDateTimeInput } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pageOffset } from '../../lib/pagination';
import { currentCreateTenantId, tenantScope, exactTenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { EXPERIMENT_ALPHA, requiredSamplePerVariant, srmTest, twoProportionZTest } from './analytics-experiment-stats';

/** 比例 → 百分比 */
const pct = (ratio: number): number => ratio * 100;
const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;
/** p 值保留 4 位：0.05 附近的判定需要足够精度，同时避免透出无意义的浮点尾数 */
const roundP = (value: number): number => Math.round(value * 10_000) / 10_000;

const ASSIGNMENT_CACHE_TTL_MS = 60_000;
type ExperimentStatus = AnalyticsExperimentRow['status'];
type ExperimentForAssignment = Pick<AnalyticsExperimentRow, 'expKey' | 'trafficAllocation' | 'variants'>;
interface ExperimentCacheEntry { fetchedAt: number; rows: ExperimentForAssignment[] }
const assignmentCache = new Map<string, ExperimentCacheEntry>();

export type ListExperimentsQuery = AnalyticsExperimentListQueryInput;
export interface ExperimentReportQuery { startDate?: string; endDate?: string }

type ExperimentWithTenant = AnalyticsExperimentRow & { tenant?: { name: string | null } | null };

export function bucketFor(expKey: string, distinctId: string): number {
  const hex = createHash('sha256').update(`${expKey}:${distinctId}`).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16) % 100;
}

export function pickVariant(variants: AnalyticsExperimentVariant[], bucket: number): string | null {
  let cursor = 0;
  for (const variant of variants) {
    const next = cursor + variant.weight;
    if (bucket >= cursor && bucket < next) return variant.key;
    cursor = next;
  }
  return variants.at(-1)?.key ?? null;
}

function validateVariants(variants: AnalyticsExperimentVariant[]): void {
  if (variants.length < 2 || variants.length > 6) throw new HTTPException(400, { message: '实验变体数量必须为 2-6 个' });
  const keys = new Set<string>();
  const total = variants.reduce((sum, variant) => {
    if (!/^[a-z][a-z0-9_-]*$/.test(variant.key)) throw new HTTPException(400, { message: '变体 key 格式不正确' });
    if (keys.has(variant.key)) throw new HTTPException(400, { message: '变体 key 不能重复' });
    keys.add(variant.key);
    return sum + variant.weight;
  }, 0);
  if (total !== 100) throw new HTTPException(400, { message: '变体权重总和必须等于 100' });
}

function parseNullableDateTime(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return parseDateTimeInput(value);
}

function mapExperiment(row: ExperimentWithTenant) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantName: row.tenant?.name ?? null,
    expKey: row.expKey,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    trafficAllocation: row.trafficAllocation,
    variants: row.variants,
    metricEventName: row.metricEventName,
    startAt: formatNullableDateTime(row.startAt),
    endAt: formatNullableDateTime(row.endAt),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function invalidateAssignmentCache(tenantId?: number | null): void {
  if (tenantId === undefined) assignmentCache.clear();
  else assignmentCache.delete(String(tenantId ?? 0));
}

function buildExperimentWhere(q: ListExperimentsQuery): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];
  conditions.push(keywordCondition(q.name, [analyticsExperiments.name], 'ilike'));
  if (q.status) conditions.push(eq(analyticsExperiments.status, q.status));
  return buildWhere(...conditions, tenantScope(analyticsExperiments));
}

export async function listExperiments(q: ListExperimentsQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);
  const where = buildExperimentWhere(q);
  return buildListResult({
    page: page,
    pageSize: pageSize,
    count: () => db.$count(analyticsExperiments, where),
    rows: () => db.query.analyticsExperiments.findMany({ where, with: { tenant: true }, orderBy: [desc(analyticsExperiments.id)], limit: pageSize, offset: pageOffset(page, pageSize) }),
    map: mapExperiment,
  });
}

export async function ensureExperimentExists(id: number): Promise<AnalyticsExperimentRow> {
  const [row] = await db.select().from(analyticsExperiments)
    .where(buildWhere(eq(analyticsExperiments.id, id), tenantScope(analyticsExperiments)))
    .limit(1);
  return requireRow(row, '实验不存在');
}

export async function getExperiment(id: number) {
  const row = await db.query.analyticsExperiments.findFirst({ where: buildWhere(eq(analyticsExperiments.id, id), tenantScope(analyticsExperiments)), with: { tenant: true } });
  return mapExperiment(requireRow(row, '实验不存在'));
}

export async function createExperiment(input: CreateAnalyticsExperimentInput) {
  validateVariants(input.variants);
  try {
    const [row] = await db.insert(analyticsExperiments).values({
      tenantId: currentCreateTenantId(),
      expKey: input.expKey,
      name: input.name,
      description: input.description ?? null,
      status: input.status ?? 'draft',
      trafficAllocation: input.trafficAllocation ?? 100,
      variants: input.variants,
      metricEventName: input.metricEventName,
      startAt: parseNullableDateTime(input.startAt) ?? null,
      endAt: parseNullableDateTime(input.endAt) ?? null,
    }).returning();
    invalidateAssignmentCache(row.tenantId);
    return mapExperiment(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '实验标识已存在');
    throw err;
  }
}

function validateStatusTransition(current: ExperimentStatus, next: ExperimentStatus): void {
  if (current === next) return;
  const allowed =
    (next === 'running' && (current === 'draft' || current === 'paused')) ||
    (next === 'paused' && current === 'running') ||
    (next === 'completed' && (current === 'running' || current === 'paused'));
  if (!allowed) throw new HTTPException(400, { message: '实验状态流转不合法' });
}

export async function updateExperiment(id: number, input: UpdateAnalyticsExperimentInput) {
  const current = await ensureExperimentExists(id);
  if (current.status === 'running') {
    const forbidden = ['expKey', 'trafficAllocation', 'variants', 'metricEventName', 'startAt'] as const;
    if (forbidden.some((key) => input[key] !== undefined)) throw new HTTPException(400, { message: '运行中的实验不可修改标识、流量、变体、指标或开始时间' });
  }
  if (input.variants) validateVariants(input.variants);
  if (input.status) validateStatusTransition(current.status, input.status);
  try {
    const [row] = await db.update(analyticsExperiments).set({
      ...(input.expKey !== undefined ? { expKey: input.expKey } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.trafficAllocation !== undefined ? { trafficAllocation: input.trafficAllocation } : {}),
      ...(input.variants !== undefined ? { variants: input.variants } : {}),
      ...(input.metricEventName !== undefined ? { metricEventName: input.metricEventName } : {}),
      ...(input.startAt !== undefined ? { startAt: parseNullableDateTime(input.startAt) ?? null } : {}),
      ...(input.endAt !== undefined ? { endAt: parseNullableDateTime(input.endAt) ?? null } : {}),
    }).where(eq(analyticsExperiments.id, id)).returning();
    invalidateAssignmentCache(row.tenantId);
    return mapExperiment(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '实验标识已存在');
    throw err;
  }
}

export async function deleteExperiment(id: number): Promise<void> {
  const row = await ensureExperimentExists(id);
  if (row.status === 'running') throw new HTTPException(400, { message: '运行中的实验不可删除' });
  await db.delete(analyticsExperiments).where(eq(analyticsExperiments.id, id));
  invalidateAssignmentCache(row.tenantId);
}

async function setExperimentStatus(id: number, next: ExperimentStatus) {
  const row = await ensureExperimentExists(id);
  validateStatusTransition(row.status, next);
  if (next === 'running') validateVariants(row.variants);
  const [updated] = await db.update(analyticsExperiments).set({ status: next }).where(eq(analyticsExperiments.id, id)).returning();
  invalidateAssignmentCache(updated.tenantId);
  return mapExperiment(updated);
}

export function startExperiment(id: number) { return setExperimentStatus(id, 'running'); }
export function pauseExperiment(id: number) { return setExperimentStatus(id, 'paused'); }
export function completeExperiment(id: number) { return setExperimentStatus(id, 'completed'); }

async function loadAssignmentExperiments(tenantId: number | null): Promise<ExperimentForAssignment[]> {
  const cacheKey = String(tenantId ?? 0);
  const now = Date.now();
  const cached = assignmentCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < ASSIGNMENT_CACHE_TTL_MS) return cached.rows;
  const dateConditions = and(
    eq(analyticsExperiments.status, 'running'),
    or(isNull(analyticsExperiments.startAt), lte(analyticsExperiments.startAt, new Date())),
    or(isNull(analyticsExperiments.endAt), gte(analyticsExperiments.endAt, new Date())),
    exactTenantCondition(analyticsExperiments.tenantId, tenantId),
  );
  const rows = await db.select({
    expKey: analyticsExperiments.expKey,
    trafficAllocation: analyticsExperiments.trafficAllocation,
    variants: analyticsExperiments.variants,
  }).from(analyticsExperiments).where(dateConditions);
  assignmentCache.set(cacheKey, { fetchedAt: now, rows });
  return rows;
}

export async function getAssignments(distinctId: string, tenantId: number | null, expKeys?: string[]): Promise<AnalyticsExperimentAssignment[]> {
  const keySet = expKeys && expKeys.length > 0 ? new Set(expKeys) : null;
  const experiments = (await loadAssignmentExperiments(tenantId)).filter((experiment) => !keySet || keySet.has(experiment.expKey));
  const result: AnalyticsExperimentAssignment[] = [];
  for (const experiment of experiments) {
    const bucket = bucketFor(experiment.expKey, distinctId);
    if (bucket >= experiment.trafficAllocation) continue;
    const allocationBucket = experiment.trafficAllocation > 0 ? Math.floor((bucket / experiment.trafficAllocation) * 100) : bucket;
    const variantKey = pickVariant(experiment.variants, allocationBucket);
    if (variantKey) result.push({ expKey: experiment.expKey, variantKey });
  }
  return result;
}

export async function getExperimentReport(id: number, q: ExperimentReportQuery): Promise<AnalyticsExperimentReport> {
  const experiment = await ensureExperimentExists(id);
  const start = parseDateRangeStart(q.startDate ?? undefined);
  const end = parseDateRangeEnd(q.endDate ?? undefined);
  // 事件按"实验自身租户"过滤而非查看者 tenantScope：expKey 允许跨租户重名（唯一索引含
  // COALESCE(tenant_id,0)），平台超管查看某租户实验时若用查看者作用域（undefined=全部租户）
  // 会把其他租户同名 expKey 的曝光/同名指标事件混入报告
  const experimentTenantFilter = exactTenantCondition(userEvents.tenantId, experiment.tenantId);
  const conditions: SQL[] = [eq(userEvents.eventName, ANALYTICS_EXPERIMENT_EXPOSURE_EVENT), experimentTenantFilter];
  if (start) conditions.push(gte(userEvents.createdAt, start));
  if (end) conditions.push(lte(userEvents.createdAt, end));
  const exposureWhere = and(...conditions)!;
  const conversionConditions: SQL[] = [eq(userEvents.eventName, experiment.metricEventName), experimentTenantFilter];
  if (end) conversionConditions.push(lte(userEvents.createdAt, end));
  const conversionWhere = and(...conversionConditions)!;
  const rows = (await db.execute(sql`
    WITH exposures AS (
      SELECT ${userEvents.distinctId} AS distinct_id,
             (${userEvents.properties}->>'variantKey') AS variant_key,
             MIN(${userEvents.createdAt}) AS first_exposure_at
      FROM ${userEvents}
      WHERE ${exposureWhere}
        AND ${userEvents.distinctId} IS NOT NULL
        AND (${userEvents.properties}->>'expKey') = ${experiment.expKey}
      GROUP BY ${userEvents.distinctId}, (${userEvents.properties}->>'variantKey')
    ), conversion_events AS (
      -- 独立 CTE 使 conversionWhere 的 "user_events".* 列引用合法：
      -- 若直接 JOIN "user_events" c，别名会隐藏原表名导致整条 SQL 运行时报错
      SELECT ${userEvents.distinctId} AS distinct_id, ${userEvents.createdAt} AS created_at
      FROM ${userEvents}
      WHERE ${conversionWhere}
        AND ${userEvents.distinctId} IS NOT NULL
    ), conversions AS (
      SELECT e.variant_key AS variant_key, COUNT(DISTINCT c.distinct_id)::int AS conversions
      FROM exposures e
      JOIN conversion_events c ON c.distinct_id = e.distinct_id
        AND c.created_at >= e.first_exposure_at
      GROUP BY e.variant_key
    ), exposure_counts AS (
      SELECT variant_key, COUNT(DISTINCT distinct_id)::int AS exposures FROM exposures GROUP BY variant_key
    )
    SELECT ec.variant_key, ec.exposures, COALESCE(c.conversions, 0)::int AS conversions
    FROM exposure_counts ec
    LEFT JOIN conversions c ON c.variant_key = ec.variant_key
  `)) as unknown as Array<{ variant_key: string; exposures: number; conversions: number }>;
  const byVariant = new Map(rows.map((row) => [row.variant_key, row]));
  // 对照组固定取变体列表首项：与创建实验时「第一个变体是对照组」的约定一致
  const counts = experiment.variants.map((variant) => {
    const row = byVariant.get(variant.key);
    return { key: variant.key, weight: variant.weight, exposures: Number(row?.exposures ?? 0), conversions: Number(row?.conversions ?? 0) };
  });
  const control = counts[0];
  const controlRate = control && control.exposures > 0 ? control.conversions / control.exposures : 0;

  const variants: AnalyticsExperimentReportVariant[] = counts.map((item, index) => {
    const conversionRate = item.exposures > 0 ? round1(pct(item.conversions / item.exposures)) : 0;
    const base = {
      variantKey: item.key,
      exposures: item.exposures,
      conversions: item.conversions,
      conversionRate,
      isControl: index === 0,
    };
    if (index === 0 || !control) {
      return { ...base, absoluteUplift: null, relativeUplift: null, pValue: null, confidenceLow: null, confidenceHigh: null, significant: false, normalApproxValid: false };
    }
    const test = twoProportionZTest(control.conversions, control.exposures, item.conversions, item.exposures);
    if (!test) {
      return { ...base, absoluteUplift: null, relativeUplift: null, pValue: null, confidenceLow: null, confidenceHigh: null, significant: false, normalApproxValid: false };
    }
    const variantRate = item.exposures > 0 ? item.conversions / item.exposures : 0;
    return {
      ...base,
      absoluteUplift: round2(pct(test.absoluteDiff)),
      relativeUplift: controlRate > 0 ? round1(pct((variantRate - controlRate) / controlRate)) : null,
      pValue: roundP(test.pValue),
      confidenceLow: round2(pct(test.confidenceLow)),
      confidenceHigh: round2(pct(test.confidenceHigh)),
      significant: test.normalApproxValid && test.pValue < EXPERIMENT_ALPHA,
      normalApproxValid: test.normalApproxValid,
    };
  });

  const srm = srmTest(counts.map((c) => c.exposures), counts.map((c) => c.weight));
  return {
    experimentId: experiment.id,
    expKey: experiment.expKey,
    metricEventName: experiment.metricEventName,
    variants,
    totalExposures: counts.reduce((sum, c) => sum + c.exposures, 0),
    srm: srm ? { chiSquare: round2(srm.chiSquare), pValue: roundP(srm.pValue), mismatch: srm.mismatch } : null,
    requiredSamplePerVariant: requiredSamplePerVariant(controlRate),
  };
}

export function __resetAnalyticsExperimentCacheForTest(): void { invalidateAssignmentCache(); }
