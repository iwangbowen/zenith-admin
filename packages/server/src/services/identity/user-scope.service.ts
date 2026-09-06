import { buildListResult } from '../../lib/list-query';
/**
 * 「成员预览」统一查询：部门 / 角色 / 岗位 / 用户组 → 分页 + 关键字搜索的用户列表。
 *
 * 与各域已有的 `/{id}/members`、`/{id}/users` 是两类东西，不能合并：
 * 那几个返回**全量数组**，供「分配成员」抽屉预选当前成员，改成分页会让预选只勾上第一页。
 * 本模块只服务于列表页「成员」列的查看弹窗，故独立成一套分页接口。
 *
 * 四个域返回同一形状（id / username / nickname / avatar），前端因此只需要一个组件与一套渲染，
 * 不必按来源分支——各域原有 DTO 字段并不一致（岗位只有头像+昵称，用户组另有邮箱与加入时间）。
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { UserPreview } from '@zenith/shared/identity';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import {
  departments,
  positions,
  roles,
  userGroups,
  users,
  userRoles,
  userPositions,
  userGroupMembers,
} from '../../db/schema';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { exactTenantCondition, tenantScope } from '../../lib/tenant';

/** 成员归属范围 */
export type UserScopeType = 'department' | 'role' | 'position' | 'userGroup';
export const USER_PREVIEW_LIMIT = 5;

export interface ScopeMemberQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

export interface ScopeMemberItem {
  id: number;
  username: string;
  nickname: string;
  avatar: string | null;
}

export interface ScopeMemberSummary {
  count: number;
  preview: UserPreview[];
}

export interface ScopeMemberSummaryRow extends Record<string, unknown> {
  scopeId: number;
  id: number;
  nickname: string;
  avatar: string | null;
  count: number;
}

/**
 * 归属条件。
 * 关联表都只有 (userId, xxxId) 两列且以 xxxId 建了索引，用 IN 子查询而非 JOIN：
 * 一个用户在同一范围内只可能出现一次，JOIN 不会放大行数，但子查询让分页的 count
 * 与 list 共用同一条件、少一次连接。
 */
function scopeCondition(scopeType: UserScopeType, scopeId: number): SQL {
  switch (scopeType) {
    case 'department':
      return eq(users.departmentId, scopeId);
    case 'role':
      return inArray(users.id, db.select({ id: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, scopeId)));
    case 'position':
      return inArray(users.id, db.select({ id: userPositions.userId }).from(userPositions).where(eq(userPositions.positionId, scopeId)));
    case 'userGroup':
      return inArray(users.id, db.select({ id: userGroupMembers.userId }).from(userGroupMembers).where(eq(userGroupMembers.groupId, scopeId)));
    default: {
      // 穷尽性检查：新增范围类型时此处编译失败，避免漏实现后静默返回全部用户
      const exhaustive: never = scopeType;
      throw new Error(`不支持的成员范围：${String(exhaustive)}`);
    }
  }
}

function scopeMemberSource(scopeType: UserScopeType, scopeIds: number[]): SQL {
  const tenant = tenantScope(users);
  const tenantFilter = tenant ? sql` AND ${tenant}` : sql``;

  switch (scopeType) {
    case 'department':
      return sql`
        SELECT ${departments.id} AS scope_id, ${users.id} AS user_id,
               ${users.nickname} AS nickname, ${users.avatar} AS avatar
        FROM ${users}
        INNER JOIN ${departments} ON ${eq(departments.id, users.departmentId)}
        WHERE ${inArray(departments.id, scopeIds)}
          AND ${users.tenantId} IS NOT DISTINCT FROM ${departments.tenantId}${tenantFilter}
      `;
    case 'role':
      return sql`
        SELECT ${userRoles.roleId} AS scope_id, ${users.id} AS user_id,
               ${users.nickname} AS nickname, ${users.avatar} AS avatar
        FROM ${userRoles}
        INNER JOIN ${users} ON ${eq(users.id, userRoles.userId)}
        INNER JOIN ${roles} ON ${eq(roles.id, userRoles.roleId)}
        WHERE ${inArray(userRoles.roleId, scopeIds)}
          AND ${users.tenantId} IS NOT DISTINCT FROM ${roles.tenantId}${tenantFilter}
      `;
    case 'position':
      return sql`
        SELECT ${userPositions.positionId} AS scope_id, ${users.id} AS user_id,
               ${users.nickname} AS nickname, ${users.avatar} AS avatar
        FROM ${userPositions}
        INNER JOIN ${users} ON ${eq(users.id, userPositions.userId)}
        INNER JOIN ${positions} ON ${eq(positions.id, userPositions.positionId)}
        WHERE ${inArray(userPositions.positionId, scopeIds)}
          AND ${users.tenantId} IS NOT DISTINCT FROM ${positions.tenantId}${tenantFilter}
      `;
    case 'userGroup':
      return sql`
        SELECT ${userGroupMembers.groupId} AS scope_id, ${users.id} AS user_id,
               ${users.nickname} AS nickname, ${users.avatar} AS avatar
        FROM ${userGroupMembers}
        INNER JOIN ${users} ON ${eq(users.id, userGroupMembers.userId)}
        INNER JOIN ${userGroups} ON ${eq(userGroups.id, userGroupMembers.groupId)}
        WHERE ${inArray(userGroupMembers.groupId, scopeIds)}
          AND ${users.tenantId} IS NOT DISTINCT FROM ${userGroups.tenantId}${tenantFilter}
      `;
    default: {
      const exhaustive: never = scopeType;
      throw new Error(`不支持的成员范围：${String(exhaustive)}`);
    }
  }
}

export function buildScopeMemberSummaryMap(
  rows: readonly ScopeMemberSummaryRow[],
): Map<number, ScopeMemberSummary> {
  const summaries = new Map<number, ScopeMemberSummary>();
  for (const row of rows) {
    let summary = summaries.get(row.scopeId);
    if (!summary) {
      summary = { count: Number(row.count), preview: [] };
      summaries.set(row.scopeId, summary);
    }
    if (summary.preview.length < USER_PREVIEW_LIMIT) {
      summary.preview.push({
        id: row.id,
        nickname: row.nickname,
        avatar: row.avatar ?? null,
      });
    }
  }
  return summaries;
}

/**
 * 批量读取多个部门 / 角色 / 岗位 / 用户组的成员摘要。
 * 窗口查询在数据库内完成精确计数，并把返回行限制为每个范围前五名成员。
 */
export async function getScopeMemberSummaries(
  scopeType: UserScopeType,
  scopeIds: readonly number[],
): Promise<Map<number, ScopeMemberSummary>> {
  const uniqueScopeIds = [...new Set(scopeIds)];
  if (uniqueScopeIds.length === 0) return new Map();

  const rows = await db.execute<ScopeMemberSummaryRow>(sql`
    WITH scope_members AS (
      ${scopeMemberSource(scopeType, uniqueScopeIds)}
    ),
    ranked_scope_members AS (
      SELECT scope_id, user_id, nickname, avatar,
             CAST(COUNT(*) OVER (PARTITION BY scope_id) AS integer) AS member_count,
             CAST(ROW_NUMBER() OVER (PARTITION BY scope_id ORDER BY user_id) AS integer) AS preview_rank
      FROM scope_members
    )
    SELECT scope_id AS "scopeId", user_id AS id, nickname, avatar,
           member_count AS count
    FROM ranked_scope_members
    WHERE preview_rank <= ${USER_PREVIEW_LIMIT}
    ORDER BY scope_id, user_id
  `);

  return buildScopeMemberSummaryMap(rows);
}

/** 去重并校验用户 ID 均属于目标范围的租户，供各成员分配入口复用。 */
export async function validateScopeUserIds(
  userIds: readonly number[],
  scopeTenantId: number | null,
): Promise<number[]> {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) return uniqueUserIds;

  const tenant = exactTenantCondition(users.tenantId, scopeTenantId);
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, uniqueUserIds), tenant));
  if (rows.length !== uniqueUserIds.length) {
    throw new HTTPException(400, { message: '存在无效用户' });
  }
  return uniqueUserIds;
}

export async function listScopeMembers(
  scopeType: UserScopeType,
  scopeId: number,
  query: ScopeMemberQuery,
): Promise<{ list: ScopeMemberItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.trunc(Number(query.page) || 1));
  const pageSize = Math.min(Math.max(1, Math.trunc(Number(query.pageSize) || 10)), 100);

  const where = buildWhere(
    and(scopeCondition(scopeType, scopeId), keywordCondition(query.keyword, [users.nickname, users.username])),
    tenantScope(users),
  );

  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(users, where),
    rows: () => withPagination(
      db
        .select({ id: users.id, username: users.username, nickname: users.nickname, avatar: users.avatar })
        .from(users)
        .where(where)
        .orderBy(users.id)
        .$dynamic(),
      page,
      pageSize,
    ),
  });
}
