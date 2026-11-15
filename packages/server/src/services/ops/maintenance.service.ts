import { eq, desc, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type * as z from 'zod';
import type { QueryOutputOf } from '@zenith/shared/core';
import { maintenanceContract, maintenanceLogSchema, publicMaintenanceStatusSchema, type MaintenanceStatus } from '@zenith/shared/ops';
import type { UpdateMaintenanceInput } from '@zenith/shared/ops/maintenance-validation';
import { db, readSnapshot } from '../../db';
import { maintenanceMode, maintenanceLogs } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { currentUser, setAuditBefore, setAuditAfter } from '../../lib/context';
import { assertMaintenanceManager } from '../../lib/maintenance-access';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { listRows } from '../../lib/list-query';
import { entityMapper } from '../../lib/entity-map';
import { formatDateTime, parseDateTimeInput } from '../../lib/datetime';
import { TtlCache } from '../../lib/ttl-cache';
import { onInvalidate, onInvalidationReset } from '../../lib/invalidation-bus';
import { scheduleBroadcast } from '../../lib/ws-manager';
import { requireRow } from '../../lib/db-assert';

const OPEN = ['scheduled', 'ongoing'] as const;
const mapPeriod = entityMapper(maintenanceLogSchema);
let cache = new TtlCache<string, MaintenanceStatus>(5000, { staleWhileRevalidate: false });
export function invalidateMaintenanceCache() { cache = new TtlCache(5000, { staleWhileRevalidate: false }); }
onInvalidate('maintenance_mode', invalidateMaintenanceCache);
onInvalidate('maintenance_logs', invalidateMaintenanceCache);
onInvalidationReset(invalidateMaintenanceCache);

async function snapshot(executor: DbExecutor): Promise<MaintenanceStatus> {
  const [head] = await executor.select().from(maintenanceMode).where(eq(maintenanceMode.key, 'global')).limit(1);
  const [period] = await executor.select().from(maintenanceLogs).where(inArray(maintenanceLogs.status, [...OPEN])).orderBy(desc(maintenanceLogs.id)).limit(1);
  const current = period ? mapPeriod(period) : null;
  return { enabled: current?.status === 'ongoing', message: current?.message ?? head?.message ?? '系统维护中，请稍后重试',
    estimatedEndAt: current?.estimatedEndAt ?? (head?.estimatedEndAt ? formatDateTime(head.estimatedEndAt) : null),
    startedAt: current?.startedAt ?? null, startedByName: current?.startedByName ?? null,
    scheduledStartAt: current?.scheduledStartAt ?? null, autoEndAt: current?.autoEndAt ?? null,
    version: head?.version ?? 0, updatedAt: head ? formatDateTime(head.updatedAt) : null, current };
}
export function getMaintenanceStatus() { return cache.get('global', () => readSnapshot(snapshot)); }
export async function getPublicMaintenanceStatus() { return publicMaintenanceStatusSchema.parse(await getMaintenanceStatus()); }

function parsed(value: string | null) {
  if (!value) return null;
  const date = parseDateTimeInput(value);
  if (!date || formatDateTime(date) !== value) throw new HTTPException(400, { message: '维护时间无效或不是有效的业务时区时间' });
  return date;
}
function changes(before: MaintenanceStatus, action: string, reason: string, message = before.message, estimatedEndAt = before.estimatedEndAt) {
  return [...(before.current?.changes ?? []), { action, reason, message, estimatedEndAt, at: formatDateTime(new Date()), actor: currentUser().username }];
}
async function mutate(version: number, work: (tx: DbExecutor, before: MaintenanceStatus) => Promise<void>) {
  await assertMaintenanceManager(currentUser());
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('maintenance:global',0))`);
    await tx.insert(maintenanceMode).values({ key: 'global' }).onConflictDoNothing();
    const before = await snapshot(tx);
    if (before.version !== version) throw new HTTPException(409, { message: '维护配置已变化，草稿已保留，请载入最新状态' });
    setAuditBefore(before);
    await work(tx, before);
    await tx.update(maintenanceMode).set({ version: before.version + 1 }).where(eq(maintenanceMode.key, 'global'));
    return snapshot(tx);
  });
  invalidateMaintenanceCache();
  setAuditAfter(result);
  scheduleBroadcast({ type: 'maintenance:changed', payload: { version: result.version } });
  return result;
}

export async function updateMaintenanceStatus(input: UpdateMaintenanceInput) {
  const end = parsed(input.estimatedEndAt);
  if (input.enabled && end && end <= new Date()) throw new HTTPException(400, { message: '预计结束时间必须晚于当前时间' });
  return mutate(input.version, async (tx, before) => {
    if (before.current?.status === 'scheduled') throw new HTTPException(409, { message: '已有维护计划，请提前开始或取消计划后再操作' });
    await tx.update(maintenanceMode).set({ message: input.message, estimatedEndAt: end }).where(eq(maintenanceMode.key, 'global'));
    if (!before.enabled && input.enabled) {
      await tx.insert(maintenanceLogs).values({ status: 'ongoing', message: input.message, estimatedEndAt: end, reason: input.reason,
        startedAt: new Date(), startedById: currentUser().userId, startedByName: currentUser().username, changes: changes(before, 'start', input.reason, input.message, input.estimatedEndAt) });
    } else if (before.enabled && before.current) {
      const now = new Date();
      await tx.update(maintenanceLogs).set(input.enabled ? { message: input.message, estimatedEndAt: end, changes: changes(before, 'update', input.reason, input.message, input.estimatedEndAt) } : {
        status: 'completed', endedAt: now, endedById: currentUser().userId, endedByName: currentUser().username, endReason: input.reason,
        durationSeconds: Math.max(0, Math.floor((now.getTime() - parsed(before.startedAt)!.getTime()) / 1000)), changes: changes(before, 'finish', input.reason),
      }).where(eq(maintenanceLogs.id, before.current.id));
    }
  });
}
export async function planMaintenance(input: z.output<typeof maintenanceContract.plan.body>) {
  const start = parsed(input.scheduledStartAt)!; const end = parsed(input.estimatedEndAt); const auto = parsed(input.autoEndAt);
  if (start <= new Date() || (end && end <= start) || (auto && auto <= start)) throw new HTTPException(400, { message: '维护计划时间顺序不正确' });
  return mutate(input.version, async (tx, before) => {
    if (before.current) throw new HTTPException(409, { message: '已有未结束的维护时段' });
    await tx.insert(maintenanceLogs).values({ status: 'scheduled', message: input.message, reason: input.reason, scheduledStartAt: start,
      estimatedEndAt: end, autoEndAt: auto, notifyUserIds: input.notifyUserIds, remindMinutes: input.remindMinutes,
      startedById: currentUser().userId, startedByName: currentUser().username, changes: changes(before, 'plan', input.reason, input.message, input.estimatedEndAt) });
  });
}
export async function maintenanceAction(action: 'start' | 'cancel', input: z.output<typeof maintenanceContract.start.body>) {
  return mutate(input.version, async (tx, before) => {
    if (before.current?.status !== 'scheduled') throw new HTTPException(409, { message: '当前没有待开始的维护计划' });
    await tx.update(maintenanceLogs).set(action === 'start' ? { status: 'ongoing', startedAt: new Date(),
      startedById: currentUser().userId, startedByName: currentUser().username, changes: changes(before, 'start', input.reason) } : {
      status: 'cancelled', endedAt: new Date(), endedById: currentUser().userId, endedByName: currentUser().username, endReason: input.reason, changes: changes(before, 'cancel', input.reason),
    }).where(eq(maintenanceLogs.id, before.current.id));
  });
}
export async function listMaintenanceLogs(q: QueryOutputOf<typeof maintenanceContract.logs>) {
  return listRows({ page: q.page, pageSize: q.pageSize, table: maintenanceLogs, where: buildWhere(
    q.status ? eq(maintenanceLogs.status, q.status) : undefined,
    keywordCondition(q.keyword, [maintenanceLogs.message, maintenanceLogs.reason, maintenanceLogs.startedByName]),
    ...dateRangeConditions(maintenanceLogs.createdAt, q.startTime, q.endTime)), orderBy: [desc(maintenanceLogs.id)], map: mapPeriod });
}
export async function getMaintenanceLog(id: number) {
  return mapPeriod(requireRow((await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.id, id)).limit(1))[0], '维护记录不存在'));
}
