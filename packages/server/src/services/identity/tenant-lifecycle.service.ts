import { eq, and, isNotNull, lte, gt } from 'drizzle-orm';
import { db } from '../../db';
import { tenants, users, userRoles, roles } from '../../db/schema';
import { notify } from '../messaging/notification-outbox.service';
import { formatDateTime } from '../../lib/datetime';
import { TENANT_ADMIN_ROLE_CODE, revokeTenantSessions } from './tenants.service';
import { listEnabledPlatformSuperAdmins } from './platform-admins.service';

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

function toRecipients(userIds: number[]) {
  return userIds.map((id) => ({ type: 'user' as const, id }));
}

/**
 * 租户管理员与平台超管的收件人分组。
 * 两组分开投递是因为消息归属租户不同：租户管理员的通知属于该租户，
 * 平台超管的通知属于平台，混在一条里会让多租户的数据归属出错。
 */
async function resolveAdminAudiences(tenantId: number) {
  const [tenantAdminIds, platformAdminIds] = await Promise.all([
    getTenantAdminUserIds(tenantId),
    listEnabledPlatformSuperAdmins().then((admins) => admins.map((admin) => admin.id)),
  ]);
  return { tenantAdminIds, platformAdminIds };
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
    revokedSessions += await revokeTenantSessions(t.id);
    const { tenantAdminIds, platformAdminIds } = await resolveAdminAudiences(t.id);
    const vars = { tenantName: t.name, expireAt: formatDateTime(t.expireAt!) };
    await Promise.all([
      notify('identity.tenant.expired', {
        recipients: toRecipients(tenantAdminIds),
        vars,
        tenantId: t.id,
        dedupeKey: `tenant-expired:${t.id}:tenant`,
      }),
      notify('identity.tenant.expired', {
        recipients: toRecipients(platformAdminIds),
        vars,
        tenantId: null,
        dedupeKey: `tenant-expired:${t.id}:platform`,
      }),
    ]);
    notified += tenantAdminIds.length + platformAdminIds.length;
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
    const { tenantAdminIds, platformAdminIds } = await resolveAdminAudiences(t.id);
    const vars = { tenantName: t.name, days, expireAt: formatDateTime(t.expireAt!) };
    await Promise.all([
      notify('identity.tenant.expiring', {
        recipients: toRecipients(tenantAdminIds),
        vars,
        tenantId: t.id,
        dedupeKey: `tenant-expiring:${t.id}:${days}:tenant`,
      }),
      notify('identity.tenant.expiring', {
        recipients: toRecipients(platformAdminIds),
        vars,
        tenantId: null,
        dedupeKey: `tenant-expiring:${t.id}:${days}:platform`,
      }),
    ]);
    reminded += tenantAdminIds.length + platformAdminIds.length;
  }

  return `停用过期租户 ${expired.length} 个（吊销会话 ${revokedSessions} 个），发送到期提醒/停用通知 ${notified + reminded} 条`;
}
