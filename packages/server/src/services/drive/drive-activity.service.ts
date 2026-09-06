import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { tryGetContext } from 'hono/context-storage';
import type { DriveActivity, DriveActivityAction, DriveNodeType } from '@zenith/shared/drive';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { driveActivities, driveRecentAccess, driveSpaces, type DriveActivityRow } from '../../db/schema';
import { currentUserOrNull, isSuperAdmin, type AppEnv } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import { getClientIp } from '../../lib/request-helpers';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { getDataScopeCondition } from '../../lib/data-scope';
import { resolveUserNames } from './drive-common';

export interface LogDriveActivityInput {
  spaceId: number;
  nodeId: number | null;
  nodeName: string;
  nodeType: DriveNodeType;
  action: DriveActivityAction;
  detail?: Record<string, unknown> | null;
  shareId?: number | null;
  /** 缺省取当前登录用户；外链匿名访问传 null */
  actorId?: number | null;
  /** 缺省取当前用户租户；无请求上下文（保留策略）时由调用方传入 */
  tenantId?: number | null;
}

/** 追加一条文件动态（副作用与主事务同提交时传 executor） */
export async function logDriveActivity(input: LogDriveActivityInput, executor: DbExecutor = db): Promise<void> {
  const user = currentUserOrNull();
  const ctx = tryGetContext<AppEnv>();
  await executor.insert(driveActivities).values({
    spaceId: input.spaceId,
    nodeId: input.nodeId,
    nodeName: input.nodeName.slice(0, 255),
    nodeType: input.nodeType,
    action: input.action,
    actorId: input.actorId === undefined ? (user?.userId ?? null) : input.actorId,
    shareId: input.shareId ?? null,
    detail: input.detail ?? null,
    clientIp: ctx ? getClientIp(ctx).slice(0, 64) : null,
    tenantId: input.tenantId !== undefined ? input.tenantId : (user ? getCreateTenantId(user) : null),
  });
}

/** 记录「最近访问」（同一节点覆盖） */
export async function touchDriveRecent(nodeId: number, action: DriveActivityAction, executor: DbExecutor = db): Promise<void> {
  const user = currentUserOrNull();
  if (!user) return;
  await executor.insert(driveRecentAccess)
    .values({ userId: user.userId, nodeId, action, lastAccessAt: new Date() })
    .onConflictDoUpdate({
      target: [driveRecentAccess.userId, driveRecentAccess.nodeId],
      set: { action, lastAccessAt: new Date() },
    });
}

export function mapDriveActivity(row: DriveActivityRow, names: Map<number, string>, spaceNames?: Map<number, string>): DriveActivity {
  return {
    id: row.id,
    spaceId: row.spaceId,
    spaceName: spaceNames?.get(row.spaceId) ?? null,
    nodeId: row.nodeId ?? null,
    nodeName: row.nodeName,
    nodeType: row.nodeType,
    action: row.action,
    actorId: row.actorId ?? null,
    actorName: row.actorId ? names.get(row.actorId) ?? null : null,
    shareId: row.shareId ?? null,
    detail: row.detail ?? null,
    clientIp: row.clientIp ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export interface ListDriveActivitiesQuery {
  page?: number;
  pageSize?: number;
  spaceId?: number;
  nodeId?: number;
  actorId?: number;
  action?: DriveActivityAction;
  keyword?: string;
  startTime?: string;
  endTime?: string;
}

async function listActivitiesWhere(q: ListDriveActivitiesQuery, extra?: SQL): Promise<SQL | undefined> {
  const user = currentUserOrNull();
  return buildWhere(
    q.spaceId !== undefined ? eq(driveActivities.spaceId, q.spaceId) : undefined,
    q.nodeId !== undefined ? eq(driveActivities.nodeId, q.nodeId) : undefined,
    q.actorId !== undefined ? eq(driveActivities.actorId, q.actorId) : undefined,
    q.action ? eq(driveActivities.action, q.action) : undefined,
    keywordCondition(q.keyword, [driveActivities.nodeName], 'ilike'),
    ...dateRangeConditions(driveActivities.createdAt, q.startTime, q.endTime),
    user ? tenantCondition(driveActivities, user) : undefined,
    extra,
  );
}

async function paginateActivities(where: SQL | undefined, page: number, pageSize: number) {
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(driveActivities, where),
    rows: async () => {
      const rows = await withPagination(db.select().from(driveActivities).where(where).orderBy(desc(driveActivities.id)).$dynamic(), page, pageSize);
      const [names, spaceRows] = await Promise.all([
        resolveUserNames(rows.map((r) => r.actorId)),
        rows.length ? db.select({ id: driveSpaces.id, name: driveSpaces.name }).from(driveSpaces).where(inArray(driveSpaces.id, [...new Set(rows.map((r) => r.spaceId))])) : Promise.resolve([]),
      ]);
      const spaceNames = new Map(spaceRows.map((s) => [s.id, s.name]));
      return rows.map((r) => mapDriveActivity(r, names, spaceNames));
    },
  });
}

/** 节点动态（调用方已校验节点 viewer 权限） */
export async function listNodeActivities(nodeId: number, q: ListDriveActivitiesQuery) {
  const { page = 1, pageSize = 20 } = q;
  const where = await listActivitiesWhere({ ...q, nodeId });
  return paginateActivities(where, page, pageSize);
}

/**
 * 管理端全局动态：叠加数据权限（按空间归属部门 / 所有者收窄）。
 */
export async function listDriveActivitiesForAdmin(q: ListDriveActivitiesQuery) {
  const { page = 1, pageSize = 20 } = q;
  const user = currentUserOrNull();
  let scope: SQL | undefined;
  if (user && !isSuperAdmin()) {
    const scopeCondition = await getDataScopeCondition({
      currentUserId: user.userId,
      deptColumn: driveSpaces.departmentId,
      ownerColumn: driveSpaces.ownerId,
    });
    if (scopeCondition) {
      scope = inArray(driveActivities.spaceId, db.select({ id: driveSpaces.id }).from(driveSpaces).where(scopeCondition));
    }
  }
  const where = await listActivitiesWhere(q, scope);
  return paginateActivities(where, page, pageSize);
}

/** 统计某动作自 since 起的次数（管理统计用） */
export async function countActivitiesSince(action: DriveActivityAction, since: Date): Promise<number> {
  return db.$count(driveActivities, and(eq(driveActivities.action, action), sql`${driveActivities.createdAt} >= ${since}`));
}
