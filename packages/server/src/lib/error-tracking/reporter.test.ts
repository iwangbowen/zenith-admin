/**
 * 服务端异常采集器行为测试：缓冲 / 批量落库、指纹级与全局限流（count-only）、熔断、防重标记、
 * 内建过滤与忽略规则、logger 兜底网接线。store / settings / 上下文全部 mock，不触达数据库。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';

const mocks = vi.hoisted(() => ({
  recordErrorEventBatch: vi.fn(async (inputs: unknown[]) => inputs.map((_, index) => ({ groupId: index + 1, isNewGroup: true, count: 1 }))),
  bumpErrorGroupCounts: vi.fn(async () => undefined),
  getSettings: vi.fn(async () => { throw new Error('settings unavailable'); }),
  currentUser: undefined as { userId: number; username: string; tenantId: number | null } | undefined,
  correlationId: 'req-1' as string | undefined,
  fatalShutdown: false,
  warn: vi.fn(),
}));

vi.mock('./store', () => ({
  recordErrorEventBatch: mocks.recordErrorEventBatch,
  bumpErrorGroupCounts: mocks.bumpErrorGroupCounts,
}));
vi.mock('../settings', () => ({ getSettings: mocks.getSettings }));
vi.mock('../context', () => ({ currentUserOrNull: () => mocks.currentUser }));
vi.mock('../member-context', () => ({ currentMemberOrNull: () => undefined }));
vi.mock('../trace-context', () => ({ currentCorrelationId: () => mocks.correlationId }));
vi.mock('../fatal-handlers', () => ({ isFatalShutdownInProgress: () => mocks.fatalShutdown }));
vi.mock('../process-identity', () => ({ PROCESS_HOSTNAME: 'host-a', PROCESS_PID: 4242 }));
vi.mock('../../config', () => ({
  config: {
    nodeEnv: 'production',
    roles: { label: 'api' },
    otel: { enabled: false, serviceVersion: '2.36.0' },
    // logger 在模块加载期读取；测试进程直写 stdout，级别 error 保证 error 写入点仍触发 hook
    log: { level: 'error', dir: 'logs', maxFiles: 1, pretty: false },
  },
}));

import logger from '../logger';
import {
  __resetErrorReporterForTests,
  captureException,
  errorReporterStats,
  flushErrorReporter,
  isCaptured,
  onErrorRecorded,
  startErrorReporter,
  stopErrorReporter,
} from './reporter';
import type { ErrorEventInput } from './types';

function storedInputs(): ErrorEventInput[] {
  return mocks.recordErrorEventBatch.mock.calls.flatMap((call) => call[0] as ErrorEventInput[]);
}

function defaultRecordImpl(inputs: unknown[]) {
  return Promise.resolve(inputs.map((_, index) => ({ groupId: index + 1, isNewGroup: true, count: 1 })));
}

describe('captureException', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.recordErrorEventBatch.mockReset();
    mocks.recordErrorEventBatch.mockImplementation(defaultRecordImpl);
    mocks.bumpErrorGroupCounts.mockClear();
    mocks.currentUser = undefined;
    mocks.correlationId = 'req-1';
    mocks.fatalShutdown = false;
    __resetErrorReporterForTests();
  });

  afterEach(async () => {
    await stopErrorReporter(10);
    vi.useRealTimers();
  });

  it('归一化 + 上下文注入 → flush 后成批落库，事件带 correlationId / 主机 / 角色 / 版本', async () => {
    mocks.currentUser = { userId: 7, username: 'alice', tenantId: 3 };
    const err = Object.assign(new Error('relation "x" does not exist'), { name: 'PostgresError', code: '42P01' });
    captureException(err, {
      request: { method: 'GET', url: 'http://localhost/api/users/7?x=1', route: '/api/users/{id}', status: 500, headers: {} },
      extra: { hint: 'seed' },
    });
    expect(isCaptured(err)).toBe(true);
    expect(mocks.recordErrorEventBatch).not.toHaveBeenCalled();

    await flushErrorReporter();
    const [input] = storedInputs();
    expect(input).toMatchObject({
      tenantId: null,
      source: 'server',
      appId: 'server',
      environment: 'production',
      errorType: 'server_exception',
      level: 'error',
      message: 'relation "x" does not exist',
      release: '2.36.0',
      identity: 'u:7',
    });
    expect(input.event).toMatchObject({
      correlationId: 'req-1',
      route: '/api/users/{id}',
      httpStatus: 500,
      httpMethod: 'GET',
      errorName: 'PostgresError',
      errorCode: '42P01',
      userId: 7,
      username: 'alice',
      affectedTenantId: 3,
      processRole: 'api',
      hostname: 'host-a',
      pid: 4242,
    });
    expect((input.event.context as Record<string, unknown>).extra).toEqual({ hint: 'seed' });
    expect(errorReporterStats().stored).toBe(1);
  });

  it('作业失败：非终态为 warning，终态为 error；jobType / jobId 进事件列', async () => {
    captureException(new Error('timeout'), { kind: 'job_failure', job: { type: 'export', id: 99, attempt: 1, maxAttempts: 3, final: false } });
    captureException(new Error('timeout'), { kind: 'job_failure', job: { type: 'export', id: 99, attempt: 3, maxAttempts: 3, final: true } });
    await flushErrorReporter();
    const [retryable, final] = storedInputs();
    expect(retryable.level).toBe('warning');
    expect(final.level).toBe('error');
    expect(final.event).toMatchObject({ jobType: 'export', jobId: '99' });
  });

  it('同一 Error 对象只记一次；已标记的对象经兜底网再次进入被跳过', async () => {
    const err = new Error('once');
    captureException(err);
    captureException(err, { kind: 'logged_error', message: '[x] failed' });
    await flushErrorReporter();
    expect(storedInputs()).toHaveLength(1);
  });

  it('内建过滤：HTTPException < 500、客户端中断、停机中不记；force 可强制', async () => {
    captureException(new HTTPException(404, { message: 'not found' }));
    captureException(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }));
    captureException(Object.assign(new Error('abort'), { name: 'AbortError' }));
    mocks.fatalShutdown = true;
    captureException(new Error('during shutdown'));
    mocks.fatalShutdown = false;
    captureException(new HTTPException(500, { message: 'boom' }));
    captureException(new HTTPException(400, { message: 'forced' }), { force: true });
    await flushErrorReporter();
    expect(storedInputs().map((i) => i.message)).toEqual(['boom', 'forced']);
  });

  it('忽略规则（正则）命中即不记，无效正则被跳过', async () => {
    __resetErrorReporterForTests({ ignorePatterns: ['^noise', '(unclosed'] });
    captureException(new Error('noise: dev only'));
    captureException(new Error('real problem'));
    await flushErrorReporter();
    expect(storedInputs().map((i) => i.message)).toEqual(['real problem']);
    expect(errorReporterStats().ignored).toBe(1);
  });

  it('指纹级限流：超出每分钟上限的事件只累加次数（count-only），令牌随时间补充', async () => {
    __resetErrorReporterForTests({ perIssuePerMinute: 2, globalPerMinute: 1000 });
    for (let i = 0; i < 5; i += 1) captureException(new TypeError('same bug'));
    await flushErrorReporter();
    expect(storedInputs()).toHaveLength(2);
    expect(mocks.bumpErrorGroupCounts).toHaveBeenCalledTimes(1);
    const bumps = mocks.bumpErrorGroupCounts.mock.calls[0][0] as Array<{ count: number }>;
    expect(bumps).toHaveLength(1);
    expect(bumps[0].count).toBe(3);
    expect(errorReporterStats().countOnly).toBe(3);

    // 一分钟后令牌补满，又能保存事件详情
    vi.advanceTimersByTime(60_000);
    mocks.recordErrorEventBatch.mockClear();
    captureException(new TypeError('same bug'));
    await flushErrorReporter();
    expect(storedInputs()).toHaveLength(1);
  });

  it('全局限流：不同指纹的首个事件不受全局闸约束，其余超出部分只累加次数', async () => {
    __resetErrorReporterForTests({ perIssuePerMinute: 1000, globalPerMinute: 2 });
    captureException(new Error('a'));
    captureException(new Error('a'));
    captureException(new Error('a'));
    captureException(new Error('a'));
    captureException(new Error('brand new'));
    await flushErrorReporter();
    const messages = storedInputs().map((i) => i.message);
    // a 的首个事件走「新指纹」通道，之后两个消耗全局令牌，第 4 个进 count-only；brand new 作为新指纹放行
    expect(messages.filter((m) => m === 'a')).toHaveLength(3);
    expect(messages).toContain('brand new');
    expect(errorReporterStats().countOnly).toBe(1);
  });

  it('缓冲上限：超出 500 条直接丢弃并计数', async () => {
    __resetErrorReporterForTests({ perIssuePerMinute: 10_000, globalPerMinute: 100_000 });
    // 每条不同消息 → 不同指纹，绕开限流；达到 50 条会触发一次 flush，这里让 flush 挂起以填满缓冲
    let release: () => void = () => undefined;
    mocks.recordErrorEventBatch.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]); }));
    for (let i = 0; i < 700; i += 1) captureException(new Error(`distinct ${i} ${'x'.repeat(i % 7)}`));
    expect(errorReporterStats().dropped).toBeGreaterThan(0);
    expect(errorReporterStats().pending).toBeLessThanOrEqual(500);
    release();
    await flushErrorReporter();
  });

  it('熔断：连续 3 次落库失败后暂停 30 秒，期间丢弃缓冲；到期后恢复写入', async () => {
    mocks.recordErrorEventBatch.mockRejectedValue(new Error('db down'));
    for (let round = 0; round < 3; round += 1) {
      captureException(new Error(`fail ${round}`));
      await flushErrorReporter();
    }
    expect(errorReporterStats().flushFailures).toBe(3);
    expect(errorReporterStats().paused).toBe(true);

    captureException(new Error('while paused'));
    await flushErrorReporter();
    expect(mocks.recordErrorEventBatch).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(30_001);
    mocks.recordErrorEventBatch.mockImplementation(async (inputs: unknown[]) => inputs.map(() => ({ groupId: 1, isNewGroup: false, count: 2 })));
    captureException(new Error('after resume'));
    await flushErrorReporter();
    expect(storedInputs().at(-1)?.message).toBe('after resume');
    expect(errorReporterStats().paused).toBe(false);
  });

  it('落库监听器收到每条事件与写入结果（告警评估由上层注册）', async () => {
    const seen: Array<[string, boolean]> = [];
    const off = onErrorRecorded((input, recorded) => { seen.push([input.message, recorded.isNewGroup]); });
    captureException(new Error('listen me'));
    await flushErrorReporter();
    expect(seen).toEqual([['listen me', true]]);
    off();
  });

  it('设置刷新：读到设置后按新开关生效；读失败沿用上一份', async () => {
    mocks.getSettings.mockResolvedValueOnce({
      enabled: false, captureLoggedErrors: true, perIssuePerMinute: 60, globalPerMinute: 600,
      request: { captureBody: true, bodyMaxBytes: 4096, redactKeys: [] }, ignorePatterns: [],
    } as never);
    await flushErrorReporter();
    await vi.advanceTimersByTimeAsync(0);
    captureException(new Error('disabled now'));
    await flushErrorReporter();
    expect(storedInputs()).toHaveLength(0);
  });

  it('startErrorReporter 接管 logger.error 兜底网：携带 Error 的 error 日志成为 logged_error 事件，warn 不进', async () => {
    startErrorReporter();
    const err = new Error('job exploded');
    logger.error('[task-center] 执行失败', err);
    logger.error({ err: new Error('native style') }, '原生写法');
    logger.warn('[x] 只是警告', new Error('ignored'));
    logger.error('没有 Error 对象的错误日志');
    await flushErrorReporter();
    const inputs = storedInputs();
    expect(inputs.map((i) => [i.errorType, i.message])).toEqual([
      ['logged_error', '[task-center] 执行失败: job exploded'],
      ['logged_error', '原生写法: native style'],
    ]);
    expect(isCaptured(err)).toBe(true);
  });

  it('captureLoggedErrors=false 时兜底网不记，显式采集不受影响', async () => {
    __resetErrorReporterForTests({ captureLoggedErrors: false });
    startErrorReporter();
    logger.error('[x] failed', new Error('via logger'));
    captureException(new Error('explicit'));
    await flushErrorReporter();
    expect(storedInputs().map((i) => i.message)).toEqual(['explicit']);
  });
});
