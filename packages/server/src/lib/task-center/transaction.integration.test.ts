import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { DbTransaction } from '../../db/types';
import type { JwtPayload } from '../../middleware/auth';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

// Requires a migrated, disposable local zenith_review database. The ordinary
// DATABASE_URL is never used, and all persistent fixtures are uniquely scoped.
integration('task-center real PostgreSQL transaction ownership', () => {
  const taskType = `integration-tx-${randomUUID()}`;
  const username = `tx-test-${randomUUID().slice(0, 8)}`;
  let database: typeof import('../../db');
  let schema: typeof import('../../db/schema');
  let runner: typeof import('./runner');
  let context: typeof import('../context');
  let policyConfig: typeof import('./config');
  let actor: JwtPayload;
  let otherClient: ReturnType<typeof postgres> | undefined;

  beforeAll(async () => {
    const url = new URL(testDatabaseUrl!);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_review') {
      throw new Error('TEST_DATABASE_URL must target a disposable local zenith_review database');
    }
    vi.stubEnv('DATABASE_URL', testDatabaseUrl!);
    vi.stubEnv('DATABASE_MAX_CONNECTIONS', '1');
    vi.stubEnv('MULTI_TENANT_MODE', 'false');
    vi.resetModules();
    database = await import('../../db');
    schema = await import('../../db/schema');
    context = await import('../context');
    runner = await import('./runner');
    policyConfig = await import('./config');
    const { config } = await import('../../config');
    expect(config.database.maxConnections).toBe(1);
    expect(config.databaseUrl).toBe(testDatabaseUrl);
    const { registerTaskHandler } = await import('./registry');
    registerTaskHandler({ taskType, title: 'Transaction integration', module: 'test', maxAttempts: 2, retryDelayMs: 6000, run: async () => {} });
    const [user] = await database.db.insert(schema.users).values({ username, nickname: 'before', password: 'test-only-not-a-login-hash' }).returning();
    actor = { userId: user.id, username, tenantId: null, roles: [] };
  }, 120_000);

  beforeEach(async () => {
    await database.db.delete(schema.asyncTasks).where(eq(schema.asyncTasks.taskType, taskType));
    await database.db.update(schema.users).set({ nickname: 'before' }).where(eq(schema.users.id, actor.userId));
    await database.db.insert(schema.asyncTaskTypeConfigs).values({ taskType, enabled: true, allowConcurrent: true, maxAttempts: 3, retryDelayMs: 7300 })
      .onConflictDoUpdate({ target: schema.asyncTaskTypeConfigs.taskType, set: { enabled: true, allowConcurrent: true, maxAttempts: 3, retryDelayMs: 7300 } });
  });

  afterAll(async () => {
    try {
      if (actor) {
        await database.db.delete(schema.asyncTasks).where(eq(schema.asyncTasks.taskType, taskType));
        await database.db.delete(schema.asyncTaskTypeConfigs).where(eq(schema.asyncTaskTypeConfigs.taskType, taskType));
        await database.db.delete(schema.users).where(eq(schema.users.id, actor.userId));
      }
    } finally {
      if (otherClient) await otherClient.end({ timeout: 1 });
      if (database) await database.closeDb();
      vi.unstubAllEnvs();
    }
  });

  const asActor = <T>(fn: () => Promise<T>) => context.runWithCurrentUser(actor, fn);

  it('submits and restarts using the only available database connection', async () => {
    const task = await asActor(() => database.db.transaction(async (tx) => {
      await tx.update(schema.users).set({ nickname: 'committed' }).where(eq(schema.users.id, actor.userId));
      return runner.persistAsyncTask(tx, { taskType });
    }));
    expect(task).toMatchObject({ status: 'pending', createdBy: actor.userId, maxAttempts: 3, retryDelayMs: 7300 });
    const [user] = await database.db.select().from(schema.users).where(eq(schema.users.id, actor.userId));
    expect(user.nickname).toBe('committed');
    await database.db.update(schema.asyncTasks).set({ status: 'failed', attempts: 1 }).where(eq(schema.asyncTasks.id, task.id));
    const restarted = await asActor(() => database.db.transaction((tx) => runner.restartAsyncTaskInTransaction(tx, task.id)));
    expect(restarted).toMatchObject({ id: task.id, status: 'pending', attempts: 0, retryDelayMs: 7300 });
  }, 10_000);

  it('propagates a real policy SELECT error and rolls back preceding business writes', async () => {
    await expect(asActor(() => database.db.transaction(async (tx) => {
      await tx.update(schema.users).set({ nickname: 'must-roll-back' }).where(eq(schema.users.id, actor.userId));
      // Only this connection sees the temporary table. The original config
      // reader must use tx and propagate its undefined-column error unchanged.
      await tx.execute(sql`create temporary table async_task_type_configs (task_type text) on commit drop`);
      return runner.persistAsyncTask(tx, { taskType });
    }))).rejects.toMatchObject({ cause: { code: '42703' } });
    const [user] = await database.db.select().from(schema.users).where(eq(schema.users.id, actor.userId));
    expect(user.nickname).toBe('before');
    expect(await database.db.$count(schema.asyncTasks, eq(schema.asyncTasks.taskType, taskType))).toBe(0);
  }, 10_000);

  it('rolls back business writes when the policy disables admission', async () => {
    await database.db.update(schema.asyncTaskTypeConfigs).set({ enabled: false }).where(eq(schema.asyncTaskTypeConfigs.taskType, taskType));
    await expect(asActor(() => database.db.transaction(async (tx) => {
      await tx.update(schema.users).set({ nickname: 'must-roll-back' }).where(eq(schema.users.id, actor.userId));
      return runner.persistAsyncTask(tx, { taskType });
    }))).rejects.toMatchObject({ status: 400 });
    const [user] = await database.db.select().from(schema.users).where(eq(schema.users.id, actor.userId));
    expect(user.nickname).toBe('before');
    expect(await database.db.$count(schema.asyncTasks, eq(schema.asyncTasks.taskType, taskType))).toBe(0);
  });

  it('atomically admits only one non-concurrent task across independent connections', async () => {
    await database.db.update(schema.asyncTaskTypeConfigs).set({ allowConcurrent: false }).where(eq(schema.asyncTaskTypeConfigs.taskType, taskType));
    otherClient = postgres(testDatabaseUrl!, { max: 1 });
    const otherDb = drizzle(otherClient, { schema, casing: 'snake_case' });
    const barrier = Promise.withResolvers<void>();
    let entered = 0;
    const attempt = async (tx: DbTransaction) => {
      entered += 1;
      if (entered === 2) barrier.resolve();
      await barrier.promise;
      return runner.persistAsyncTask(tx, { taskType });
    };
    const results = await asActor(() => Promise.allSettled([
      database.db.transaction(attempt),
      otherDb.transaction(attempt),
    ]));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ status: 'rejected', reason: { status: 400 } });
    expect(await database.db.$count(schema.asyncTasks, eq(schema.asyncTasks.taskType, taskType))).toBe(1);
  }, 10_000);

  it('preserves retry snapshots until an explicit restart refreshes them', async () => {
    const task = await asActor(() => database.db.transaction((tx) => runner.persistAsyncTask(tx, { taskType })));
    await database.db.update(schema.asyncTaskTypeConfigs).set({ maxAttempts: 5, retryDelayMs: 9100 }).where(eq(schema.asyncTaskTypeConfigs.taskType, taskType));
    const [persisted] = await database.db.select().from(schema.asyncTasks).where(eq(schema.asyncTasks.id, task.id));
    expect(persisted).toMatchObject({ maxAttempts: 3, retryDelayMs: 7300 });
    await database.db.update(schema.asyncTasks).set({ status: 'failed' }).where(eq(schema.asyncTasks.id, task.id));
    const restarted = await asActor(() => database.db.transaction((tx) => runner.restartAsyncTaskInTransaction(tx, task.id)));
    expect(restarted).toMatchObject({ maxAttempts: 5, retryDelayMs: 9100 });
  });

  it('uses registered defaults only when the policy row is absent', async () => {
    await database.db.delete(schema.asyncTaskTypeConfigs).where(eq(schema.asyncTaskTypeConfigs.taskType, taskType));
    const policy = await database.db.transaction((tx) => policyConfig.getTaskTypePolicy(tx, taskType));
    expect(policy).toMatchObject({ maxAttempts: 2, retryDelayMs: 6000, enabled: true });
  });
});
