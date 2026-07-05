import { eq, and, isNull, isNotNull, lte, gt } from 'drizzle-orm';
import { db } from '../../db';
import { tenants, users, userRoles, roles } from '../../db/schema';
import { forceLogoutAllByUsers } from '../../lib/session-manager';
import { sendSystemInApp } from '../messaging/in-app-messages.service';
import { formatDateTime } from '../../lib/datetime';
import { TENANT_ADMIN_ROLE_CODE } from './tenants.service';
import logger from '../../lib/logger';

const DAY_MS = 86_400_000;

/** 到期前提醒节点（天）：每天跑一次任务，命中当天恰好剩余 N 天时发送，天然防重复 */
const REMIND_DAYS = [7, 3, 1];

/** 某租户下启用状态的租户管理员（tenant_admin 角色）用户 ID */
async function getTenantAdminUserIds(tenantId: number): Promise<number[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(roles.code, TENANT_ADMIN_ROLE_CODE), eq(roles.tenantId, tenantId), eq(users.status, 'enabled')));
  return [...new Set(rows.map((r) => r.id))];
}

/** 平台超管（tenantId 为空且绑定 super_admin 角色）的用户 ID */
async function getPlatformAdminUserIds(): Promise<number[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(roles.code, 'super_admin'), isNull(users.tenantId), eq(users.status, 'enabled')));
  return [...new Set(rows.map((r) => r.id))];
}

/** 通知租户管理员（消息归属该租户）+ 平台超管（消息归属平台） */
async function notifyTenantAndPlatformAdmins(
  tenantId: number,
  title: string,
  content: string,
  type: 'warning' | 'error',
): Promise<number> {
  const [tenantAdminIds, platformAdminIds] = await Promise.all([
    getTenantAdminUserIds(tenantId),
    getPlatformAdminUserIds(),
  ]);
  const [a, b] = await Promise.all([
    sendSystemInApp({ userIds: tenantAdminIds, title, content, type, tenantId }),
    sendSystemInApp({ userIds: platformAdminIds, title, content, type, tenantId: null }),
  ]);
  return a.sentCount + b.sentCount;
}

/**
 * 租户生命周期每日巡检：
 *  1. 自动停用已过期租户，并吊销其下用户的全部在线会话
 *  2. 到期前 7/3/1 天向租户管理员与平台超管发送站内信提醒
 */
export async function runTenantExpiryCheck(): Promise<string> {
  const now = new Date();

  // ── 1. 停用已过期租户 ──
  const expired = await db
    .update(tenants)
    .set({ status: 'disabled' })
    .where(and(eq(tenants.status, 'enabled'), isNotNull(tenants.expireAt), lte(tenants.expireAt, now)))
    .returning({ id: tenants.id, name: tenants.name, expireAt: tenants.expireAt });

  let revokedSessions = 0;
  let notified = 0;
  for (const t of expired) {
    // 吊销该租户全部用户的在线会话（best-effort）
    try {
      const tenantUsers = await db.select({ id: users.id }).from(users).where(eq(users.tenantId, t.id));
      const tokens = await forceLogoutAllByUsers(tenantUsers.map((u) => u.id));
      revokedSessions += tokens.length;
    } catch (err) {
      logger.error('停用过期租户后吊销会话失败', { tenantId: t.id, err });
    }
    notified += await notifyTenantAndPlatformAdmins(
      t.id,
      `租户「${t.name}」已到期停用`,
      `租户「${t.name}」已于 ${formatDateTime(t.expireAt!)} 到期，系统已自动停用，该租户用户将无法登录。如需继续使用请联系平台管理员续期。`,
      'error',
    );
  }

  // ── 2. 到期前提醒 ──
  const maxRemindDays = Math.max(...REMIND_DAYS);
  const upcoming = await db
    .select({ id: tenants.id, name: tenants.name, expireAt: tenants.expireAt })
    .from(tenants)
    .where(and(
      eq(tenants.status, 'enabled'),
      isNotNull(tenants.expireAt),
      gt(tenants.expireAt, now),
      lte(tenants.expireAt, new Date(now.getTime() + maxRemindDays * DAY_MS)),
    ));

  let reminded = 0;
  for (const t of upcoming) {
    const days = Math.ceil((t.expireAt!.getTime() - now.getTime()) / DAY_MS);
    if (!REMIND_DAYS.includes(days)) continue;
    reminded += await notifyTenantAndPlatformAdmins(
      t.id,
      `租户「${t.name}」将于 ${days} 天后到期`,
      `租户「${t.name}」将于 ${formatDateTime(t.expireAt!)} 到期（剩余 ${days} 天），到期后系统将自动停用该租户，请及时续期。`,
      'warning',
    );
  }

  return `停用过期租户 ${expired.length} 个（吊销会话 ${revokedSessions} 个），发送到期提醒/停用通知 ${notified + reminded} 条`;
}
