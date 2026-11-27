import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { JwtPayload } from '../../middleware/auth';

const connection = process.env.TEST_TASK_SCOPE_DATABASE_URL;

describe.skipIf(!connection)('Task and CMS scope on PostgreSQL', () => {
  let database: typeof import('../../db');
  let schema: typeof import('../../db/schema');
  let context: typeof import('../../lib/context');
  let service: typeof import('./async-tasks.service');
  let queries: typeof import('./public/queries');
  let cms: typeof import('../cms/cms-publishing.service');
  const tenantIds: number[] = [];
  const userIds: number[] = [];
  const taskIds: number[] = [];
  const siteIds: number[] = [];
  const insertedMenuIds: number[] = [];
  const label = `scope-${randomUUID().slice(0, 8)}`;
  const query = { page: 1, pageSize: 50, keyword: label };
  let adminA: JwtPayload;
  let adminB: JwtPayload;
  let ownerA: JwtPayload;
  let globalAdmin: JwtPayload;
  let taskA: number;
  let taskB: number;
  let taskSystem: number;
  let taskBTerminal: number;
  let cmsA: number;
  let cmsB: number;

  beforeAll(async () => {
    const url = new URL(connection!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_review_tasks') {
      throw new Error('Requires a disposable local migrated zenith_review_tasks database');
    }
    vi.stubEnv('DATABASE_URL', connection!);
    vi.stubEnv('MULTI_TENANT_MODE', 'true');
    database = await import('../../db');
    schema = await import('../../db/schema');
    context = await import('../../lib/context');
    service = await import('./async-tasks.service');
    queries = await import('./public/queries');
    cms = await import('../cms/cms-publishing.service');
    const { createTenant } = await import('../identity/tenants.service');
    const { registerCmsPublishingTaskPolicy } = await import('./public/access');
    const { cmsPublishingTaskScopedWhere } = await import('../cms/cms-publishing-access');
    registerCmsPublishingTaskPolicy({ where: cmsPublishingTaskScopedWhere, retry: cms.cmsPublishingAction });

    const { SEED_MENUS } = await import('@zenith/shared/seed/menus');
    const names = new Set(['SystemSettings', 'SystemTaskCenter', 'Cms', 'CmsPublishing']);
    const chosen = SEED_MENUS.filter(row => (row.name && names.has(row.name)) || row.id === 14000);
    for (const menu of chosen) {
      const [inserted] = await database.db.insert(schema.menus).overridingSystemValue().values({
        id: menu.id, parentId: menu.parentId, name: menu.name, title: menu.title, type: menu.type,
        path: menu.path, component: menu.component, permission: menu.permission, status: menu.status,
      }).onConflictDoNothing({ target: schema.menus.id }).returning({ id: schema.menus.id });
      if (inserted) insertedMenuIds.push(inserted.id);
    }
    const [platform] = await database.db.insert(schema.users).values({
      username: `${label}-platform`, nickname: 'Task platform admin', password: 'test-only',
    }).returning();
    userIds.push(platform.id);
    globalAdmin = { userId: platform.id, username: platform.username, tenantId: null, roles: ['super_admin'] };

    async function tenant(suffix: string): Promise<JwtPayload> {
      const username = `${label}-${suffix}`;
      const result = await context.runWithCurrentUser(globalAdmin, () =>
        createTenant({ name: username, code: username, status: 'enabled', adminUsername: username }));
      tenantIds.push(result.id);
      const [account] = await database.db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
      userIds.push(account.id);
      return { userId: account.id, username, tenantId: result.id, roles: ['tenant_admin'] };
    }

    adminA = await tenant('a');
    adminB = await tenant('b');
    const [owner] = await database.db.insert(schema.users).values({
      username: `${label}-owner`, nickname: 'Task owner', tenantId: adminA.tenantId, password: 'test-only',
    }).returning();
    userIds.push(owner.id);
    ownerA = { userId: owner.id, username: owner.username, tenantId: owner.tenantId, roles: [] };

    const [siteA, siteB] = await database.db.insert(schema.cmsSites).values([
      { name: `${label}-a`, code: `${label}-a` },
      { name: `${label}-b`, code: `${label}-b` },
    ]).returning();
    siteIds.push(siteA.id, siteB.id);
    await database.db.insert(schema.cmsSiteUsers).values([
      { siteId: siteA.id, userId: adminA.userId },
      { siteId: siteB.id, userId: adminB.userId },
    ]);

    async function task(values: Partial<typeof schema.asyncTasks.$inferInsert>) {
      const [row] = await database.db.insert(schema.asyncTasks).values({
        title: label, taskType: 'scope-test', retryDelayMs: 5000, ...values,
      }).returning();
      taskIds.push(row.id);
      return row.id;
    }
    taskA = await task({ tenantId: adminA.tenantId, createdBy: ownerA.userId, payload: { label: 'tenant A' } });
    taskB = await task({ tenantId: adminB.tenantId, createdBy: adminB.userId, payload: { label: 'tenant B' } });
    taskSystem = await task({ tenantId: adminA.tenantId, createdBy: null });
    taskBTerminal = await task({ tenantId: adminB.tenantId, createdBy: adminB.userId, status: 'failed' });
    cmsA = await task({ taskType: 'cms-publish-build', createdBy: adminA.userId, tenantId: null, payload: { siteId: siteA.id } });
    cmsB = await task({ taskType: 'cms-publish-build', createdBy: adminB.userId, tenantId: null, payload: { siteId: siteB.id } });
    await database.db.insert(schema.asyncTaskItems).values([
      { taskId: taskA, itemKey: 'a', label: 'Tenant A fixture', status: 'pending' },
      { taskId: taskB, itemKey: 'b', label: 'Tenant B fixture', status: 'pending' },
    ]);
  }, 90_000);

  afterAll(async () => {
    if (database) {
      if (taskIds.length) await database.db.delete(schema.asyncTasks).where(inArray(schema.asyncTasks.id, taskIds));
      if (siteIds.length) await database.db.delete(schema.cmsSites).where(inArray(schema.cmsSites.id, siteIds));
      if (userIds.length) await database.db.delete(schema.users).where(inArray(schema.users.id, userIds));
      if (tenantIds.length) await database.db.delete(schema.tenants).where(inArray(schema.tenants.id, tenantIds));
      if (insertedMenuIds.length) await database.db.delete(schema.menus).where(inArray(schema.menus.id, insertedMenuIds));
      await database.closeDb();
    }
    vi.unstubAllEnvs();
  });

  it('narrows default grants and applies the same scope to queries, statistics and detail', async () => {
    const { getUserPermissions } = await import('../../lib/permissions');
    const codes = await getUserPermissions(adminA.userId);
    expect(codes).toEqual(expect.arrayContaining(['system:async-task:list', 'system:async-task:manage']));
    expect(codes).not.toContain('system:async-task:config');
    expect(codes).not.toContain('system:async-task:cleanup');

    const asA = <T>(fn: () => Promise<T>) => context.runWithCurrentUser(adminA, fn);
    const view = await asA(() => queries.listAsyncTasks(query));
    expect(view.list.map(row => row.id).sort()).toEqual([taskA, taskSystem, cmsA].sort());
    expect(view.total).toBe(3);
    expect((await asA(service.getAsyncTaskStats)).total).toBe(3);
    expect((await asA(() => service.getAsyncTask(taskA))).payload).toEqual({ label: 'tenant A' });
    expect((await asA(() => service.listAsyncTaskItems(taskA, { page: 1, pageSize: 50 }))).list[0]?.itemKey).toBe('a');
    await expect(asA(() => service.getAsyncTask(taskB))).rejects.toMatchObject({ status: 404 });
    await expect(asA(() => service.listAsyncTaskItems(taskB, query))).rejects.toMatchObject({ status: 404 });
    const mine = await context.runWithCurrentUser(ownerA, () => queries.listMyAsyncTasks(query));
    expect(mine.list.map(row => row.id)).toEqual([taskA]);

    const all = await context.runWithCurrentUser(globalAdmin, () => queries.listAsyncTasks(query));
    expect(all.total).toBe(6);
    const selected = await context.runWithCurrentUser({ ...globalAdmin, viewingTenantId: adminA.tenantId }, () => queries.listAsyncTasks(query));
    expect(selected.list.map(row => row.id).sort()).toEqual([taskA, taskSystem].sort());
    await expect(asA(service.cleanupFinishedTasks)).rejects.toMatchObject({ status: 403 });
  });

  it('leaves foreign and system task rows untouched on rejected mutations', async () => {
    const asA = <T>(fn: () => Promise<T>) => context.runWithCurrentUser(adminA, fn);
    await expect(asA(() => service.cancelTask(taskB))).rejects.toMatchObject({ status: 404 });
    await expect(asA(() => service.deleteAsyncTask(taskBTerminal))).rejects.toMatchObject({ status: 404 });
    expect(await asA(() => service.batchDeleteTasks([taskBTerminal]))).toEqual({ affected: 0 });
    expect(await asA(() => service.batchCancelTasks([taskA, taskA, taskB, taskSystem]))).toEqual({ affected: 1 });
    const rows = await database.db.select().from(schema.asyncTasks).where(inArray(schema.asyncTasks.id, [taskA, taskB, taskSystem, taskBTerminal]));
    expect(rows.map(row => [row.id, row.status])).toEqual(expect.arrayContaining([
      [taskA, 'cancelled'], [taskB, 'pending'], [taskSystem, 'pending'], [taskBTerminal, 'failed'],
    ]));
  });

  it('enforces the live CMS site ACL in both task views and mutations', async () => {
    const asA = <T>(fn: () => Promise<T>) => context.runWithCurrentUser(adminA, fn);
    expect((await asA(() => service.getAsyncTask(cmsA))).id).toBe(cmsA);
    expect((await asA(() => cms.getCmsPublishingDetail(cmsA))).task.id).toBe(cmsA);
    await expect(asA(() => cms.getCmsPublishingDetail(cmsB))).rejects.toMatchObject({ status: 404 });
    await expect(asA(() => service.getAsyncTask(cmsB))).rejects.toMatchObject({ status: 404 });
    await database.db.delete(schema.cmsSiteUsers).where(eq(schema.cmsSiteUsers.userId, adminA.userId));
    await expect(asA(() => cms.getCmsPublishingDetail(cmsA))).rejects.toMatchObject({ status: 404 });
    await expect(asA(() => service.getAsyncTask(cmsA))).rejects.toMatchObject({ status: 404 });
    await expect(asA(() => service.cancelTask(cmsA))).rejects.toMatchObject({ status: 404 });
    await expect(asA(() => cms.cmsPublishingAction(cmsA, 'cancel'))).rejects.toMatchObject({ status: 404 });
    expect((await asA(() => cms.listCmsPublishingTasks(query))).total).toBe(0);
    expect((await asA(() => queries.listMyAsyncTasks(query))).total).toBe(0);
    const [row] = await database.db.select().from(schema.asyncTasks).where(eq(schema.asyncTasks.id, cmsA));
    expect(row.status).toBe('pending');
  });
});
