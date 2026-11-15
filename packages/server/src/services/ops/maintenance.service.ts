import { eq, desc, inArray, isNull, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type * as z from 'zod';
import type { QueryOutputOf } from '@zenith/shared/core';
import { maintenanceContract, maintenanceLogSchema, publicMaintenanceStatusSchema, type MaintenanceStatus } from '@zenith/shared/ops';
import type { UpdateMaintenanceInput } from '@zenith/shared/ops/maintenance-validation';
import { db, readSnapshot } from '../../db';
import { maintenanceMode, maintenanceLogs, users } from '../../db/schema';
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
import { requireTenantUser } from '../../lib/user-nicknames';
import { notifyWithin } from '../messaging/notification-outbox.service';
import { maintenanceClockAction } from '@zenith/shared/ops/maintenance-lifecycle';
import { maintenanceAccess } from '../../lib/maintenance-access';
import { MAINTENANCE_EXCEPTIONS, MAINTENANCE_BOUNDARIES, maintenanceDecision } from './maintenance-access-policy';

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
    estimatedEndAt: current ? current.estimatedEndAt : (head?.estimatedEndAt ? formatDateTime(head.estimatedEndAt) : null),
    startedAt: current?.startedAt ?? null, startedByName: current?.startedByName ?? null,
    scheduledStartAt: current?.scheduledStartAt ?? null, autoEndAt: current?.autoEndAt ?? null,
    version: head?.version ?? 0, updatedAt: head ? formatDateTime(head.updatedAt) : null, current };
}
export function getMaintenanceStatus() { return cache.get('global', () => readSnapshot(snapshot)); }
export async function getPublicMaintenanceStatus() { return publicMaintenanceStatusSchema.parse(await getMaintenanceStatus()); }
export async function getMaintenanceDetail() {
  if (!(await maintenanceAccess(currentUser())).canView) throw new HTTPException(403, { message: '没有维护查看权限' });
  return getMaintenanceStatus();
}
async function assertLogReader() {
  if (!(await maintenanceAccess(currentUser())).canViewLogs) throw new HTTPException(403, { message: '没有维护记录查看权限' });
}

function parsed(value: string | null) {
  if (!value) return null;
  const date = parseDateTimeInput(value);
  if (!date || formatDateTime(date) !== value) throw new HTTPException(400, { message: '维护时间无效或不是有效的业务时区时间' });
  return date;
}
function changes(before: MaintenanceStatus, action: string, reason: string, message = before.message, estimatedEndAt = before.estimatedEndAt, autoEndAt = before.autoEndAt) {
  return [...(before.current?.changes ?? []), { action, reason, message, estimatedEndAt, autoEndAt, at: formatDateTime(new Date()), actor: currentUser().username }];
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
    const after = await snapshot(tx);
    const periodId = after.current?.id ?? before.current?.id;
    if (periodId) await notifyPeriod(tx, periodId, before.version + 1);
    return after;
  });
  invalidateMaintenanceCache();
  setAuditAfter(result);
  scheduleBroadcast({ type: 'maintenance:changed', payload: { version: result.version } });
  return result;
}

export async function updateMaintenanceStatus(input: UpdateMaintenanceInput) {
  const end = parsed(input.estimatedEndAt);
  const autoEndAt = parsed(input.autoEndAt);
  if (input.enabled && end && end <= new Date()) throw new HTTPException(400, { message: '预计结束时间必须晚于当前时间' });
  if (input.enabled && autoEndAt && autoEndAt <= new Date()) throw new HTTPException(400, { message: '自动恢复时间必须晚于当前时间' });
  return mutate(input.version, async (tx, before) => {
    if (before.current?.status === 'scheduled') throw new HTTPException(409, { message: '已有维护计划，请提前开始或取消计划后再操作' });
    await tx.update(maintenanceMode).set({ message: input.message, estimatedEndAt: end }).where(eq(maintenanceMode.key, 'global'));
    if (!before.enabled && input.enabled) {
      await tx.insert(maintenanceLogs).values({ status: 'ongoing', message: input.message, estimatedEndAt: end, autoEndAt, reason: input.reason, notifyUserIds: [currentUser().userId],
        startedAt: new Date(), startedById: currentUser().userId, startedByName: currentUser().username, changes: changes(before, 'start', input.reason, input.message, input.estimatedEndAt, input.autoEndAt) });
    } else if (before.enabled && before.current) {
      const now = new Date();
      await tx.update(maintenanceLogs).set(input.enabled ? { message: input.message, estimatedEndAt: end, autoEndAt, changes: changes(before, 'update', input.reason, input.message, input.estimatedEndAt, input.autoEndAt) } : {
        status: 'completed', endedAt: now, endedById: currentUser().userId, endedByName: currentUser().username, endReason: input.reason,
        durationSeconds: Math.max(0, Math.floor((now.getTime() - parsed(before.startedAt)!.getTime()) / 1000)), changes: changes(before, 'finish', input.reason),
      }).where(eq(maintenanceLogs.id, before.current.id));
    }
  });
}
export async function planMaintenance(input: z.output<typeof maintenanceContract.plan.body>) {
  await assertMaintenanceManager(currentUser());
  const recipients = [...new Set([...input.notifyUserIds, currentUser().userId])];
  await Promise.all(recipients.map((id) => requireTenantUser(id, '维护通知接收人必须是可见且启用的平台用户', { enabledOnly: true, tenantId: null })));
  const start = parsed(input.scheduledStartAt)!; const end = parsed(input.estimatedEndAt); const auto = parsed(input.autoEndAt);
  if (start <= new Date() || (end && end <= start) || (auto && auto <= start)) throw new HTTPException(400, { message: '维护计划时间顺序不正确' });
  return mutate(input.version, async (tx, before) => {
    if (before.current) throw new HTTPException(409, { message: '已有未结束的维护时段' });
    await tx.insert(maintenanceLogs).values({ status: 'scheduled', message: input.message, reason: input.reason, scheduledStartAt: start,
      estimatedEndAt: end, autoEndAt: auto, notifyUserIds: recipients, remindMinutes: input.remindMinutes,
      startedById: currentUser().userId, startedByName: currentUser().username, changes: changes(before, 'plan', input.reason, input.message, input.estimatedEndAt, input.autoEndAt) });
  });
}
export async function maintenanceAction(action: 'start' | 'cancel', input: z.output<typeof maintenanceContract.start.body>) {
  return mutate(input.version, async (tx, before) => {
    if (before.current?.status !== 'scheduled') throw new HTTPException(409, { message: '当前没有待开始的维护计划' });
    if (action === 'start' && ((parsed(before.autoEndAt)?.getTime() ?? Infinity) <= Date.now() || (parsed(before.estimatedEndAt)?.getTime() ?? Infinity) <= Date.now())) throw new HTTPException(409, { message: '维护计划窗口已过，请取消后重新安排' });
    await tx.update(maintenanceLogs).set(action === 'start' ? { status: 'ongoing', startedAt: new Date(),
      startedById: currentUser().userId, startedByName: currentUser().username, changes: changes(before, 'start', input.reason) } : {
      status: 'cancelled', endedAt: new Date(), endedById: currentUser().userId, endedByName: currentUser().username, endReason: input.reason, changes: changes(before, 'cancel', input.reason),
    }).where(eq(maintenanceLogs.id, before.current.id));
  });
}
export async function listMaintenanceLogs(q: QueryOutputOf<typeof maintenanceContract.logs>) {
  await assertLogReader();
  return listRows({ page: q.page, pageSize: q.pageSize, table: maintenanceLogs, where: buildWhere(
    q.status ? eq(maintenanceLogs.status, q.status) : undefined,
    keywordCondition(q.keyword, [maintenanceLogs.message, maintenanceLogs.reason, maintenanceLogs.startedByName]),
    ...dateRangeConditions(maintenanceLogs.createdAt, q.startTime, q.endTime)), orderBy: [desc(maintenanceLogs.id)], map: mapPeriod });
}
export async function getMaintenanceLog(id: number) {
  await assertLogReader();
  return mapPeriod(requireRow((await db.select().from(maintenanceLogs).where(eq(maintenanceLogs.id, id)).limit(1))[0], '维护记录不存在'));
}
export async function diagnoseMaintenance(input: z.output<typeof maintenanceContract.diagnose.body>) {
  const status = await getMaintenanceDetail();
  if (input.version !== status.version) throw new HTTPException(409, { message: '维护状态已变化，请重新诊断' });
  return { ...maintenanceDecision(status.enabled, input.method, input.path, await maintenanceAccess(currentUser())), version: status.version, exceptions: [...MAINTENANCE_EXCEPTIONS], boundaries: MAINTENANCE_BOUNDARIES };
}
export async function listMaintenanceRecipients() {
  await assertMaintenanceManager(currentUser());
  return db.select({ id: users.id, username: users.username, nickname: users.nickname }).from(users)
    .where(buildWhere(isNull(users.tenantId), eq(users.status, 'enabled'))).orderBy(users.username);
}
async function notifyPeriod(tx: DbExecutor, periodId: number, version: number) {
  const [period] = await tx.select().from(maintenanceLogs).where(eq(maintenanceLogs.id, periodId));
  if (!period) return;
  const labels: Record<string, string> = { plan: '已安排', start: '已开始', update: '说明或恢复时间已更新', finish: '已结束', cancel: '已取消' };
  await notifyWithin(tx, 'ops.maintenance.changed', { recipients: period.notifyUserIds.map((id) => ({ type: 'user' as const, id })),
    vars: { periodId, action: labels[period.changes.at(-1)?.action ?? 'update'] ?? '状态已变更', message: period.message,
      scheduledStartAt: period.scheduledStartAt ? formatDateTime(period.scheduledStartAt) : '立即', estimatedEndAt: period.estimatedEndAt ? formatDateTime(period.estimatedEndAt) : '待定' },
    tenantId: null, link: '/system/maintenance', dedupeKey: 'maintenance:' + periodId + ':version:' + version });
}

/** Durable minute scan. The same global lock fences HTTP actions, retries and concurrent workers. */
export async function runMaintenanceLifecycle() {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('maintenance:global',0))`);
    const before = await snapshot(tx);
    if (!before.current) return null;
    const [period] = await tx.select().from(maintenanceLogs).where(eq(maintenanceLogs.id, before.current.id));
    const now = new Date();
    const action = maintenanceClockAction({ ...period, scheduledStartAt: period.scheduledStartAt?.getTime() ?? null, estimatedEndAt: period.estimatedEndAt?.getTime() ?? null, autoEndAt: period.autoEndAt?.getTime() ?? null }, now.getTime());
    if (!action) return null;
    if (action === 'remind') {
      await notifyWithin(tx, 'ops.maintenance.reminder', { recipients: period.notifyUserIds.map((id) => ({ type: 'user' as const, id })),
        vars: { periodId: period.id, message: period.message, scheduledStartAt: formatDateTime(period.scheduledStartAt!) }, tenantId: null,
        link: '/system/maintenance', dedupeKey: 'maintenance:' + period.id + ':reminder' });
      await tx.update(maintenanceLogs).set({ reminderSent: true }).where(eq(maintenanceLogs.id, period.id));
      return { version: before.version, action };
    }
    const reason = action === 'cancel' ? '调度恢复时维护窗口已过，取消过期计划' : action === 'start' ? '计划开始时间已到' : '自动恢复时间已到';
    const change = { action, reason, at: formatDateTime(now), actor: '系统调度', message: period.message, estimatedEndAt: before.estimatedEndAt, autoEndAt: before.autoEndAt };
    await tx.update(maintenanceLogs).set(action === 'start' ? { status: 'ongoing', startedAt: now, changes: [...period.changes, change] } : {
      status: action === 'cancel' ? 'cancelled' : 'completed', endedAt: now, endedByName: '系统调度', endReason: reason,
      durationSeconds: period.startedAt ? Math.max(0, Math.floor((now.getTime() - period.startedAt.getTime()) / 1000)) : null, changes: [...period.changes, change],
    }).where(eq(maintenanceLogs.id, period.id));
    await tx.update(maintenanceMode).set({ version: before.version + 1 }).where(eq(maintenanceMode.key, 'global'));
    await notifyPeriod(tx, period.id, before.version + 1);
    return { version: before.version + 1, action };
  });
  if (result) { invalidateMaintenanceCache(); scheduleBroadcast({ type: 'maintenance:changed', payload: { version: result.version } }); }
  return result ? '维护调度：' + result.action : '无到期维护动作';
}
