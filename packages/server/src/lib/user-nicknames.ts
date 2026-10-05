import { eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { users } from '../db/schema';
import type { DbExecutor } from '../db/types';
import { requireRow } from './db-assert';
import { tenantScope, optionalExactTenantCondition } from './tenant';
import { buildWhere, keywordCondition } from './where-helpers';

/** 用户 id → 展示名（昵称，空则回退用户名） */
export type UserNameMap = Map<number, string>;

export interface TenantUserRef {
  readonly id: number;
  readonly username: string;
  readonly nickname: string;
  readonly status: (typeof users.$inferSelect)['status'];
}

/**
 * 请求侧指定的目标用户（转办 / 委派 / 负责人 / 交接人）必须存在于**当前租户可见范围**内：
 * 只按 id 查 users 会让租户用户把任务、委托、归属指到别的租户的账号上。
 * `enabledOnly` 时停用账号一并按不存在处理。
 */
export async function requireTenantUser(id: number, message: string, options: { enabledOnly?: boolean; status?: 400 | 404; tenantId?: number | null } = {}): Promise<TenantUserRef> {
  const [row] = await db.select({ id: users.id, username: users.username, nickname: users.nickname, status: users.status })
    .from(users)
    .where(buildWhere(eq(users.id, id), tenantScope(users), options.tenantId !== undefined ? optionalExactTenantCondition(users.tenantId, options.tenantId) : undefined))
    .limit(1);
  const user = requireRow(row, message, options.status ?? 400);
  if (options.enabledOnly && user.status !== 'enabled') throw new HTTPException(options.status ?? 400, { message });
  return user;
}

/**
 * 批量解析用户 id → 展示名（昵称 || 用户名），供列表行的 createdBy / ownerId / actorId 等补充展示名。
 * 忽略空值并去重；不存在的用户不在结果中，调用方按需回退。
 */
export async function resolveUserNames(ids: Iterable<number | null | undefined>, executor: DbExecutor = db): Promise<UserNameMap> {
  const uniq = [...new Set([...ids].filter((id): id is number => typeof id === 'number'))];
  if (uniq.length === 0) return new Map();
  const rows = await executor.select({ id: users.id, nickname: users.nickname, username: users.username })
    .from(users).where(inArray(users.id, uniq));
  return new Map(rows.map((r) => [r.id, r.nickname || r.username]));
}

/**
 * 批量解析用户名 → 昵称映射（日志/统计等只存 username 的场景补充展示名）。
 * 已删除或系统内不存在的用户名不在返回结果中；昵称与用户名相同也原样返回，
 * 是否降级展示由前端决定。
 */
export async function getNicknameMap(usernames: Array<string | null | undefined>): Promise<Map<string, string>> {
  const names = [...new Set(usernames.filter((n): n is string => !!n))];
  if (names.length === 0) return new Map();
  const rows = await db
    .select({ username: users.username, nickname: users.nickname })
    .from(users)
    .where(inArray(users.username, names));
  return new Map(rows.map((r) => [r.username, r.nickname]));
}

/**
 * 昵称关键字 → 用户名列表：日志表只存 username，支持按昵称搜索时先反查用户名。
 * 结果集有界（limit 200），供 IN 条件使用。
 */
export async function findUsernamesByNickname(keyword: string): Promise<string[]> {
  const rows = await db
    .select({ username: users.username })
    .from(users)
    .where(keywordCondition(keyword, [users.nickname]))
    .limit(200);
  return rows.map((r) => r.username);
}
