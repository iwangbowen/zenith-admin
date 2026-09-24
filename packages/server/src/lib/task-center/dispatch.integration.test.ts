import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asyncTaskDispatchOptions } from './dispatch-policy';

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString ? describe : describe.skip;
integration('durable task-message identity with real pg-boss standard queues', () => {
  let boss: PgBoss;
  const queue = `dispatch-proof-${randomUUID()}`;
  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_review') throw new Error('Requires a disposable local zenith_review database');
    boss = new PgBoss({ connectionString, schedule: false, supervise: false, max: 2 });
    await boss.start(); await boss.createQueue(queue, { policy: 'standard' });
  });
  afterAll(async () => { if (boss) { await boss.deleteQueue(queue); await boss.stop(); } });
  it('deduplicates simultaneous sends, active sends, and retains distinct retry/restart rounds', async () => {
    const token = randomUUID();
    const options = asyncTaskDispatchOptions({ id: 42, dispatchToken: token });
    const sent = await Promise.all(Array.from({ length: 12 }, () => boss.send(queue, { taskId: 42, dispatchToken: token }, options)));
    expect(sent.filter(Boolean)).toEqual([token]);
    const jobs = await boss.fetch(queue);
    expect(jobs).toHaveLength(1);
    expect(await boss.send(queue, { taskId: 42, dispatchToken: token }, options)).toBeNull();
    await boss.complete(queue, token);
    expect(await boss.send(queue, { taskId: 42, dispatchToken: token }, options)).toBeNull();
    const retry = randomUUID();
    expect(await boss.sendAfter(queue, { taskId: 42, dispatchToken: retry }, asyncTaskDispatchOptions({ id: 42, dispatchToken: retry }), new Date(Date.now() + 60000))).toBe(retry);
    expect(await boss.sendAfter(queue, { taskId: 42, dispatchToken: retry }, asyncTaskDispatchOptions({ id: 42, dispatchToken: retry }), new Date(Date.now() + 60000))).toBeNull();
    await boss.deleteJob(queue, token);
    expect(await boss.send(queue, { taskId: 42, dispatchToken: token }, options)).toBe(token);
  });
});
