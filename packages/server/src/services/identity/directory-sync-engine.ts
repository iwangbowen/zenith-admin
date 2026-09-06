import { requireRow } from '../../lib/db-assert';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { CronExpressionParser } from 'cron-parser';
import { hashPassword } from '../../lib/password';
import crypto from 'node:crypto';
import { db } from '../../db';
import {
  departments, users, userRoles,
  directorySyncSources, directorySyncRuns, directorySyncRunItems,
  directorySyncConflicts, directorySyncUserLinks, directorySyncDeptLinks,
  type DirectorySyncSourceRow, type DirectorySyncUserLinkRow, type DirectorySyncDeptLinkRow,
  type NewDirectorySyncRunItem,
} from '../../db/schema';
import type { DirectorySyncRunStatus, DirectorySyncTriggerType } from '@zenith/shared/identity';
import { DIRECTORY_SYNC_FIELD_IGNORE } from '@zenith/shared/identity';
import { reserveTenantSeats } from '../../lib/tenant-quota';
import { exactTenantCondition } from '../../lib/tenant';
import { syncAllDynamicGroupsSafe } from './user-group-rules.service';
import logger from '../../lib/logger';
import { registerTaskHandler } from '../../lib/task-center';
import { currentUserOrNull } from '../../lib/context';
import { buildDirectoryConnector, type DirectoryExtDept, type DirectoryExtUser, type DirectorySnapshot } from './directory-sync-connectors';
import { forceLogoutAllUserSessions } from './sessions.service';
import { listPlatformSuperUserIds, resolveGrantableDefaultRoleIds } from './role-grant';

const SCHEDULE_TZ = 'Asia/Shanghai';

/** 熔断保护的最小基数：绑定人数低于该值时不触发熔断 */
const CIRCUIT_BREAKER_MIN_LINKS = 10;

export function computeNextRunAt(cronExpression: string | null | undefined, from = new Date()): Date | null {
  if (!cronExpression?.trim()) return null;
  try {
    return CronExpressionParser.parse(cronExpression.trim(), { currentDate: from, tz: SCHEDULE_TZ }).next().toDate();
  } catch {
    return null;
  }
}

interface RunOptions {
  trigger: DirectorySyncTriggerType;
  dryRun?: boolean;
  triggeredBy?: number | null;
  /** 阶段性进度上报；返回 true 表示已请求取消 */
  onProgress?: (note: string) => Promise<boolean>;
}

export interface DirectorySyncEngineResult {
  runId: number;
  status: DirectorySyncRunStatus;
  message: string;
}

interface PlannedDept {
  ext: DirectoryExtDept;
  action: 'create' | 'update' | 'skip';
  localId?: number;
  diff?: Record<string, { from: unknown; to: unknown }>;
}

interface PlannedUser {
  ext?: DirectoryExtUser;
  externalId: string;
  name: string;
  action: 'create' | 'update' | 'link' | 'disable' | 'skip' | 'conflict';
  localUserId?: number;
  diff?: Record<string, { from: unknown; to: unknown }>;
  message?: string;
  /** multi_match 候选 */
  candidateUserIds?: number[];
  /** field_conflict 的冲突字段 */
  conflictFields?: Record<string, { source: unknown; local: unknown }>;
  /** suspend 策略下可安全应用的字段 */
  safeUpdate?: Record<string, unknown>;
}

interface LocalUserLite {
  id: number;
  username: string;
  nickname: string;
  email: string | null;
  phone: string | null;
  departmentId: number | null;
  status: string;
}

function sanitizeCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
}

function tenantWhere(tenantId: number | null) {
  return exactTenantCondition(users.tenantId, tenantId);
}

/** 按 parent 先序拓扑排序；父节点缺失的按根处理 */
function topoSortDepts(depts: DirectoryExtDept[]): DirectoryExtDept[] {
  const byId = new Map(depts.map((d) => [d.externalId, d]));
  const sorted: DirectoryExtDept[] = [];
  const visited = new Set<string>();
  const visit = (dept: DirectoryExtDept, chain: Set<string>) => {
    if (visited.has(dept.externalId)) return;
    if (chain.has(dept.externalId)) return; // 环保护
    chain.add(dept.externalId);
    const parent = dept.parentExternalId ? byId.get(dept.parentExternalId) : undefined;
    if (parent) visit(parent, chain);
    chain.delete(dept.externalId);
    visited.add(dept.externalId);
    sorted.push(dept);
  };
  for (const dept of depts) visit(dept, new Set());
  return sorted;
}

/** 应用同步范围过滤 */
function applyScope(source: DirectorySyncSourceRow, snapshot: DirectorySnapshot): DirectorySnapshot {
  const scope = source.scopeConfig ?? {};
  let departments = snapshot.departments;
  let usersList = snapshot.users;
  if (scope.deptExternalIds && scope.deptExternalIds.length > 0) {
    const keep = new Set(scope.deptExternalIds);
    // BFS 收集子树
    let grew = true;
    while (grew) {
      grew = false;
      for (const dept of snapshot.departments) {
        if (!keep.has(dept.externalId) && dept.parentExternalId && keep.has(dept.parentExternalId)) {
          keep.add(dept.externalId);
          grew = true;
        }
      }
    }
    departments = snapshot.departments.filter((d) => keep.has(d.externalId));
    usersList = usersList.filter((u) => u.deptExternalIds.some((id) => keep.has(id)));
  }
  if (scope.excludeUserExternalIds && scope.excludeUserExternalIds.length > 0) {
    const excluded = new Set(scope.excludeUserExternalIds);
    usersList = usersList.filter((u) => !excluded.has(u.externalId));
  }
  return { departments, users: usersList };
}

/** 从上次源侧快照推导本地期望值，用于识别「本地是否被手工改过」 */
function snapshotLocalValue(snapshot: Record<string, unknown> | null, field: string): unknown {
  if (!snapshot) return undefined;
  return snapshot[field] ?? null;
}

async function upsertPendingConflict(input: {
  sourceId: number;
  runId: number;
  entityType: 'user' | 'department';
  externalId: string;
  name: string | null;
  conflictType: 'multi_match' | 'field_conflict';
  sourceData: Record<string, unknown> | null;
  localData: Record<string, unknown> | null;
  candidateUserIds: number[];
}): Promise<boolean> {
  const [existing] = await db.select({
    id: directorySyncConflicts.id,
    status: directorySyncConflicts.status,
    sourceData: directorySyncConflicts.sourceData,
  })
    .from(directorySyncConflicts)
    .where(and(
      eq(directorySyncConflicts.sourceId, input.sourceId),
      eq(directorySyncConflicts.entityType, input.entityType),
      eq(directorySyncConflicts.externalId, input.externalId),
    ))
    .orderBy(desc(directorySyncConflicts.id))
    .limit(1);
  if (existing && existing.status !== 'pending'
    && JSON.stringify(existing.sourceData ?? null) === JSON.stringify(input.sourceData ?? null)) {
    // 已裁决且源数据未变化：不重复挂起
    return false;
  }
  if (existing && existing.status === 'pending') {
    await db.update(directorySyncConflicts).set({
      runId: input.runId,
      name: input.name,
      conflictType: input.conflictType,
      sourceData: input.sourceData,
      localData: input.localData,
      candidateUserIds: input.candidateUserIds,
    }).where(eq(directorySyncConflicts.id, existing.id));
    return true;
  }
  await db.insert(directorySyncConflicts).values({
    sourceId: input.sourceId,
    runId: input.runId,
    entityType: input.entityType,
    externalId: input.externalId,
    name: input.name,
    conflictType: input.conflictType,
    sourceData: input.sourceData,
    localData: input.localData,
    candidateUserIds: input.candidateUserIds,
  });
  return true;
}

async function insertRunItems(items: NewDirectorySyncRunItem[]): Promise<void> {
  for (let i = 0; i < items.length; i += 500) {
    await db.insert(directorySyncRunItems).values(items.slice(i, i + 500));
  }
}

/** 执行一次通讯录同步（dryRun = 仅计算差异不落库） */
export async function runDirectorySync(sourceId: number, opts: RunOptions): Promise<DirectorySyncEngineResult> {
  const source = requireRow(await db.query.directorySyncSources.findFirst({ where: eq(directorySyncSources.id, sourceId) }), '同步源不存在');
  if (source.type === 'scim') throw new HTTPException(400, { message: 'SCIM 源为 IdP 推送模式，无需拉取同步' });

  const running = await db.$count(directorySyncRuns, and(
    eq(directorySyncRuns.sourceId, sourceId),
    eq(directorySyncRuns.status, 'running'),
  ));
  if (running > 0) throw new HTTPException(400, { message: '该同步源已有进行中的同步，请稍后再试' });

  const dryRun = opts.dryRun ?? false;
  const startedAt = new Date();
  const [run] = await db.insert(directorySyncRuns).values({
    sourceId,
    triggerType: opts.trigger,
    dryRun,
    status: 'running',
    triggeredBy: opts.triggeredBy ?? null,
    startedAt,
    message: '同步中',
  }).returning();

  const finalize = async (status: DirectorySyncRunStatus, patch: Partial<typeof directorySyncRuns.$inferInsert>, message: string) => {
    await db.update(directorySyncRuns).set({ ...patch, status, message, finishedAt: new Date() }).where(eq(directorySyncRuns.id, run.id));
    if (!dryRun) {
      await db.update(directorySyncSources).set({
        lastRunAt: startedAt,
        lastRunStatus: status,
        nextRunAt: computeNextRunAt(source.cronExpression),
      }).where(eq(directorySyncSources.id, sourceId));
    }
    return { runId: run.id, status, message };
  };

  try {
    if (await opts.onProgress?.('正在从源侧拉取组织与人员…')) {
      return finalize('failed', {}, '同步已取消');
    }
    const connector = buildDirectoryConnector(source);
    const snapshot = applyScope(source, await connector.fetch());
    const totalFetched = snapshot.users.length + snapshot.departments.length;

    if (await opts.onProgress?.(`拉取完成：${snapshot.departments.length} 个部门、${snapshot.users.length} 个用户，正在计算差异…`)) {
      return finalize('failed', { totalFetched }, '同步已取消');
    }

    // ─── 部门规划 ────────────────────────────────────────────────────────────
    const deptLinks = await db.select().from(directorySyncDeptLinks).where(eq(directorySyncDeptLinks.sourceId, sourceId));
    const deptLinkByExt = new Map<string, DirectorySyncDeptLinkRow>(deptLinks.map((l) => [l.externalId, l]));
    const linkedDeptIds = deptLinks.map((l) => l.departmentId);
    const localDepts = linkedDeptIds.length > 0
      ? await db.select({ id: departments.id, name: departments.name, parentId: departments.parentId })
        .from(departments).where(inArray(departments.id, linkedDeptIds))
      : [];
    const localDeptById = new Map(localDepts.map((d) => [d.id, d]));

    const plannedDepts: PlannedDept[] = [];
    if (source.syncDepartments) {
      const sortedDepts = topoSortDepts(snapshot.departments);
      // 先建 extId → 已有本地 ID 映射，创建动作在应用阶段补齐
      const extToLocal = new Map<string, number>();
      for (const [extId, link] of deptLinkByExt) extToLocal.set(extId, link.departmentId);
      for (const ext of sortedDepts) {
        const link = deptLinkByExt.get(ext.externalId);
        if (!link || !localDeptById.has(link.departmentId)) {
          plannedDepts.push({ ext, action: 'create' });
          continue;
        }
        const local = localDeptById.get(link.departmentId)!;
        const expectedParentId = ext.parentExternalId ? (extToLocal.get(ext.parentExternalId) ?? null) : 0;
        const diff: Record<string, { from: unknown; to: unknown }> = {};
        if (local.name !== ext.name) diff.name = { from: local.name, to: ext.name };
        if (expectedParentId !== null && local.parentId !== expectedParentId) {
          diff.parentId = { from: local.parentId, to: expectedParentId };
        }
        plannedDepts.push(Object.keys(diff).length > 0
          ? { ext, action: 'update', localId: local.id, diff }
          : { ext, action: 'skip', localId: local.id });
      }
    }

    // ─── 用户规划 ────────────────────────────────────────────────────────────
    const userLinks = await db.select().from(directorySyncUserLinks).where(eq(directorySyncUserLinks.sourceId, sourceId));
    const userLinkByExt = new Map<string, DirectorySyncUserLinkRow>(userLinks.map((l) => [l.externalId, l]));
    const localUsers: LocalUserLite[] = await db.select({
      id: users.id, username: users.username, nickname: users.nickname,
      email: users.email, phone: users.phone, departmentId: users.departmentId, status: users.status,
    }).from(users).where(tenantWhere(source.tenantId));
    const localUserById = new Map(localUsers.map((u) => [u.id, u]));
    // 平台超管永不作为自动关联候选：目录侧同名 / 同邮箱 / 同手机的条目一律按新建处理（由唯一约束兜底）
    const platformSuperUserIds = await listPlatformSuperUserIds();
    const matchIndex = new Map<string, number[]>();
    for (const u of localUsers) {
      if (platformSuperUserIds.has(u.id)) continue;
      const key = source.matchKey === 'phone' ? u.phone : source.matchKey === 'email' ? u.email : u.username;
      if (!key) continue;
      const ids = matchIndex.get(key) ?? [];
      ids.push(u.id);
      matchIndex.set(key, ids);
    }

    const activeExtUsers = snapshot.users.filter((u) => u.active);
    const presentExtIds = new Set(activeExtUsers.map((u) => u.externalId));
    const plannedUsers: PlannedUser[] = [];

    // 字段映射：本地字段 → 源侧标准字段（缺省同名）或 __ignore__（不同步该字段）
    const fieldMapping = source.fieldMapping ?? {};
    const resolveMapped = (ext: DirectoryExtUser, localField: 'username' | 'nickname' | 'email' | 'phone'): string | null => {
      const sourceField = fieldMapping[localField] ?? localField;
      if (sourceField === DIRECTORY_SYNC_FIELD_IGNORE) return null;
      const value = (ext as unknown as Record<string, unknown>)[sourceField];
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    };
    const fieldIgnored = (localField: string) => fieldMapping[localField] === DIRECTORY_SYNC_FIELD_IGNORE;

    for (const ext of activeExtUsers) {
      const link = userLinkByExt.get(ext.externalId);
      const desired: Record<string, unknown> = {};
      if (!fieldIgnored('nickname')) {
        const nickname = resolveMapped(ext, 'nickname');
        if (nickname) desired.nickname = nickname;
      }
      if (!fieldIgnored('email')) {
        const email = resolveMapped(ext, 'email');
        if (email) desired.email = email;
      }
      if (!fieldIgnored('phone')) {
        const phone = resolveMapped(ext, 'phone');
        if (phone) desired.phone = phone;
      }

      if (link && localUserById.has(link.userId)) {
        const local = localUserById.get(link.userId)!;
        const changed: Record<string, { from: unknown; to: unknown }> = {};
        for (const [field, value] of Object.entries(desired)) {
          const localValue = (local as unknown as Record<string, unknown>)[field] ?? null;
          if (localValue !== value) changed[field] = { from: localValue, to: value };
        }
        if (Object.keys(changed).length === 0) {
          plannedUsers.push({ ext, externalId: ext.externalId, name: ext.nickname, action: 'skip', localUserId: local.id, message: '无变更' });
          continue;
        }
        if (source.conflictPolicy === 'local') {
          plannedUsers.push({ ext, externalId: ext.externalId, name: ext.nickname, action: 'skip', localUserId: local.id, message: '本地优先策略，保留本地值', diff: changed });
          continue;
        }
        if (source.conflictPolicy === 'source' || !link.externalData) {
          plannedUsers.push({ ext, externalId: ext.externalId, name: ext.nickname, action: 'update', localUserId: local.id, diff: changed });
          continue;
        }
        // suspend：本地被手工改过的字段挂起，其余照常应用
        const conflictFields: Record<string, { source: unknown; local: unknown }> = {};
        const safeUpdate: Record<string, unknown> = {};
        for (const [field, delta] of Object.entries(changed)) {
          const lastSynced = snapshotLocalValue(link.externalData, field);
          if (lastSynced !== undefined && lastSynced !== delta.from) {
            conflictFields[field] = { source: delta.to, local: delta.from };
          } else {
            safeUpdate[field] = delta.to;
          }
        }
        if (Object.keys(conflictFields).length > 0) {
          plannedUsers.push({
            ext, externalId: ext.externalId, name: ext.nickname, action: 'conflict', localUserId: local.id,
            diff: changed, conflictFields, safeUpdate,
            message: `字段 ${Object.keys(conflictFields).join('、')} 两侧均有修改，已挂起待裁决`,
          });
        } else {
          plannedUsers.push({ ext, externalId: ext.externalId, name: ext.nickname, action: 'update', localUserId: local.id, diff: changed });
        }
        continue;
      }

      // 未绑定：按匹配键匹配本地账号
      const matchValue = source.matchKey === 'phone' ? ext.phone : source.matchKey === 'email' ? ext.email : ext.username;
      const candidates = matchValue ? (matchIndex.get(matchValue) ?? []) : [];
      if (candidates.length > 1) {
        plannedUsers.push({
          ext, externalId: ext.externalId, name: ext.nickname, action: 'conflict',
          candidateUserIds: candidates,
          message: `按${source.matchKey}匹配到 ${candidates.length} 个本地账号，已挂起待裁决`,
        });
      } else if (candidates.length === 1) {
        plannedUsers.push({ ext, externalId: ext.externalId, name: ext.nickname, action: 'link', localUserId: candidates[0] });
      } else {
        plannedUsers.push({ ext, externalId: ext.externalId, name: ext.nickname, action: 'create' });
      }
    }

    // 源侧消失或停用 → 生命周期处理（范围排除的人员不按离职处理）
    const excludedExtIds = new Set(source.scopeConfig?.excludeUserExternalIds ?? []);
    const lifecycle = source.lifecycle ?? { disableOnLeave: true, kickSessions: true, defaultRoleIds: [] };
    for (const link of userLinks) {
      if (presentExtIds.has(link.externalId)) continue;
      if (excludedExtIds.has(link.externalId)) continue;
      const local = localUserById.get(link.userId);
      if (!local) continue;
      const name = local.nickname || local.username;
      if (!lifecycle.disableOnLeave) {
        plannedUsers.push({ externalId: link.externalId, name, action: 'skip', localUserId: local.id, message: '源侧已移除；按策略保留本地账号' });
      } else if (local.status === 'disabled') {
        plannedUsers.push({ externalId: link.externalId, name, action: 'skip', localUserId: local.id, message: '源侧已移除；本地账号已是禁用状态' });
      } else {
        plannedUsers.push({ externalId: link.externalId, name, action: 'disable', localUserId: local.id, diff: { status: { from: local.status, to: 'disabled' } } });
      }
    }

    // ─── 熔断保护 ────────────────────────────────────────────────────────────
    const plannedDisables = plannedUsers.filter((p) => p.action === 'disable').length;
    if (userLinks.length >= CIRCUIT_BREAKER_MIN_LINKS
      && plannedDisables * 100 > userLinks.length * source.circuitBreakerPercent) {
      const message = `已熔断：本次计划禁用 ${plannedDisables} 人，超过已绑定 ${userLinks.length} 人的 ${source.circuitBreakerPercent}% 阈值，疑似源侧误操作，未应用任何变更`;
      const items: NewDirectorySyncRunItem[] = plannedUsers
        .filter((p) => p.action === 'disable')
        .map((p) => ({
          runId: run.id, entityType: 'user', externalId: p.externalId, name: p.name,
          action: 'disable', applied: false, diff: p.diff ?? null, message: '熔断中止，未应用',
        }));
      await insertRunItems(items);
      return await finalize('aborted', { totalFetched, userDisabled: 0, failedCount: 0 }, message);
    }

    if (await opts.onProgress?.('差异计算完成，正在应用变更…')) {
      return finalize('failed', { totalFetched }, '同步已取消');
    }

    // ─── 应用阶段 ────────────────────────────────────────────────────────────
    const stats = { deptCreated: 0, deptUpdated: 0, userCreated: 0, userLinked: 0, userUpdated: 0, userDisabled: 0, skipped: 0, conflictCount: 0, failedCount: 0 };
    const items: NewDirectorySyncRunItem[] = [];
    const extToLocalDept = new Map<string, number>();
    for (const [extId, link] of deptLinkByExt) extToLocalDept.set(extId, link.departmentId);

    for (const plan of plannedDepts) {
      const base = { runId: run.id, entityType: 'department' as const, externalId: plan.ext.externalId, name: plan.ext.name };
      if (plan.action === 'skip') {
        continue;
      }
      if (dryRun) {
        items.push({ ...base, action: plan.action, applied: false, diff: plan.diff ?? null, message: '预览' });
        if (plan.action === 'create') stats.deptCreated += 1; else stats.deptUpdated += 1;
        continue;
      }
      try {
        if (plan.action === 'create') {
          const parentId = plan.ext.parentExternalId ? (extToLocalDept.get(plan.ext.parentExternalId) ?? 0) : 0;
          const created = await db.transaction(async (tx) => {
            const [dept] = await tx.insert(departments).values({
              parentId,
              name: plan.ext.name.slice(0, 64),
              code: sanitizeCode(`ds${sourceId}-${plan.ext.externalId}`),
              sort: plan.ext.sort ?? 0,
              tenantId: source.tenantId,
            }).returning();
            await tx.insert(directorySyncDeptLinks).values({
              sourceId, externalId: plan.ext.externalId, departmentId: dept.id, lastSeenAt: new Date(),
            });
            return dept;
          });
          extToLocalDept.set(plan.ext.externalId, created.id);
          stats.deptCreated += 1;
          items.push({ ...base, action: 'create', applied: true, diff: null, message: null });
        } else {
          const parentId = plan.ext.parentExternalId ? (extToLocalDept.get(plan.ext.parentExternalId) ?? 0) : 0;
          await db.update(departments).set({ name: plan.ext.name.slice(0, 64), parentId }).where(eq(departments.id, plan.localId!));
          await db.update(directorySyncDeptLinks).set({ lastSeenAt: new Date() })
            .where(and(eq(directorySyncDeptLinks.sourceId, sourceId), eq(directorySyncDeptLinks.externalId, plan.ext.externalId)));
          stats.deptUpdated += 1;
          items.push({ ...base, action: 'update', applied: true, diff: plan.diff ?? null, message: null });
        }
      } catch (err) {
        stats.failedCount += 1;
        items.push({ ...base, action: 'fail', applied: false, diff: plan.diff ?? null, message: err instanceof Error ? err.message : '应用失败' });
      }
    }

    const resolvePrimaryDeptId = (ext: DirectoryExtUser | undefined): number | null => {
      if (!source.syncDepartments || !ext || ext.deptExternalIds.length === 0) return null;
      return extToLocalDept.get(ext.deptExternalIds[0]) ?? null;
    };

    const linkSnapshot = (ext: DirectoryExtUser) => ({
      username: ext.username, nickname: ext.nickname, email: ext.email, phone: ext.phone,
      deptExternalIds: ext.deptExternalIds,
    });

    const usedUsernames = new Set(localUsers.map((u) => u.username));

    for (const plan of plannedUsers) {
      const base = { runId: run.id, entityType: 'user' as const, externalId: plan.externalId, name: plan.name };
      if (plan.action === 'skip') {
        stats.skipped += 1;
        items.push({ ...base, action: 'skip', applied: false, diff: plan.diff ?? null, message: plan.message ?? null });
        continue;
      }
      if (dryRun) {
        if (plan.action === 'conflict') stats.conflictCount += 1;
        else if (plan.action === 'create') stats.userCreated += 1;
        else if (plan.action === 'link') stats.userLinked += 1;
        else if (plan.action === 'update') stats.userUpdated += 1;
        else if (plan.action === 'disable') stats.userDisabled += 1;
        items.push({ ...base, action: plan.action, applied: false, diff: plan.diff ?? null, message: plan.message ?? '预览' });
        continue;
      }
      try {
        switch (plan.action) {
          case 'create': {
            const ext = plan.ext!;
            let username = (resolveMapped(ext, 'username') ?? ext.username).slice(0, 32);
            if (usedUsernames.has(username)) username = `${username.slice(0, 24)}_${ext.externalId.slice(0, 6)}`.slice(0, 32);
            const password = await hashPassword(crypto.randomBytes(32).toString('hex'));
            await db.transaction(async (tx) => {
              await reserveTenantSeats(tx, source.tenantId);
              const [created] = await tx.insert(users).values({
                username,
                nickname: (resolveMapped(ext, 'nickname') ?? ext.nickname).slice(0, 32),
                email: fieldIgnored('email') ? null : resolveMapped(ext, 'email'),
                phone: fieldIgnored('phone') ? null : resolveMapped(ext, 'phone'),
                password,
                tenantId: source.tenantId,
                departmentId: resolvePrimaryDeptId(ext),
              }).returning();
              await tx.insert(directorySyncUserLinks).values({
                sourceId, externalId: ext.externalId, userId: created.id,
                externalData: linkSnapshot(ext), lastSeenAt: new Date(),
              });
              const roleIds = await resolveGrantableDefaultRoleIds(lifecycle.defaultRoleIds, source.tenantId, tx);
              if (roleIds.length > 0) {
                await tx.insert(userRoles).values(roleIds.map((roleId) => ({ userId: created.id, roleId }))).onConflictDoNothing();
              }
            });
            usedUsernames.add(username);
            stats.userCreated += 1;
            items.push({ ...base, action: 'create', applied: true, diff: null, message: null });
            break;
          }
          case 'link': {
            const ext = plan.ext!;
            const deptId = resolvePrimaryDeptId(ext);
            await db.transaction(async (tx) => {
              await tx.insert(directorySyncUserLinks).values({
                sourceId, externalId: ext.externalId, userId: plan.localUserId!,
                externalData: linkSnapshot(ext), lastSeenAt: new Date(),
              });
              const patch: Record<string, unknown> = {};
              const linkNickname = fieldIgnored('nickname') ? null : resolveMapped(ext, 'nickname');
              if (linkNickname) patch.nickname = linkNickname.slice(0, 32);
              const linkEmail = fieldIgnored('email') ? null : resolveMapped(ext, 'email');
              if (linkEmail) patch.email = linkEmail;
              const linkPhone = fieldIgnored('phone') ? null : resolveMapped(ext, 'phone');
              if (linkPhone) patch.phone = linkPhone;
              if (deptId) patch.departmentId = deptId;
              if (Object.keys(patch).length > 0) {
                await tx.update(users).set(patch).where(eq(users.id, plan.localUserId!));
              }
            });
            stats.userLinked += 1;
            items.push({ ...base, action: 'link', applied: true, diff: plan.diff ?? null, message: null });
            break;
          }
          case 'update': {
            const ext = plan.ext!;
            const deptId = resolvePrimaryDeptId(ext);
            const patch: Record<string, unknown> = {};
            for (const [field, delta] of Object.entries(plan.diff ?? {})) patch[field] = delta.to;
            if (deptId && localUserById.get(plan.localUserId!)?.departmentId !== deptId) patch.departmentId = deptId;
            await db.update(users).set(patch).where(eq(users.id, plan.localUserId!));
            await db.update(directorySyncUserLinks).set({ externalData: linkSnapshot(ext), lastSeenAt: new Date() })
              .where(and(eq(directorySyncUserLinks.sourceId, sourceId), eq(directorySyncUserLinks.externalId, plan.externalId)));
            stats.userUpdated += 1;
            items.push({ ...base, action: 'update', applied: true, diff: plan.diff ?? null, message: null });
            break;
          }
          case 'disable': {
            await db.update(users).set({ status: 'disabled' }).where(eq(users.id, plan.localUserId!));
            if (lifecycle.kickSessions) {
              await forceLogoutAllUserSessions(plan.localUserId!).catch((err) => {
                logger.warn(`[directory-sync] 强制下线用户 ${plan.localUserId} 失败`, err);
              });
            }
            stats.userDisabled += 1;
            items.push({ ...base, action: 'disable', applied: true, diff: plan.diff ?? null, message: '源侧已移除，账号已禁用' });
            break;
          }
          case 'conflict': {
            const suspended = await upsertPendingConflict({
              sourceId,
              runId: run.id,
              entityType: 'user',
              externalId: plan.externalId,
              name: plan.name,
              conflictType: plan.candidateUserIds ? 'multi_match' : 'field_conflict',
              sourceData: plan.ext ? linkSnapshot(plan.ext) : null,
              localData: plan.conflictFields
                ? Object.fromEntries(Object.entries(plan.conflictFields).map(([f, v]) => [f, v.local]))
                : (plan.localUserId ? { userId: plan.localUserId } : null),
              candidateUserIds: plan.candidateUserIds ?? [],
            });
            // suspend 策略下无冲突的字段照常应用
            if (plan.localUserId && plan.safeUpdate && Object.keys(plan.safeUpdate).length > 0) {
              await db.update(users).set(plan.safeUpdate).where(eq(users.id, plan.localUserId));
            }
            if (plan.ext && plan.localUserId) {
              await db.update(directorySyncUserLinks).set({ lastSeenAt: new Date() })
                .where(and(eq(directorySyncUserLinks.sourceId, sourceId), eq(directorySyncUserLinks.externalId, plan.externalId)));
            }
            if (suspended) {
              stats.conflictCount += 1;
              items.push({ ...base, action: 'conflict', applied: false, diff: plan.diff ?? null, message: plan.message ?? null });
            } else {
              stats.skipped += 1;
              items.push({ ...base, action: 'skip', applied: false, diff: plan.diff ?? null, message: '差异已人工裁决且源数据未变化，跳过' });
            }
            break;
          }
        }
      } catch (err) {
        stats.failedCount += 1;
        items.push({ ...base, action: 'fail', applied: false, diff: plan.diff ?? null, message: err instanceof Error ? err.message : '应用失败' });
      }
    }

    await insertRunItems(items);

    // 目录同步可能批量改动部门/状态等动态组条件属性，运行后整体校准一次
    if (!dryRun && stats.userCreated + stats.userLinked + stats.userUpdated + stats.userDisabled > 0) {
      syncAllDynamicGroupsSafe('目录同步');
    }

    const status: DirectorySyncRunStatus = stats.failedCount > 0 ? 'partial' : 'success';
    const summary = dryRun
      ? `预览完成：将新增 ${stats.userCreated}、绑定 ${stats.userLinked}、更新 ${stats.userUpdated}、禁用 ${stats.userDisabled}，部门新增 ${stats.deptCreated}、更新 ${stats.deptUpdated}，冲突 ${stats.conflictCount}`
      : `同步完成：新增 ${stats.userCreated}、绑定 ${stats.userLinked}、更新 ${stats.userUpdated}、禁用 ${stats.userDisabled}，部门新增 ${stats.deptCreated}、更新 ${stats.deptUpdated}，冲突 ${stats.conflictCount}，失败 ${stats.failedCount}`;
    return await finalize(status, { totalFetched, ...stats }, summary);
  } catch (err) {
    const message = `同步失败：${err instanceof Error ? err.message : '未知错误'}`;
    logger.error(`[directory-sync] source ${sourceId} 同步失败`, err);
    return await finalize('failed', { errorMessage: err instanceof Error ? err.message : String(err) }, message);
  }
}

/** 系统调度 tick：扫描到期（cron 到点或收到平台回调事件）的启用同步源并顺序执行 */
export async function scanDueDirectorySyncSources(): Promise<string> {
  const now = new Date();
  const candidates = await db.select().from(directorySyncSources)
    .where(eq(directorySyncSources.status, 'enabled'));
  const due: Array<{ source: DirectorySyncSourceRow; trigger: 'schedule' | 'callback' }> = [];
  for (const source of candidates) {
    if (source.type === 'scim') continue; // 推送型源不做拉取
    const callbackDue = source.pendingCallbackSync;
    let cronDue = false;
    if (source.cronExpression?.trim()) {
      if (!source.nextRunAt) {
        // 首次启用：只登记下次时间，不立即执行
        await db.update(directorySyncSources)
          .set({ nextRunAt: computeNextRunAt(source.cronExpression) })
          .where(and(eq(directorySyncSources.id, source.id), isNull(directorySyncSources.nextRunAt)));
      } else if (source.nextRunAt <= now) {
        cronDue = true;
      }
    }
    if (cronDue || callbackDue) {
      due.push({ source, trigger: cronDue ? 'schedule' : 'callback' });
    }
  }
  if (due.length === 0) return '无到期的同步源';

  const results: string[] = [];
  for (const { source, trigger } of due) {
    // 先复位回调标记：运行期间新到的事件会重新置位，下一轮 tick 再消费
    if (source.pendingCallbackSync) {
      await db.update(directorySyncSources).set({ pendingCallbackSync: false })
        .where(eq(directorySyncSources.id, source.id));
    }
    try {
      const result = await runDirectorySync(source.id, { trigger, triggeredBy: null });
      results.push(`「${source.name}」${result.message}`);
    } catch (err) {
      // 已在运行等业务性拒绝：推进 nextRunAt 防止 tick 空转
      await db.update(directorySyncSources)
        .set({ nextRunAt: computeNextRunAt(source.cronExpression) })
        .where(and(eq(directorySyncSources.id, source.id), lte(directorySyncSources.nextRunAt, now)));
      results.push(`「${source.name}」跳过：${err instanceof Error ? err.message : '未知错误'}`);
    }
  }
  return results.join('；');
}

export const DIRECTORY_SYNC_TASK_TYPE = 'directory-sync-run';

/** 任务中心 handler：承接手动同步与差异预览 */
export function registerDirectorySyncTaskHandlers(): void {
  registerTaskHandler({
    taskType: DIRECTORY_SYNC_TASK_TYPE,
    title: '通讯录同步',
    module: '通讯录同步',
    description: '手动触发的通讯录同步 / 差异预览',
    allowConcurrent: false,
    maxAttempts: 1,
    async run(ctx) {
      const sourceId = Number(ctx.payload.sourceId);
      if (!Number.isInteger(sourceId) || sourceId <= 0) throw new Error('缺少有效的 sourceId');
      const dryRun = ctx.payload.dryRun === true;
      const user = currentUserOrNull();
      const result = await runDirectorySync(sourceId, {
        trigger: dryRun ? 'preview' : 'manual',
        dryRun,
        triggeredBy: user?.userId ?? null,
        onProgress: async (note) => {
          const { cancelRequested } = await ctx.progress({ note, total: null });
          return cancelRequested;
        },
      });
      // 业务失败透传给任务中心，托盘与任务列表如实显示失败
      if (result.status === 'failed' || result.status === 'aborted') {
        throw new Error(result.message);
      }
      return { runId: result.runId, status: result.status, message: result.message };
    },
  });
}
