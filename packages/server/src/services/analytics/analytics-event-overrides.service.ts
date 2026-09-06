/**
 * 行为中心阶段 1：租户级事件启停覆盖（Tracking Plan 全局屏蔽之外的租户自助开关）。
 */
import { and, desc, eq } from 'drizzle-orm';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { analyticsEventOverrides } from '../../db/schema';
import type { AnalyticsEventOverrideRow } from '../../db/schema';
import type { CreateAnalyticsEventOverrideInput, UpdateAnalyticsEventOverrideInput } from '@zenith/shared/analytics';
import { formatDateTime } from '../../lib/datetime';
import { pageOffset } from '../../lib/pagination';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUser } from '../../lib/context';
import { getEffectiveTenantId } from '../../lib/tenant';
import { invalidateGovernanceCache } from './analytics-governance.service';

export function mapEventOverride(row: AnalyticsEventOverrideRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    eventName: row.eventName,
    status: row.status,
    reason: row.reason,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 事件覆盖表 tenantId 非空：平台超管必须先选择查看租户，否则一律 400（含 list）。 */
export function requireViewingTenantId(): number {
  const effective = getEffectiveTenantId(currentUser());
  if (effective === null) throw new HTTPException(400, { message: '请先选择要查看的租户' });
  return effective;
}

export interface EventOverrideListQuery { page?: number; pageSize?: number; eventName?: string; status?: string }
export async function listEventOverrides(q: EventOverrideListQuery) {
  const tenantId = requireViewingTenantId();
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);
  const conditions = [eq(analyticsEventOverrides.tenantId, tenantId)];
  if (q.eventName) conditions.push(eq(analyticsEventOverrides.eventName, q.eventName));
  if (q.status) conditions.push(eq(analyticsEventOverrides.status, q.status as 'enabled'));
  const where = and(...conditions);

  return buildListResult({
    page: page,
    pageSize: pageSize,
    count: () => db.$count(analyticsEventOverrides, where),
    rows: () => db.select().from(analyticsEventOverrides).where(where).orderBy(desc(analyticsEventOverrides.updatedAt)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapEventOverride,
  });
}

export async function ensureEventOverrideExists(id: number, tenantId: number) {
  const [row] = await db.select().from(analyticsEventOverrides)
    .where(and(eq(analyticsEventOverrides.id, id), eq(analyticsEventOverrides.tenantId, tenantId))).limit(1);
  return requireRow(row, '事件覆盖规则不存在');
}

export async function createEventOverride(input: CreateAnalyticsEventOverrideInput) {
  const tenantId = requireViewingTenantId();
  try {
    const [row] = await db.insert(analyticsEventOverrides)
      .values({ tenantId, eventName: input.eventName, status: input.status, reason: input.reason ?? null })
      .returning();
    invalidateGovernanceCache();
    return mapEventOverride(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该事件在当前租户已存在覆盖规则');
    throw err;
  }
}

export async function updateEventOverride(id: number, input: UpdateAnalyticsEventOverrideInput) {
  const tenantId = requireViewingTenantId();
  await ensureEventOverrideExists(id, tenantId);
  const [row] = await db.update(analyticsEventOverrides)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    })
    .where(and(eq(analyticsEventOverrides.id, id), eq(analyticsEventOverrides.tenantId, tenantId)))
    .returning();
  invalidateGovernanceCache();
  return mapEventOverride(row);
}

export async function deleteEventOverride(id: number) {
  const tenantId = requireViewingTenantId();
  await ensureEventOverrideExists(id, tenantId);
  await db.delete(analyticsEventOverrides).where(and(eq(analyticsEventOverrides.id, id), eq(analyticsEventOverrides.tenantId, tenantId)));
  invalidateGovernanceCache();
}
