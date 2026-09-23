import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { menus, roleMenus, roles, userRoles, users } from '../../db/schema';
import logger from '../../lib/logger';
import { inheritedTenantCondition } from '../../lib/tenant';
import type { LoginBurstKind, LoginFailureOutcome } from '../../lib/login-challenge-guard';
import { notify } from '../messaging/notification-outbox.service';

/**
 * 登录失败突增告警（管理员与会员共用）。
 *
 * 阈值判定、窗口计数与「每账号每原因每窗口只告警一次」的去重都在
 * `lib/login-challenge-guard.ts` 完成——登录链路只在守卫返回 bursts 时调用本服务，
 * 本服务只负责找接收人并交给通知派发层（渠道、偏好、免打扰与投递留痕由派发层负责）。
 */

/** 接收人权限：身份安全策略管理员与登录风险查看者；平台超管始终在列 */
const ALERT_PERMISSIONS = ['system:identity-security:manage', 'system:login-risk:list'];

const BURST_LABELS: Record<LoginBurstKind, string> = {
  'multi-source': '多来源尝试（疑似分布式猜解）',
  'high-volume': '失败量异常（疑似口令爆破）',
};

export interface LoginBurstContext {
  username: string;
  ip: string;
  tenantId: number | null;
  windowMinutes: number;
  /** 站内信深链：管理员登录指向系统登录日志，会员登录指向会员登录日志 */
  link: string;
}

/** 该租户可见的安全管理员（含平台超管）；与告警规则一致，租户覆盖不影响接收人范围 */
export async function resolveLoginAlertUserIds(tenantId: number | null): Promise<number[]> {
  const tenantScope = inheritedTenantCondition(users.tenantId, tenantId);
  const [byPermission, superAdmins] = await Promise.all([
    db.selectDistinct({ id: users.id }).from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(roleMenus, eq(roleMenus.roleId, userRoles.roleId))
      .innerJoin(menus, eq(menus.id, roleMenus.menuId))
      .where(and(inArray(menus.permission, ALERT_PERMISSIONS), eq(users.status, 'enabled'), eq(roles.status, 'enabled'), tenantScope)),
    db.selectDistinct({ id: users.id }).from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(roles.code, 'super_admin'), eq(roles.status, 'enabled'), eq(users.status, 'enabled'), tenantScope)),
  ]);
  return [...new Set([...byPermission, ...superAdmins].map((r) => r.id))];
}

/**
 * 派发登录失败突增告警。无 bursts 直接返回；告警失败只记日志，绝不阻断登录主流程。
 */
export async function dispatchLoginBurstAlerts(outcome: LoginFailureOutcome, ctx: LoginBurstContext): Promise<void> {
  if (outcome.bursts.length === 0) return;
  try {
    const recipients = await resolveLoginAlertUserIds(ctx.tenantId);
    if (recipients.length === 0) {
      logger.warn({ username: ctx.username, kinds: outcome.bursts }, 'identity: 登录失败突增告警无接收人');
      return;
    }
    // 守卫已用 Redis 去重；dedupeKey 再按「账号 + 原因 + 窗口桶」兜底跨节点竞态与重放
    const bucket = Math.floor(Date.now() / (ctx.windowMinutes * 60_000));
    for (const kind of outcome.bursts) {
      await notify('identity.login.burst_alert', {
        recipients: recipients.map((id) => ({ type: 'user' as const, id })),
        vars: {
          username: ctx.username,
          kindLabel: BURST_LABELS[kind],
          failureCount: outcome.failureCount,
          sourceCount: outcome.sourceCount,
          windowMinutes: ctx.windowMinutes,
          ip: ctx.ip,
        },
        tenantId: ctx.tenantId,
        link: ctx.link,
        dedupeKey: `login-burst:${kind}:${ctx.tenantId ?? 'platform'}:${ctx.username}:${bucket}`,
      });
    }
  } catch (err) {
    logger.warn({ err, username: ctx.username, kinds: outcome.bursts }, 'identity: 登录失败突增告警派发失败');
  }
}
