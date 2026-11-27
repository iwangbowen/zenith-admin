import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

const ws = vi.hoisted(() => ({ scheduleSendPerUser: vi.fn(), scheduleSendToUsers: vi.fn() }));
vi.mock('../../lib/ws-manager', () => ws);

describe.runIf(process.env.RUN_IN_APP_SCOPE_INTEGRATION === '1')('manual in-app delivery on PostgreSQL', () => {
  it('uses the send permission scope for lookup and transactional delivery, preserves internal delivery, and excludes mis-scoped history', async () => {
    vi.stubEnv('MULTI_TENANT_MODE', 'true');
    const { db, closeDb } = await import('../../db');
    const { departments, identityUserPermissions, inAppMessages, tenants, users } = await import('../../db/schema');
    const { runWithCurrentUser } = await import('../../lib/context/principal');
    const { accessScopeKey } = await import('@zenith/shared/identity');
    const service = await import('./in-app-messages.service');

    const nonce = crypto.randomUUID().slice(0, 8);
    const fixture = await db.transaction(async (tx) => {
      const [tenant, otherTenant] = await tx.insert(tenants).values([
        { name: '通知发送测试甲', code: `send-a-${nonce}` },
        { name: '通知发送测试乙', code: `send-b-${nonce}` },
      ]).returning();
      const [department, otherDepartment] = await tx.insert(departments).values([
        { name: '测试一部', code: 'dept-1', tenantId: tenant.id },
        { name: '测试二部', code: 'dept-2', tenantId: tenant.id },
      ]).returning();
      const fixtureUser = (suffix: string, tenantId: number | null, departmentId?: number) => ({
        username: `send-${nonce}-${suffix}`, nickname: suffix, password: 'not-a-login-hash', tenantId, departmentId,
      });
      const [sender, recipient, colleague, foreign, disabled, platform] = await tx.insert(users).values([
        fixtureUser('sender', tenant.id, department.id),
        fixtureUser('recipient', tenant.id, department.id),
        fixtureUser('colleague', tenant.id, otherDepartment.id),
        fixtureUser('foreign', otherTenant.id),
        { ...fixtureUser('disabled', tenant.id, department.id), status: 'disabled' },
        { ...fixtureUser('platform', null), userDataScope: 'all' },
      ]).returning();
      await tx.insert(identityUserPermissions).values([
        { userId: sender.id, permissionCode: 'system:in-app-message:send', dataScope: 'dept_only', deptScopeIds: [], scopeKey: accessScopeKey('dept_only', []) },
        { userId: sender.id, permissionCode: 'system:user:list', dataScope: 'all', deptScopeIds: [], scopeKey: accessScopeKey('all', []) },
      ]);
      return { tenant, otherTenant, sender, recipient, colleague, foreign, disabled, platform };
    });

    const { tenant, otherTenant, sender, recipient, colleague, foreign, disabled, platform } = fixture;
    const actor = { userId: sender.id, username: sender.username, roles: [], tenantId: tenant.id };
    const body = { title: `通知-${nonce}`, content: '正文', type: 'info' as const };
    try {
      await runWithCurrentUser(actor, async () => {
        expect((await service.listManualInAppRecipients()).map(({ id }) => id)).toEqual([sender.id, recipient.id]);
        for (const id of [colleague.id, foreign.id, disabled.id]) {
          await expect(service.sendInApp({ ...body, userIds: [recipient.id, id] })).rejects.toMatchObject({ status: 404 });
        }
        expect(await db.$count(inAppMessages, eq(inAppMessages.title, body.title))).toBe(0);
        expect(ws.scheduleSendPerUser).not.toHaveBeenCalled();

        expect(await service.sendInApp({ ...body, userIds: [recipient.id, recipient.id] })).toEqual({ sentCount: 1 });
        const [delivered] = await db.select().from(inAppMessages).where(eq(inAppMessages.title, body.title));
        expect(delivered).toMatchObject({ userId: recipient.id, senderId: sender.id, tenantId: tenant.id, source: 'manual' });
        expect(ws.scheduleSendPerUser).toHaveBeenCalledWith([expect.objectContaining({
          userId: recipient.id, message: expect.objectContaining({ payload: expect.objectContaining({ id: delivered.id }) }),
        })]);

        const [legacy] = await db.insert(inAppMessages).values({
          ...body, userId: foreign.id, senderId: sender.id, tenantId: tenant.id, source: 'manual',
        }).returning();
        const history = await service.listAllInAppMessages({ page: 1, pageSize: 10 });
        expect(history.total).toBe(1);
        expect(history.list.map(({ id }) => id)).toEqual([delivered.id]);
        await expect(service.getInAppMessageBeforeAudit(legacy.id)).rejects.toMatchObject({ status: 404 });
        await expect(service.adminMarkAsRead(legacy.id)).rejects.toMatchObject({ status: 404 });
        await expect(service.adminDeleteInAppMessage(legacy.id)).rejects.toMatchObject({ status: 404 });
        expect(ws.scheduleSendToUsers).not.toHaveBeenCalled();
        expect(await service.adminMarkAllAsRead()).toEqual({ count: 1 });
        expect(ws.scheduleSendToUsers).toHaveBeenLastCalledWith([{ userId: recipient.id }], { type: 'in-app-message:read-all', payload: {} });
        expect(await db.query.inAppMessages.findFirst({ where: eq(inAppMessages.id, legacy.id) })).toMatchObject({ isRead: false });
      });

      const platformActor = { userId: platform.id, username: platform.username, roles: ['super_admin'], tenantId: null };
      await runWithCurrentUser(platformActor, async () => {
        await expect(service.sendInApp({ ...body, userIds: [recipient.id] })).rejects.toMatchObject({ status: 404 });
        expect((await service.listManualInAppRecipients()).map(({ id }) => id)).toContain(platform.id);
      });
      await runWithCurrentUser({ ...platformActor, viewingTenantId: tenant.id }, async () => {
        expect((await service.listManualInAppRecipients()).map(({ id }) => id)).toEqual([sender.id, recipient.id, colleague.id]);
        expect(await service.sendInApp({ ...body, userIds: [colleague.id] })).toEqual({ sentCount: 1 });
      });

      expect(await service.sendJobInApp({ ...body, userIds: [colleague.id] }, { senderId: sender.id, tenantId: tenant.id })).toEqual({ sentCount: 1 });
      await expect(service.sendJobInApp({ ...body, userIds: [foreign.id] }, { senderId: sender.id, tenantId: tenant.id })).rejects.toMatchObject({ status: 404 });
    } finally {
      try {
        await db.delete(tenants).where(inArray(tenants.id, [tenant.id, otherTenant.id]));
        await db.delete(users).where(eq(users.id, platform.id));
      } finally {
        vi.unstubAllEnvs();
        await closeDb();
      }
    }
  });
});
