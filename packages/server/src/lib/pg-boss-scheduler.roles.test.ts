/**
 * 角色门控：声明在任何角色都发生，执行（work / cron monitor / 对账）只在 worker 角色。
 * 用假 PgBoss 记录调用；三种角色下分别加载模块并比较注册表——这是「声明漂移」的结构性守卫。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Scheduler = typeof import('./pg-boss-scheduler');

const fake = vi.hoisted(() => {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string) => (...args: unknown[]) => { (calls[name] ??= []).push(args); };
  const ctorOptions: Array<Record<string, unknown>> = [];
  /** 额外的队列（用例按需塞入下线节点的节点队列） */
  const extraQueues: Array<Record<string, unknown>> = [];
  class PgBoss {
    constructor(options: Record<string, unknown>) { ctorOptions.push(options); }
    on = record('on');
    start = async () => { record('start')(); };
    stop = async (...args: unknown[]) => { record('stop')(...args); };
    schemaVersion = async () => 27;
    detectSchemaDrift = async () => ({
      ok: true, missingTables: [], missing: [], invalid: [], mismatched: [],
      missingFunctions: [], mismatchedFunctions: [], columnDrift: [], constraintDrift: [], enumDrift: false,
    });
    getQueue = async () => null;
    getQueues = async () => [
      { name: 'async-tasks', queuedCount: 12, deferredCount: 4, readyCount: 8, activeCount: 3, failedCount: 1, totalCount: 40 },
      { name: 'cron-jobs', queuedCount: 0, deferredCount: 0, readyCount: 0, activeCount: 1, failedCount: 0, totalCount: 5 },
      { name: '__pgboss__send-it', queuedCount: 9, deferredCount: 0, readyCount: 9, activeCount: 0, failedCount: 0, totalCount: 9 },
      ...extraQueues,
    ];
    createQueue = async (...args: unknown[]) => { record('createQueue')(...args); };
    updateQueue = async (...args: unknown[]) => { record('updateQueue')(...args); };
    work = async (...args: unknown[]) => { record('work')(...args); return `worker-${(calls.work ?? []).length}`; };
    offWork = async (...args: unknown[]) => { record('offWork')(...args); };
    schedule = async (...args: unknown[]) => { record('schedule')(...args); };
    unschedule = async (...args: unknown[]) => { record('unschedule')(...args); };
    getSchedules = async () => [];
    deleteQueue = async (...args: unknown[]) => { record('deleteQueue')(...args); };
    findJobs = async () => [];
    cancel = async () => undefined;
    send = async (...args: unknown[]) => { record('send')(...args); return 'job-1'; };
    sendAfter = async () => 'job-2';
    deleteJob = async () => undefined;
    notifyWorker = record('notifyWorker');
    getWipData = () => [];
    isMaintaining = () => false;
    getBamStatus = async () => [];
  }
  const reset = () => { for (const key of Object.keys(calls)) delete calls[key]; ctorOptions.length = 0; extraQueues.length = 0; };
  return { PgBoss, calls, ctorOptions, extraQueues, reset };
});

vi.mock('pg-boss', () => ({ PgBoss: fake.PgBoss }));
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./alert-dispatch', () => ({ dispatchAlertChannels: vi.fn() }));
vi.mock('./db-backup', () => ({ createPgDumpBackup: vi.fn(), createDrizzleExportBackup: vi.fn() }));
vi.mock('./captcha', () => ({ cleanExpiredCaptchas: vi.fn() }));
vi.mock('../services/messaging/notification-outbox.service', () => ({ notify: vi.fn() }));
// 任意链式查询都能走通的 db 替身：insert 链解析为一行 { id: 1 }（returning），其余解析为空结果
vi.mock('../db', () => {
  const chain = (root: string): unknown => new Proxy(() => chain(root), {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve(root === 'insert' ? [{ id: 1 }] : []);
      return () => chain(root);
    },
    apply: () => chain(root),
  });
  const db = new Proxy({}, { get: (_t, prop: string) => () => chain(prop) });
  return { db };
});

const baseConfig = {
  databaseUrl: 'postgres://test',
  otel: { serviceVersion: 'test', enabled: false },
  redis: { keyPrefix: 'test:' },
  log: { level: 'info' },
};

async function loadScheduler(roles: 'api' | 'worker' | 'all'): Promise<Scheduler> {
  vi.resetModules();
  fake.reset();
  const api = roles !== 'worker';
  const worker = roles !== 'api';
  vi.doMock('../config', () => ({
    config: {
      ...baseConfig,
      roles: { api, worker, explicit: true, list: [...(api ? ['api'] : []), ...(worker ? ['worker'] : [])], label: roles },
    },
  }));
  const mod = await import('./pg-boss-scheduler');
  vi.doUnmock('../config');
  return mod;
}

async function declareAll(s: Scheduler): Promise<void> {
  await s.initCronScheduler();
  await s.registerSystemQueueWorker({ name: 'demo-queue', title: '演示队列', module: '测试', handler: async () => undefined });
  await s.registerSystemRecurringJob({ name: 'demo-recurring', title: '演示周期任务', module: '测试', cronExpression: '*/5 * * * *', run: async () => 'ok' });
}

afterEach(() => vi.doUnmock('../config'));

describe('api 角色（只发不执行）', () => {
  it('pg-boss 以 send-only 参数构造，不注册任何轮询 worker，但队列与 schedule 照常声明', async () => {
    const s = await loadScheduler('api');
    await declareAll(s);
    expect(fake.ctorOptions[0]).toMatchObject({ supervise: false, schedule: false, max: 2 });
    expect(fake.calls.work).toBeUndefined();
    const queues = (fake.calls.createQueue ?? []).map(([name]) => name);
    expect(queues).toEqual(expect.arrayContaining([s.CRON_JOBS_QUEUE, s.SYSTEM_RECURRING_QUEUE, 'demo-queue']));
    expect((fake.calls.schedule ?? []).map(([queue, , , opts]) => [queue, (opts as { key: string }).key]))
      .toEqual([[s.SYSTEM_RECURRING_QUEUE, 'demo-recurring']]);
    expect(s.schedulerExecutesJobs()).toBe(false);
  });

  it('孤儿对账与队列对账拒绝在 api 角色执行', async () => {
    const s = await loadScheduler('api');
    await declareAll(s);
    await expect(s.purgeOrphanSystemTasks()).rejects.toThrow(/worker 角色/);
    await expect(s.reconcileSchedulerQueues()).rejects.toThrow(/worker 角色/);
  });

  it('手动触发只投递，不因缺少本地 worker 而调用 notifyWorker', async () => {
    const s = await loadScheduler('api');
    await declareAll(s);
    // runSystemRecurringJobNow 需要 allowManualRun 与策略；这里只验证 send 路径不抛
    await s.registerSystemRecurringJob({ name: 'manual-job', title: '手动', module: '测试', cronExpression: '0 0 * * *', allowManualRun: true, run: async () => 'ok' });
    await s.runSystemRecurringJobNow('manual-job', null);
    expect(fake.calls.notifyWorker).toBeUndefined();
    expect(fake.calls.send?.some(([queue]) => queue === s.SYSTEM_RECURRING_QUEUE)).toBe(true);
  });

  it('forceLocal 的系统队列在 api 角色也会激活本地 worker（节点亲和队列的唯一例外）', async () => {
    const s = await loadScheduler('api');
    await s.initCronScheduler();
    await s.registerSystemQueueWorker({ name: 'local-only', title: '本地', module: '测试', forceLocal: true, handler: async () => undefined });
    expect((fake.calls.work ?? []).map(([name]) => name)).toEqual(['local-only']);
  });

  it('registerLocalNodeQueueWorker 无论角色都消费本进程独有的节点队列', async () => {
    const s = await loadScheduler('api');
    await s.initCronScheduler();
    const name = await s.registerLocalNodeQueueWorker('async-tasks', async () => undefined);
    expect(name).toMatch(/^async-tasks\/node\/[\w.-]+$/);
    expect((fake.calls.work ?? []).map(([queue]) => queue)).toEqual([name]);
    // 幂等
    await s.registerLocalNodeQueueWorker('async-tasks', async () => undefined);
    expect(fake.calls.work).toHaveLength(1);
  });
});

describe('worker 角色（执行）', () => {
  it('pg-boss 开启 supervise 与 cron monitor，两条调度队列与系统队列都注册轮询 worker', async () => {
    const s = await loadScheduler('worker');
    await declareAll(s);
    expect(fake.ctorOptions[0]).toMatchObject({ supervise: true, schedule: true });
    expect(fake.ctorOptions[0]).not.toHaveProperty('max');
    const worked = (fake.calls.work ?? []).map(([name]) => name);
    expect(worked).toEqual(expect.arrayContaining([s.CRON_JOBS_QUEUE, s.SYSTEM_RECURRING_QUEUE, 'demo-queue']));
    expect(s.schedulerExecutesJobs()).toBe(true);
    await expect(s.purgeOrphanSystemTasks()).resolves.toBeUndefined();
  });
});

describe('声明漂移守卫', () => {
  it('三种角色下的注册表（系统队列 / 周期任务 / cron handler）完全一致', async () => {
    const snapshots: Record<string, unknown> = {};
    for (const roles of ['api', 'worker', 'all'] as const) {
      const s = await loadScheduler(roles);
      await declareAll(s);
      const intro = s.getSchedulerIntrospection();
      snapshots[roles] = {
        queues: intro.systemQueueWorkers.map((w) => w.name).sort(),
        recurring: intro.systemRecurringJobs.map((j) => j.name).sort(),
        handlers: [...intro.registeredHandlers].sort(),
      };
      expect(intro.node.roles).toEqual(roles === 'all' ? ['api', 'worker'] : [roles]);
    }
    expect(snapshots.api).toEqual(snapshots.worker);
    expect(snapshots.worker).toEqual(snapshots.all);
  });
});

describe('队列积压读数', () => {
  it('getQueueDepths 排除 pg-boss 内部队列，ready 取 readyCount；getQueueBacklog 为各队列 ready 之和', async () => {
    const s = await loadScheduler('api');
    await s.initCronScheduler();
    const depths = await s.getQueueDepths();
    expect(depths.map((d) => d.queue)).toEqual(['async-tasks', 'cron-jobs']);
    expect(depths[0]).toEqual({ queue: 'async-tasks', ready: 8, deferred: 4, active: 3, failed: 1, total: 40 });
    await expect(s.getQueueBacklog()).resolves.toBe(8);
  });

  it('pg-boss 未初始化时返回空读数，不抛错', async () => {
    const s = await loadScheduler('api');
    await expect(s.getQueueDepths()).resolves.toEqual([]);
    await expect(s.getQueueBacklog()).resolves.toBe(0);
  });
});

describe('gcDeadNodeQueues', () => {
  it('只在 worker 角色执行；回收无心跳节点的队列，保留本进程的节点队列，不动普通队列', async () => {
    const api = await loadScheduler('api');
    await api.initCronScheduler();
    await expect(api.gcDeadNodeQueues()).rejects.toThrow(/worker 角色/);

    const s = await loadScheduler('worker');
    await s.initCronScheduler();
    const mine = await s.registerLocalNodeQueueWorker('async-tasks', async () => undefined);
    // db 替身的 select 返回 []：没有任何节点有近期心跳 → 除本进程外的节点队列都视为下线
    fake.extraQueues.push(
      { name: mine, readyCount: 0 },
      { name: 'async-tasks/node/dead-host_1', readyCount: 0 },
      { name: 'async-tasks/node/dead-host_2', readyCount: 3 },
    );
    fake.calls.deleteQueue = [];
    await expect(s.gcDeadNodeQueues()).resolves.toBe(2);
    expect(fake.calls.deleteQueue.map(([name]) => name).sort()).toEqual(['async-tasks/node/dead-host_1', 'async-tasks/node/dead-host_2']);
  });
});

describe('nodeQueueName', () => {
  it('把进程标识折成 pg-boss 允许的字符', async () => {
    const s = await loadScheduler('all');
    expect(s.nodeQueueName('async-tasks', 'ASUS-Vivobook:4321')).toBe('async-tasks/node/ASUS-Vivobook_4321');
    expect(s.nodeQueueName('async-tasks', 'host with spaces:1')).toBe('async-tasks/node/host_with_spaces_1');
  });
});

describe('stopAllJobs', () => {
  it('worker 把排空预算传入 pg-boss graceful stop；api 的 send-only 实例非 graceful 即时关闭', async () => {
    const worker = await loadScheduler('worker');
    await worker.initCronScheduler();
    await worker.stopAllJobs(45_000);
    expect(fake.calls.stop?.[0]).toEqual([{ graceful: true, timeout: 45_000 }]);

    const api = await loadScheduler('api');
    await api.initCronScheduler();
    await api.stopAllJobs(45_000);
    expect(fake.calls.stop?.[0]).toEqual([{ graceful: false }]);
  });

  it('api 持有本地节点队列时仍等待其在飞作业收尾', async () => {
    const s = await loadScheduler('api');
    await s.initCronScheduler();
    await s.registerLocalNodeQueueWorker('async-tasks', async () => undefined);
    await s.stopAllJobs(20_000);
    expect(fake.calls.offWork?.[0]?.[1]).toEqual({ wait: true });
    expect(fake.calls.deleteQueue?.[0]?.[0]).toMatch(/^async-tasks\/node\//);
    expect(fake.calls.stop?.[0]).toEqual([{ graceful: true, timeout: 20_000 }]);
  });
});

describe('ensureLocalNodeQueue（节点队列被误删后的自愈）', () => {
  it('队列不存在时按原参数重建；仍存在或非本进程队列时不动', async () => {
    const s = await loadScheduler('api');
    await s.initCronScheduler();
    const name = await s.registerLocalNodeQueueWorker('async-tasks', async () => undefined, { retentionSeconds: 60 });
    expect(fake.calls.createQueue?.some(([n]) => n === name)).toBe(true);
    fake.reset();

    // getQueue 缺省返回 null（不存在）→ 重建
    await expect(s.ensureLocalNodeQueue(name)).resolves.toBe(true);
    expect(fake.calls.createQueue).toEqual([[name, { retentionSeconds: 60 }]]);
    // 非本进程的队列不处理
    await expect(s.ensureLocalNodeQueue('async-tasks/node/other_1')).resolves.toBe(false);
  });

  it('isQueueNotFoundError 识别 pg-boss 三种队列缺失表现，不误判其他错误', async () => {
    const s = await loadScheduler('all');
    // manager.getQueueCache（send / sendAfter）
    expect(s.isQueueNotFoundError(new Error('Queue async-tasks/node/x does not exist'))).toBe(true);
    // timekeeper.schedule 的外键改写
    expect(s.isQueueNotFoundError(new Error('Queue async-tasks/node/x not found'))).toBe(true);
    // 队列缓存仍命中、INSERT 撞外键（postgres 错误带 code）
    expect(s.isQueueNotFoundError(Object.assign(new Error('insert or update on table "job" violates foreign key constraint "q_fkey"'), { code: '23503' }))).toBe(true);
    expect(s.isQueueNotFoundError(new Error('connection refused'))).toBe(false);
    expect(s.isQueueNotFoundError('not an error')).toBe(false);
  });
});
