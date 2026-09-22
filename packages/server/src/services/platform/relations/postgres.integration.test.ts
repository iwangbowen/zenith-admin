import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CanonicalEntityRef } from '@zenith/shared/platform';
import type { JwtPayload } from '../../../middleware/auth';
import type { RelationProvider } from './types';

/** Never connect to a regular development, production, or remote database. */
function isolatedDatabaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== 'localhost' || url.search || url.hash) return undefined;
    if (!/^\/zenith_entity_relations_qa_\d+$/.test(url.pathname)) return undefined;
    return url.toString();
  } catch { return undefined; }
}

const databaseUrl = isolatedDatabaseUrl(process.env.TEST_ENTITY_DATABASE_URL);
const integration = databaseUrl ? describe : describe.skip;

integration('entity relations on isolated PostgreSQL', () => {
  let storage: typeof import('../../../db');
  let tables: typeof import('../../../db/schema');
  let context: typeof import('../../../lib/context');
  let registry: typeof import('./registry');
  let links: typeof import('./edges.service');
  let timeline: typeof import('./timeline');
  let events: typeof import('./events.service');
  let tenantA: number;
  let tenantB: number;
  let admin: JwtPayload;
  let reader: JwtPayload;
  let taskReader: JwtPayload;
  let foreignUser: JwtPayload;
  const menuIds: number[] = [];
  const runId = `entity_qa_${Date.now()}`;
  const userRef = (): CanonicalEntityRef => ({ type: 'identity.user', key: String(reader.userId) });
  const taskRef = (id: number): CanonicalEntityRef => ({ type: 'tasks.async', key: String(id) });

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('An isolated localhost entity-relations QA database is required');
    vi.stubEnv('DATABASE_URL', databaseUrl);
    vi.stubEnv('MULTI_TENANT_MODE', 'true');
    vi.stubEnv('LICENSE_MODE', 'off');
    vi.stubEnv('NODE_ENV', 'development');
    [storage, tables, context, registry, links, timeline, events] = await Promise.all([
      import('../../../db'), import('../../../db/schema'), import('../../../lib/context'), import('./registry'),
      import('./edges.service'), import('./timeline'), import('./events.service'),
    ]);
    const [{ name }] = await storage.pgClient<{ name: string }[]>`select current_database() as name`;
    expect(name).toMatch(/^zenith_entity_relations_qa_\d+$/);
    const [a, b] = await storage.db.insert(tables.tenants).values([
      { name: `${runId} A`, code: `${runId}_a` }, { name: `${runId} B`, code: `${runId}_b` },
    ]).returning({ id: tables.tenants.id });
    tenantA = a.id; tenantB = b.id;
    const createUser = async (suffix: string, tenantId: number | null, roles: string[]): Promise<JwtPayload> => {
      const [row] = await storage.db.insert(tables.users).values({
        username: `${runId}_${suffix}`.slice(-32), nickname: `QA ${suffix}`, password: 'unused-fixture-password', tenantId, userDataScope: 'all',
      }).returning({ id: tables.users.id, username: tables.users.username });
      return { userId: row.id, username: row.username, tenantId, roles };
    };
    admin = await createUser('admin', null, ['super_admin']);
    reader = await createUser('reader', tenantA, []);
    taskReader = await createUser('taskreader', tenantA, []);
    foreignUser = await createUser('foreign', tenantB, []);
    const [userMenu, taskMenu] = await storage.db.insert(tables.menus).values([
      { title: 'QA user access', name: `${runId}_users`, type: 'button', permission: 'system:user:list' },
      { title: 'QA task access', name: `${runId}_tasks`, type: 'button', permission: 'system:async-task:list' },
    ]).returning({ id: tables.menus.id });
    menuIds.push(userMenu.id, taskMenu.id);
    await storage.db.insert(tables.userMenus).values([
      { userId: reader.userId, menuId: userMenu.id }, { userId: taskReader.userId, menuId: userMenu.id }, { userId: taskReader.userId, menuId: taskMenu.id },
    ]);
  }, 120_000);

  async function cleanupRecords() {
    if (!storage || !tenantA || !tenantB) return;
    for (const table of [tables.entityWatches, tables.domainEvents, tables.entityRelationEdges, tables.operationLogs, tables.notificationOutbox, tables.asyncTasks]) {
      await storage.db.delete(table).where(inArray(table.tenantId, [tenantA, tenantB]));
    }
  }
  afterEach(cleanupRecords);
  afterAll(async () => {
    if (!storage) return;
    try {
      await cleanupRecords();
      if (tenantA && tenantB) await storage.db.delete(tables.tenants).where(inArray(tables.tenants.id, [tenantA, tenantB]));
      if (menuIds.length) await storage.db.delete(tables.menus).where(inArray(tables.menus.id, menuIds));
      if (admin) await storage.db.delete(tables.users).where(eq(tables.users.id, admin.userId));
    } finally { await storage.closeDb(); vi.unstubAllEnvs(); }
  });

  async function createTask(tenantId: number, owner: JwtPayload, title = 'QA task') {
    return context.runWithCurrentUser(owner, async () => {
      const [task] = await storage.db.insert(tables.asyncTasks).values({ taskType: 'entity.qa', title, retryDelayMs: 1000, tenantId })
        .returning({ id: tables.asyncTasks.id });
      return task.id;
    });
  }
  async function attachTask(id: number, tenantId: number, roles: Array<'primary' | 'related'> = ['related']) {
    await storage.db.insert(tables.asyncTaskSubjects).values(roles.map((role) => ({
      taskId: id, tenantId, entityType: 'identity.user', entityKey: String(reader.userId), role,
    })));
  }
  async function createTaskEvent(sourceId: number, at: string, payload = { taskType: 'entity.qa' }) {
    return context.runWithCurrentUser(admin, () => storage.db.transaction(async (tx) => {
      const id = await events.recordDomainEvent(tx, { eventType: 'tasks.async-task.created', source: taskRef(sourceId),
        payload, tenantId: tenantA, subjects: [{ ...userRef(), role: 'related' }] });
      await tx.update(tables.domainEvents).set({ occurredAt: sql`${at}::timestamptz` }).where(eq(tables.domainEvents.id, id));
      return id;
    }));
  }
  async function collectTimeline(user: JwtPayload, limit: number) {
    const items: Awaited<ReturnType<typeof timeline.listEntityTimeline>>['items'] = [];
    let cursor: string | undefined;
    for (let index = 0; index < 20; index++) {
      const page = await timeline.listEntityTimeline({ ...userRef(), limit, cursor }, { user });
      items.push(...page.items);
      if (!page.hasMore) return items;
      expect(page.nextCursor).toBeTruthy();
      cursor = page.nextCursor!;
    }
    throw new Error('Timeline pagination did not terminate');
  }

  it('executes registry describe and keyset section SQL with exact tenant binding and no duplicate subjects', async () => {
    const ids = [await createTask(tenantA, reader, 'QA one'), await createTask(tenantA, reader, 'QA two'), await createTask(tenantA, reader, 'QA three')];
    await attachTask(ids[0], tenantA, ['primary', 'related']);
    await attachTask(ids[1], tenantA); await attachTask(ids[2], tenantA);
    const foreignTask = await createTask(tenantB, foreignUser, 'must remain hidden');
    // Intentionally corrupt only this disposable fixture: the subject claims A,
    // while the task belongs to B. Both sides of the real SQL must be checked.
    await attachTask(foreignTask, tenantA);
    const described = await registry.describeEntityRelations(userRef(), { user: admin });
    expect(described.sections.some((section) => section.key === 'identity.user.tasks')).toBe(true);
    const first = await registry.listEntityRelation({ ...userRef(), sectionKey: 'identity.user.tasks', limit: 2 }, { user: admin });
    expect(first.items.map((item) => item.ref.key)).toEqual([String(ids[2]), String(ids[1])]);
    expect(first).toMatchObject({ hasMore: true });
    expect(first).not.toHaveProperty('total');
    const second = await registry.listEntityRelation({ ...userRef(), sectionKey: 'identity.user.tasks', limit: 2, cursor: first.nextCursor! }, { user: admin });
    expect(second.items.map((item) => item.ref.key)).toEqual([String(ids[0])]);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    const restricted = await registry.describeEntityRelations(userRef(), { user: reader });
    expect(restricted.sections.some((section) => section.key === 'identity.user.tasks')).toBe(false);
    await expect(registry.listEntityRelation({ ...userRef(), sectionKey: 'identity.user.tasks', limit: 2 }, { user: reader })).rejects.toMatchObject({ status: 404 });
    await expect(registry.describeEntityRelations({ type: 'identity.user', key: String(foreignUser.userId) }, { user: reader })).rejects.toMatchObject({ status: 404 });
  });

  it('finds an older failed task behind a newer successful task without leaking foreign attention', async () => {
    const oldFailure = await createTask(tenantA, reader, 'QA older failure');
    const latestSuccess = await createTask(tenantA, reader, 'QA recent success');
    await attachTask(oldFailure, tenantA); await attachTask(latestSuccess, tenantA);
    await storage.db.update(tables.asyncTasks).set({ status: 'failed' }).where(eq(tables.asyncTasks.id, oldFailure));
    await storage.db.update(tables.asyncTasks).set({ status: 'success' }).where(eq(tables.asyncTasks.id, latestSuccess));
    const attention = await registry.describeEntityRelations(userRef(), { user: admin });
    expect(attention.sections.find((section) => section.key === 'identity.user.tasks')?.summaryState).toBe('attention');
    await storage.db.update(tables.asyncTasks).set({ status: 'success' }).where(eq(tables.asyncTasks.id, oldFailure));
    const foreignFailure = await createTask(tenantB, foreignUser, 'QA hidden failure');
    await storage.db.update(tables.asyncTasks).set({ status: 'failed' }).where(eq(tables.asyncTasks.id, foreignFailure));
    await attachTask(foreignFailure, tenantA);
    const normal = await registry.describeEntityRelations(userRef(), { user: admin });
    expect(normal.sections.find((section) => section.key === 'identity.user.tasks')?.summaryState).toBe('has-data');
  });

  it('filters the entire authorized set before pagination and binds cursors to the filter', async () => {
    const first = await createTask(tenantA, reader, 'QA match older');
    const second = await createTask(tenantA, reader, 'QA match newer');
    for (const id of [first, second]) {
      await attachTask(id, tenantA);
      await storage.db.update(tables.asyncTasks).set({ status: 'failed', createdAt: new Date('2026-09-21T08:00:00Z') }).where(eq(tables.asyncTasks.id, id));
    }
    for (let index = 0; index < 7; index++) await attachTask(await createTask(tenantA, reader, 'unrelated success'), tenantA);
    const foreign = await createTask(tenantB, foreignUser, 'QA match foreign');
    await storage.db.update(tables.asyncTasks).set({ status: 'failed' }).where(eq(tables.asyncTasks.id, foreign));
    await attachTask(foreign, tenantA);
    const input = { ...userRef(), sectionKey: 'identity.user.tasks', limit: 1, keyword: 'QA match', status: 'failed', attentionOnly: true,
      startTime: '2026-09-21', endTime: '2026-09-21' };
    const page = await registry.listEntityRelation(input, { user: admin });
    expect(page.items.map((item) => item.ref.key)).toEqual([String(second)]);
    expect(page.hasMore).toBe(true);
    const next = await registry.listEntityRelation({ ...input, cursor: page.nextCursor! }, { user: admin });
    expect(next.items.map((item) => item.ref.key)).toEqual([String(first)]);
    expect(next.hasMore).toBe(false);
    await expect(registry.listEntityRelation({ ...input, keyword: 'different', cursor: page.nextCursor! }, { user: admin })).rejects.toMatchObject({ status: 400 });
  });

  it('recovers the transaction after one timed-out summary and retains healthy groups', async () => {
    const [{ summarizeRelationProviders }, { withRelationRead }] = await Promise.all([import('./summary'), import('./runtime')]);
    const provider = (key: string, slow = false): RelationProvider => ({ sourceType: 'identity.user', key, permissions: 'authenticated',
      descriptor: { key, labelKey: key, targetTypes: ['identity.user'], kind: 'direct', cardinality: 'many', capabilities: { view: true, open: true } },
      list: async () => ({ items: [], nextCursor: null, hasMore: false }),
      summaryQuery: () => slow ? sql<'empty'>`(select 'empty'::text from pg_sleep(1))` : sql<'has-data'>`'has-data'`,
    });
    const sections = await withRelationRead('describe', { user: admin }, (access) => summarizeRelationProviders(
      [provider('identity.user.slow', true), provider('identity.user.healthy')], { ref: userRef(), title: 'QA user', tenantId: tenantA }, access));
    expect(sections.map((section) => section.summaryState)).toEqual(['unavailable', 'has-data']);
  });

  it('creates one symmetric N:M edge, reads both directions, rejects cross-tenant/self links and unlinks in reverse', async () => {
    const task = taskRef(await createTask(tenantA, reader));
    await context.runWithCurrentUser(admin, async () => {
      await links.changeEntityLink(userRef(), task, false);
      await links.changeEntityLink(task, userRef(), false);
      expect(await storage.db.$count(tables.entityRelationEdges, eq(tables.entityRelationEdges.tenantId, tenantA))).toBe(1);
      await expect(links.changeEntityLink(userRef(), userRef(), false)).rejects.toMatchObject({ status: 400 });
      await expect(links.changeEntityLink(userRef(), { type: 'identity.user', key: String(foreignUser.userId) }, false)).rejects.toMatchObject({ status: 400 });
    });
    const forward = await registry.listEntityRelation({ ...userRef(), sectionKey: 'identity.user.links', limit: 2 }, { user: admin });
    const reverse = await registry.listEntityRelation({ ...task, sectionKey: 'tasks.async.links', limit: 2 }, { user: admin });
    expect(forward.items.map((item) => item.ref)).toEqual([task]);
    expect(reverse.items.map((item) => item.ref)).toEqual([userRef()]);
    await context.runWithCurrentUser(admin, () => links.changeEntityLink(task, userRef(), true));
    expect(await storage.db.$count(tables.entityRelationEdges, eq(tables.entityRelationEdges.tenantId, tenantA))).toBe(0);
  });

  it('keeps distinct manual relation types and removes a directional edge from its reverse endpoint', async () => {
    const task = taskRef(await createTask(tenantA, reader));
    await context.runWithCurrentUser(admin, async () => {
      await links.changeEntityLink(userRef(), task, false, { relationType: 'related' });
      await links.changeEntityLink(userRef(), task, false, { relationType: 'reference', note: '作为处理依据' });
    });
    const reverse = await registry.listEntityRelation({ ...task, sectionKey: 'tasks.async.links', limit: 5 }, { user: admin });
    expect(reverse.items.find((item) => item.manual?.type === 'reference')).toMatchObject({ subtitle: '被引用于', manual: { direction: 'incoming', note: '作为处理依据' } });
    await context.runWithCurrentUser(admin, () => links.changeEntityLink(task, userRef(), true, { relationType: 'reference', direction: 'incoming' }));
    const remaining = await registry.listEntityRelation({ ...userRef(), sectionKey: 'identity.user.links', limit: 5 }, { user: admin });
    expect(remaining.items).toHaveLength(1);
    expect(remaining.items[0].manual?.type).toBe('related');
  });

  it('hides forged cross-tenant, private and missing targets while retaining an owned target', async () => {
    const ownTask = taskRef(await createTask(tenantA, reader, 'owned task'));
    const privateTask = taskRef(await createTask(tenantA, admin, 'private task'));
    const foreignTask = taskRef(await createTask(tenantB, foreignUser, 'foreign task'));
    await context.runWithCurrentUser(admin, async () => {
      await links.changeEntityLink(userRef(), ownTask, false);
      await links.changeEntityLink(userRef(), privateTask, false);
    });
    await storage.db.insert(tables.entityRelationEdges).values([foreignTask, { type: 'tasks.async', key: '2147483647' }].map((target) => ({
      tenantId: tenantA, sourceType: 'identity.user', sourceKey: String(reader.userId), relationKey: 'platform.related', targetType: target.type, targetKey: target.key,
    })));
    const result = await registry.listEntityRelation({ ...userRef(), sectionKey: 'identity.user.links', limit: 1 }, { user: reader });
    expect(result.items.map((item) => item.ref)).toEqual([ownTask]);
    expect(result).toMatchObject({ hasMore: false, nextCursor: null });
    expect(result).not.toHaveProperty('total');
    const adminResult = await registry.listEntityRelation({ ...userRef(), sectionKey: 'identity.user.links', limit: 5 }, { user: admin });
    expect(adminResult.items.map((item) => item.ref.key).sort()).toEqual([ownTask.key, privateTask.key].sort());
  });

  it('paginates merged domain/audit timeline at microsecond precision and rechecks event permissions and source tenants', async () => {
    const ownTask = await createTask(tenantA, reader);
    const foreignTask = await createTask(tenantB, foreignUser);
    const at = '2026-09-20T04:00:00.123456Z';
    const event1 = await createTaskEvent(ownTask, at);
    const event2 = await createTaskEvent(ownTask, at);
    const older = await createTaskEvent(ownTask, '2026-09-20T04:00:00.123455Z');
    const hidden = await createTaskEvent(foreignTask, '2026-09-20T04:00:00.123459Z');
    const [notification] = await storage.db.insert(tables.notificationOutbox).values({ eventKey: 'qa.notification', recipients: [], tenantId: tenantA }).returning({ id: tables.notificationOutbox.id });
    const notificationEvent = await storage.db.transaction(async (tx) => {
      const id = await events.recordDomainEvent(tx, { eventType: 'messaging.notification.queued', source: { type: 'notification.outbox', key: String(notification.id) },
        payload: { eventKey: 'qa.notification' }, subjects: [{ ...userRef(), role: 'related' }], tenantId: tenantA });
      await tx.update(tables.domainEvents).set({ occurredAt: sql`${'2026-09-20T04:00:00.123457Z'}::timestamptz` }).where(eq(tables.domainEvents.id, id));
      return id;
    });
    const [audit] = await storage.db.insert(tables.operationLogs).values({ description: 'QA audited action', method: 'POST', path: '/qa', userId: admin.userId, tenantId: tenantA, createdAt: sql`${at}::timestamptz` }).returning({ id: tables.operationLogs.id });
    await storage.db.insert(tables.operationLogSubjects).values(['primary', 'related'].map((role) => ({ operationLogId: audit.id, tenantId: tenantA, entityType: 'identity.user', entityKey: String(reader.userId), role: role as 'primary' | 'related' })));
    const result = await collectTimeline(admin, 1);
    expect(result.map((item) => item.id)).toEqual([`event:${notificationEvent}`, `event:${event2}`, `event:${event1}`, `audit:${audit.id}`, `event:${older}`]);
    expect(result.map((item) => item.occurredAt)).toEqual(['2026-09-20T04:00:00.123457Z', at, at, at, '2026-09-20T04:00:00.123455Z']);
    expect(result.some((item) => item.id === `event:${hidden}`)).toBe(false);
    const limited = await collectTimeline(taskReader, 2);
    expect(limited.map((item) => item.id)).toEqual([`event:${event2}`, `event:${event1}`, `event:${older}`]);
    expect(await collectTimeline(reader, 2)).toEqual([]);
  });

  it('filters the complete authorized timeline and rejects cursors reused under changed filters', async () => {
    const ownTask = await createTask(tenantA, reader);
    await createTaskEvent(ownTask, '2026-09-20T04:00:00.000001Z');
    await createTaskEvent(ownTask, '2026-09-20T04:00:00.000002Z');
    await createTaskEvent(ownTask, '2026-09-19T04:00:00.000001Z');
    const filtered = { ...userRef(), limit: 1, eventType: 'tasks.async-task.created' as const, startTime: '2026-09-20', endTime: '2026-09-20' };
    const first = await timeline.listEntityTimeline(filtered, { user: admin });
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = await timeline.listEntityTimeline({ ...filtered, cursor: first.nextCursor! }, { user: admin });
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.items[0].id).not.toBe(first.items[0].id);
    await expect(timeline.listEntityTimeline({ ...filtered, eventType: 'platform.audit.operation', cursor: first.nextCursor! }, { user: admin })).rejects.toMatchObject({ status: 400 });
    await expect(timeline.listEntityTimeline({ ...filtered, endTime: '2026-09-21', cursor: first.nextCursor! }, { user: admin })).rejects.toMatchObject({ status: 400 });
    expect((await timeline.listEntityTimeline(filtered, { user: reader })).items).toEqual([]);
    // The source object's own timeline does not need a duplicated subject row.
    expect((await timeline.listEntityTimeline({ ...taskRef(ownTask), limit: 10 }, { user: admin })).items).toHaveLength(3);
  });

  it('rolls back business rows, domain events and subjects atomically', async () => {
    let taskId = 0;
    let eventId = 0;
    await expect(context.runWithCurrentUser(admin, () => storage.db.transaction(async (tx) => {
      const [task] = await tx.insert(tables.asyncTasks).values({ taskType: 'entity.rollback', title: 'rollback task', retryDelayMs: 1000, tenantId: tenantA }).returning({ id: tables.asyncTasks.id });
      taskId = task.id;
      eventId = await events.recordDomainEvent(tx, { eventType: 'tasks.async-task.created', source: taskRef(taskId), payload: { taskType: 'entity.rollback' }, tenantId: tenantA,
        subjects: [{ ...userRef(), role: 'related' }], dedupeKey: `${runId}:rollback` });
      throw new Error('rollback fixture');
    }))).rejects.toThrow('rollback fixture');
    expect(taskId).toBeGreaterThan(0);
    expect(eventId).toBeGreaterThan(0);
    expect(await storage.db.$count(tables.asyncTasks, eq(tables.asyncTasks.id, taskId))).toBe(0);
    expect(await storage.db.$count(tables.domainEvents, eq(tables.domainEvents.id, eventId))).toBe(0);
    expect(await storage.db.$count(tables.domainEventSubjects, eq(tables.domainEventSubjects.eventId, eventId))).toBe(0);
    expect(await storage.db.$count(tables.entityWatchEvents, eq(tables.entityWatchEvents.eventId, eventId))).toBe(0);
  });

  it('deduplicates overlapping watches and rechecks cancellation and live permissions before delayed delivery', async () => {
    const [{ changeEntityWatch }, { drainEntityWatchEvents }, { authorizeEntityWatchDelivery }] = await Promise.all([
      import('../entity-watches.service'), import('../entity-watch-worker'), import('../entity-watch-delivery-guard'),
    ]);
    const sourceId = await createTask(tenantA, taskReader, 'QA watched task');
    const relatedId = await createTask(tenantA, taskReader, 'QA watched source');
    await context.runWithCurrentUser(taskReader, async () => {
      await changeEntityWatch(taskRef(sourceId), true);
      await changeEntityWatch(taskRef(sourceId), true);
      await changeEntityWatch(taskRef(relatedId), true);
    });
    const eventId = await storage.db.transaction((tx) => events.recordDomainEvent(tx, { eventType: 'tasks.async-task.failed',
      source: taskRef(sourceId), subjects: [{ ...taskRef(relatedId), role: 'related' }], tenantId: tenantA,
      payload: { taskType: 'entity.qa', status: 'failed', attempt: 1 }, dedupeKey: `${runId}:watch-failed` }));
    await drainEntityWatchEvents();
    const notifications = await storage.db.select().from(tables.notificationOutbox).where(and(eq(tables.notificationOutbox.tenantId, tenantA), eq(tables.notificationOutbox.eventKey, 'platform.entity.changed')));
    expect(notifications).toHaveLength(1);
    expect(await storage.db.$count(tables.entityWatchEvents, eq(tables.entityWatchEvents.eventId, eventId))).toBe(0);
    const delayed = { ...notifications[0], scheduledAt: new Date(), vars: { ...notifications[0].vars, entityWatchDigestReady: true } };
    expect(await authorizeEntityWatchDelivery(delayed, { type: 'user', id: taskReader.userId })).not.toBeNull();
    await storage.db.delete(tables.userMenus).where(and(eq(tables.userMenus.userId, taskReader.userId), eq(tables.userMenus.menuId, menuIds[1])));
    try { expect(await authorizeEntityWatchDelivery(delayed, { type: 'user', id: taskReader.userId })).toBeNull(); }
    finally { await storage.db.insert(tables.userMenus).values({ userId: taskReader.userId, menuId: menuIds[1] }); }
    await context.runWithCurrentUser(taskReader, () => changeEntityWatch(taskRef(sourceId), false));
    expect(await authorizeEntityWatchDelivery(delayed, { type: 'user', id: taskReader.userId })).not.toBeNull();
    await context.runWithCurrentUser(taskReader, () => changeEntityWatch(taskRef(relatedId), false));
    expect(await authorizeEntityWatchDelivery(delayed, { type: 'user', id: taskReader.userId })).toBeNull();
    await context.runWithCurrentUser(taskReader, () => changeEntityWatch(taskRef(sourceId), true));
    expect(await authorizeEntityWatchDelivery(delayed, { type: 'user', id: taskReader.userId })).toBeNull();
  });

  it('does not lose a lower event id that commits after a later event was drained', async () => {
    const { drainEntityWatchEvents } = await import('../entity-watch-worker');
    const sourceId = await createTask(tenantA, taskReader);
    let release!: () => void;
    let reportId!: (id: number) => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const firstId = new Promise<number>((resolve) => { reportId = resolve; });
    const input = { eventType: 'tasks.async-task.created' as const, source: taskRef(sourceId), subjects: [{ ...taskRef(sourceId), role: 'primary' as const }], tenantId: tenantA, payload: { taskType: 'entity.qa' } };
    const lateCommit = storage.db.transaction(async (tx) => {
      const id = await events.recordDomainEvent(tx, input);
      reportId(id);
      await held;
      return id;
    });
    const older = await firstId;
    try {
      const newer = await storage.db.transaction((tx) => events.recordDomainEvent(tx, input));
      expect(newer).toBeGreaterThan(older);
      await drainEntityWatchEvents();
      expect(await storage.db.$count(tables.entityWatchEvents, eq(tables.entityWatchEvents.eventId, newer))).toBe(0);
    } finally { release(); }
    await lateCommit;
    expect(await storage.db.$count(tables.entityWatchEvents, eq(tables.entityWatchEvents.eventId, older))).toBe(1);
    await drainEntityWatchEvents();
    expect(await storage.db.$count(tables.entityWatchEvents, eq(tables.entityWatchEvents.eventId, older))).toBe(0);
  });

  it('deduplicates a committed event and refuses a different subject set under the same business key', async () => {
    const task = await createTask(tenantA, reader);
    const input = { eventType: 'tasks.async-task.created' as const, source: taskRef(task), payload: { taskType: 'entity.qa' }, tenantId: tenantA,
      subjects: [{ ...userRef(), role: 'related' as const }], dedupeKey: `${runId}:dedupe` };
    const first = await storage.db.transaction((tx) => events.recordDomainEvent(tx, input));
    const second = await storage.db.transaction((tx) => events.recordDomainEvent(tx, input));
    expect(second).toBe(first);
    expect(await storage.db.$count(tables.domainEventSubjects, eq(tables.domainEventSubjects.eventId, first))).toBe(1);
    await expect(storage.db.transaction((tx) => events.recordDomainEvent(tx, { ...input, subjects: [{ type: 'identity.user', key: String(taskReader.userId), role: 'related' }] }))).rejects.toThrow('different subjects');
    expect(await storage.db.$count(tables.domainEvents, and(eq(tables.domainEvents.tenantId, tenantA), eq(tables.domainEvents.dedupeKey, input.dedupeKey)))).toBe(1);
  });
});
