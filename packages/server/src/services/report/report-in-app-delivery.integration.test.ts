import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());
vi.mock('../../lib/ws-manager', async (importOriginal) => ({ ...await importOriginal<object>(), scheduleSendPerUser: push }));

describe.runIf(process.env.RUN_IN_APP_SCOPE_INTEGRATION === '1')('report in-app delivery on PostgreSQL', () => {
  it('delivers a tenant report only to its authorized platform creator in the platform inbox', async () => {
    vi.stubEnv('MULTI_TENANT_MODE', 'true');
    const { db, closeDb } = await import('../../db');
    const { inAppMessages, reportDeliveryRuns, roles, tenants, userRoles, users } = await import('../../db/schema');
    const { dispatchNotificationChannels } = await import('./report-delivery.service');
    const nonce = crypto.randomUUID().slice(0, 8);

    const { tenant, creator, other, platformRole, runs } = await db.transaction(async (tx) => {
      const [tenant] = await tx.insert(tenants).values({ name: '报表通知测试', code: `report-send-${nonce}` }).returning();
      const [creator, other] = await tx.insert(users).values([
        { username: `report-${nonce}-creator`, nickname: '平台创建者', password: 'not-a-login-hash' },
        { username: `report-${nonce}-other`, nickname: '其他平台用户', password: 'not-a-login-hash' },
      ]).returning();
      const [platformRole] = await tx.insert(roles).values({ code: 'super_admin', name: `测试平台超管-${nonce}` }).returning();
      await tx.insert(userRoles).values({ userId: creator.id, roleId: platformRole.id });
      const runs = await tx.insert(reportDeliveryRuns).values([creator, other, creator].map((owner, index) => ({
        tenantId: tenant.id, targetType: 'subscription' as const, triggerType: 'scheduled' as const,
        idempotencyKey: `report-send-${nonce}-${index}`, requestedBy: owner.id,
      }))).returning();
      return { tenant, creator, other, platformRole, runs };
    });
    const input = { tenantId: tenant.id, title: `报表送达-${nonce}`, text: '正文', channels: ['inApp' as const], attempt: 1, inAppType: 'info' as const };
    try {
      expect(await dispatchNotificationChannels({ ...input, runId: runs[0].id, createdBy: creator.id })).toMatchObject({ status: 'success' });
      expect(await dispatchNotificationChannels({ ...input, runId: runs[1].id, createdBy: other.id })).toMatchObject({ status: 'failed' });

      await db.update(roles).set({ status: 'disabled' }).where(eq(roles.id, platformRole.id));
      expect(await dispatchNotificationChannels({ ...input, runId: runs[2].id, createdBy: creator.id })).toMatchObject({ status: 'failed' });

      const messages = await db.select().from(inAppMessages).where(eq(inAppMessages.title, input.title));
      expect(messages).toMatchObject([{ tenantId: null, userId: creator.id, senderId: creator.id }]);
      expect(push).toHaveBeenCalledOnce();
      expect(push).toHaveBeenCalledWith([expect.objectContaining({ userId: creator.id })]);
    } finally {
      try {
        await db.delete(reportDeliveryRuns).where(inArray(reportDeliveryRuns.id, runs.map(({ id }) => id)));
        await db.delete(users).where(inArray(users.id, [creator.id, other.id]));
        await db.delete(roles).where(eq(roles.id, platformRole.id));
        await db.delete(tenants).where(eq(tenants.id, tenant.id));
      } finally {
        vi.unstubAllEnvs();
        await closeDb();
      }
    }
  });
});
