import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/ws-manager', () => ({ scheduleSendToUsers: vi.fn(), scheduleSendPerUser: vi.fn() }));
vi.mock('../../lib/sms-sender', () => ({ renderTemplate: vi.fn() }));

/** 显式启用；真实 PostgreSQL 隔离事务 fixture，测试末尾整体回滚，不持久化用户和消息。 */
describe.runIf(process.env.RUN_IN_APP_SCOPE_INTEGRATION === '1')('real inbox recipient and tenant isolation', () => {
  it('filters before pagination and leaves alerts, foreign recipients and foreign tenants unread', async () => {
    vi.stubEnv('MULTI_TENANT_MODE', 'true');
    const { db, withDbExecutor, closeDb } = await import('../../db');
    const { users, tenants, inAppMessages } = await import('../../db/schema');
    const { runWithCurrentUser } = await import('../../lib/context/principal');
    const { listMyInAppMessages, unreadCount, markAllAsRead, getMyInAppMessage } = await import('./in-app-messages.service');
    const { config } = await import('../../config');
    expect(config.multiTenantMode).toBe(true);
    const rollback = new Error('notification scope integration rollback');
    try {
      await expect(db.transaction(async tx => withDbExecutor(tx, async () => {
        const nonce = crypto.randomUUID().slice(0, 8);
        const [tenantA, tenantB] = await tx.insert(tenants).values([{ name: '通知隔离测试甲', code: `notify-a-${nonce}` }, { name: '通知隔离测试乙', code: `notify-b-${nonce}` }]).returning();
        const [actor, other] = await tx.insert(users).values([{ username: `notify-a-${nonce}`, nickname: '审批通知甲', password: 'not-a-login-hash', tenantId: tenantA.id }, { username: `notify-b-${nonce}`, nickname: '审批通知乙', password: 'not-a-login-hash', tenantId: tenantB.id }]).returning();
        const ownFlow = Array.from({ length: 23 }, (_, index) => ({ userId: actor.id, tenantId: tenantA.id, eventKey: 'workflow.task.created', title: `审批-${index}`, content: '内容', link: '/biz/custom-detail' }));
        const created = await tx.insert(inAppMessages).values([
          ...ownFlow,
          { userId: actor.id, tenantId: tenantA.id, eventKey: 'ops.monitor.alert', title: '审批通过', content: '告警伪同名', link: '/workflow/pending' },
          { userId: actor.id, tenantId: tenantB.id, eventKey: 'workflow.task.created', title: '他租户', content: '内容' },
          { userId: other.id, tenantId: tenantA.id, eventKey: 'workflow.task.created', title: '他收件人', content: '内容' },
        ]).returning();
        await runWithCurrentUser({ userId: actor.id, username: actor.username, roles: [], tenantId: tenantA.id }, async () => {
          const first = await listMyInAppMessages({ page: 1, pageSize: 20, eventGroup: 'workflow' });
          const second = await listMyInAppMessages({ page: 2, pageSize: 20, eventGroup: 'workflow' });
          expect(first.total).toBe(23); expect(first.list).toHaveLength(20); expect(second.list).toHaveLength(3);
          expect(new Set([...first.list, ...second.list].map(message => message.id)).size).toBe(23);
          expect(await unreadCount({ eventGroup: 'workflow' })).toEqual({ count: 23 });
          await expect(getMyInAppMessage(created.at(-1)!.id)).rejects.toMatchObject({ status: 404 });
          await expect(getMyInAppMessage(created.at(-2)!.id)).rejects.toMatchObject({ status: 404 });
          expect(await markAllAsRead({ eventGroup: 'workflow' })).toEqual({ count: 23 });
          expect(await unreadCount({ eventGroup: 'workflow' })).toEqual({ count: 0 });
          expect(await unreadCount()).toEqual({ count: 1 });
          const untouched = await tx.select().from(inAppMessages).where((await import('drizzle-orm')).inArray(inAppMessages.id, created.slice(-3).map(message => message.id)));
          expect(untouched).toHaveLength(3);
          expect(untouched.every(message => !message.isRead)).toBe(true);
        });
        throw rollback;
      }))).rejects.toBe(rollback);
    } finally { vi.unstubAllEnvs(); await closeDb(); }
  }, 30_000);
});
