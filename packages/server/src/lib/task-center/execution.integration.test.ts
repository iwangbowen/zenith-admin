import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;
integration('task business fences and domain settlement with real PostgreSQL', () => {
  let database: typeof import('../../db');
  let schema: typeof import('../../db/schema');
  let execution: typeof import('./execution');
  let settlement: typeof import('./settlement');
  let userId: number;
  let rejectSettlement = false;
  const taskType = `execution-proof-${randomUUID()}`;
  beforeAll(async () => {
    const url = new URL(testDatabaseUrl!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_review') throw new Error('Requires a disposable local zenith_review database');
    vi.stubEnv('DATABASE_URL', testDatabaseUrl!);
    vi.resetModules();
    database = await import('../../db'); schema = await import('../../db/schema');
    execution = await import('./execution'); settlement = await import('./settlement');
    const [user] = await database.db.insert(schema.users).values({ username: `fence-${randomUUID()}`, nickname: 'before', password: 'test-only' }).returning();
    userId = user.id;
    const { registerTaskHandler } = await import('./registry');
    registerTaskHandler({ taskType, title: 'Fence proof', module: 'test', run: async () => {},
      async settleInTransaction(tx, task) {
        await tx.update(schema.users).set({ nickname: task.status }).where(eq(schema.users.id, userId));
        if (rejectSettlement) throw new Error('settlement rejected');
      },
    });
  });
  afterAll(async () => {
    if (database) {
      await database.db.delete(schema.asyncTasks).where(eq(schema.asyncTasks.taskType, taskType));
      if (userId) await database.db.delete(schema.users).where(eq(schema.users.id, userId));
      await database.closeDb();
    }
    vi.unstubAllEnvs();
  });
  async function task(patch: Partial<typeof schema.asyncTasks.$inferInsert> = {}) {
    const [row] = await database.db.insert(schema.asyncTasks).values({ taskType, title: 'Fence proof', status: 'running', heartbeatAt: new Date(), ...patch }).returning();
    return row;
  }
  async function nickname() { return (await database.db.query.users.findFirst({ where: eq(schema.users.id, userId), columns: { nickname: true } }))!.nickname; }
  it.each(['token', 'heartbeat', 'cancel', 'deadline'] as const)('rejects %s before a privilege-like business write', async reason => {
    const row = await task(reason === 'heartbeat' ? { heartbeatAt: new Date(Date.now() - 120_000) } : reason === 'cancel' ? { cancelRequested: true } : {});
    await database.db.update(schema.users).set({ nickname: 'before' }).where(eq(schema.users.id, userId));
    await expect(execution.runWithTaskExecution({ taskId: row.id, dispatchToken: reason === 'token' ? randomUUID() : row.dispatchToken,
      deadline: new Date(Date.now() + (reason === 'deadline' ? -1_000 : 60_000)) }, () => execution.taskTransaction(async tx => {
      await tx.update(schema.users).set({ nickname: 'must-not-commit' }).where(eq(schema.users.id, userId));
    }))).rejects.toBeInstanceOf(execution.TaskExecutionLostError);
    expect(await nickname()).toBe('before');
  });
  it('rolls back a business write and token mutation when ownership is lost before commit', async () => {
    const row = await task();
    await expect(execution.runWithTaskExecution({ taskId: row.id, dispatchToken: row.dispatchToken, deadline: new Date(Date.now() + 60_000) }, () => execution.taskTransaction(async tx => {
      await tx.update(schema.users).set({ nickname: 'must-not-commit' }).where(eq(schema.users.id, userId));
      await tx.update(schema.asyncTasks).set({ dispatchToken: randomUUID() }).where(eq(schema.asyncTasks.id, row.id));
    }))).rejects.toBeInstanceOf(execution.TaskExecutionLostError);
    expect(await nickname()).toBe('before');
    expect((await database.db.query.asyncTasks.findFirst({ where: eq(schema.asyncTasks.id, row.id) }))!.dispatchToken).toBe(row.dispatchToken);
  });
  it('commits a live owner and rolls both task and domain states back when settlement fails', async () => {
    const row = await task();
    await execution.runWithTaskExecution({ taskId: row.id, dispatchToken: row.dispatchToken, deadline: new Date(Date.now() + 60_000) }, () => execution.taskTransaction(async tx => {
      await tx.update(schema.users).set({ nickname: 'live-owner' }).where(eq(schema.users.id, userId));
    }));
    expect(await nickname()).toBe('live-owner');
    rejectSettlement = true;
    await expect(settlement.transitionAsyncTasks({ status: 'failed' }, eq(schema.asyncTasks.id, row.id))).rejects.toThrow('settlement rejected');
    expect(await nickname()).toBe('live-owner');
    expect((await database.db.query.asyncTasks.findFirst({ where: eq(schema.asyncTasks.id, row.id) }))!.status).toBe('running');
    rejectSettlement = false;
    await settlement.transitionAsyncTasks({ status: 'cancelled' }, eq(schema.asyncTasks.id, row.id));
    expect(await nickname()).toBe('cancelled');
  });
  it('locates a system task by its full business scope and retries with a new execution token', async () => {
    const key = randomUUID();
    const system = await task({ status: 'failed', idempotencyKey: key });
    const userTask = await task({ status: 'failed', idempotencyKey: key, createdBy: userId });
    const runner = await import('./runner');
    const retried = await database.db.transaction(async tx => {
      const locked = await runner.lockSystemTask(tx, { taskType, idempotencyKey: key, tenantId: null });
      expect(locked.id).toBe(system.id);
      return runner.retrySystemTaskInTransaction(tx, locked);
    });
    expect(retried.status).toBe('pending'); expect(retried.dispatchToken).not.toBe(system.dispatchToken);
    expect(await nickname()).toBe('pending');
    expect((await database.db.query.asyncTasks.findFirst({ where: eq(schema.asyncTasks.id, userTask.id) }))!.status).toBe('failed');
  });
});
