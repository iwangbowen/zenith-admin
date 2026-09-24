import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rebuildRollup, materializeSegment } = vi.hoisted(() => ({
  rebuildRollup: vi.fn(async () => 42),
  materializeSegment: vi.fn(async () => ({ estimatedSize: 7 })),
}));

vi.mock('./analytics-rollup.service', () => ({ rebuildRollup }));
vi.mock('./analytics-segments.service', () => ({ materializeSegment }));

import { getTaskHandler } from '../../lib/task-center';
import { ANALYTICS_ROLLUP_REBUILD_TASK_TYPE, ANALYTICS_SEGMENT_MATERIALIZE_TASK_TYPE, registerAnalyticsTaskHandlers } from './analytics-tasks';
import type { TaskRunContext } from '../../lib/task-center/types';

describe('analytics-tasks — rollup rebuild task-center registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerAnalyticsTaskHandlers();
  });

  it('registers a non-concurrent handler with 2 max attempts and a 30s retry delay', () => {
    const handler = getTaskHandler(ANALYTICS_ROLLUP_REBUILD_TASK_TYPE);
    expect(handler).toBeTruthy();
    expect(handler?.allowConcurrent).toBe(false);
    expect(handler?.maxAttempts).toBe(2);
    expect(handler?.retryDelayMs).toBe(30_000);
  });

  it('reports start/completion progress and delegates to rebuildRollup(days)', async () => {
    const handler = getTaskHandler(ANALYTICS_ROLLUP_REBUILD_TASK_TYPE)!;
    const progress = vi.fn(async () => ({ cancelRequested: false }));
    const ctx: TaskRunContext = {
      taskId: 1, dispatchToken: 'test-run', attempt: 1, payload: { days: 14 }, checkpoint: null,
      progress, reportItems: vi.fn(async () => undefined), isCancelRequested: () => false,
    };
    const result = await handler.run(ctx);
    expect(rebuildRollup).toHaveBeenCalledWith(14);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls[0][0].note).toContain('开始重建');
    expect(progress.mock.calls[1][0].note).toContain('42');
    expect(result).toMatchObject({ days: 14, rebuiltRows: 42 });
  });

  it('clamps days to [1, 730]', async () => {
    const handler = getTaskHandler(ANALYTICS_ROLLUP_REBUILD_TASK_TYPE)!;
    const progress = vi.fn(async () => ({ cancelRequested: false }));
    const ctx: TaskRunContext = {
      taskId: 2, attempt: 1, payload: { days: 99999 }, checkpoint: null,
      progress, reportItems: vi.fn(async () => undefined), isCancelRequested: () => false,
    };
    await handler.run(ctx);
    expect(rebuildRollup).toHaveBeenCalledWith(730);
  });
});

describe('analytics-tasks — segment materialize task-center registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerAnalyticsTaskHandlers();
  });

  it('registers a non-concurrent handler with 2 max attempts and a 30s retry delay', () => {
    const handler = getTaskHandler(ANALYTICS_SEGMENT_MATERIALIZE_TASK_TYPE);
    expect(handler).toBeTruthy();
    expect(handler?.allowConcurrent).toBe(false);
    expect(handler?.maxAttempts).toBe(2);
    expect(handler?.retryDelayMs).toBe(30_000);
  });

  it('reports start/completion progress and delegates to materializeSegment(segmentId)', async () => {
    const handler = getTaskHandler(ANALYTICS_SEGMENT_MATERIALIZE_TASK_TYPE)!;
    const progress = vi.fn(async () => ({ cancelRequested: false }));
    const ctx: TaskRunContext = {
      taskId: 3, attempt: 1, payload: { segmentId: 9 }, checkpoint: null,
      progress, reportItems: vi.fn(async () => undefined), isCancelRequested: () => false,
    };
    const result = await handler.run(ctx);
    expect(materializeSegment).toHaveBeenCalledWith(9);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls[0][0].note).toContain('开始重算');
    expect(progress.mock.calls[1][0].note).toContain('7');
    expect(result).toMatchObject({ segmentId: 9, estimatedSize: 7 });
  });

  it('rejects a non-positive-integer segmentId before calling materializeSegment', async () => {
    const handler = getTaskHandler(ANALYTICS_SEGMENT_MATERIALIZE_TASK_TYPE)!;
    const progress = vi.fn(async () => ({ cancelRequested: false }));
    const ctx: TaskRunContext = {
      taskId: 4, attempt: 1, payload: { segmentId: -1 }, checkpoint: null,
      progress, reportItems: vi.fn(async () => undefined), isCancelRequested: () => false,
    };
    await expect(handler.run(ctx)).rejects.toThrow('无效的分群 ID');
    expect(materializeSegment).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric segmentId payload', async () => {
    const handler = getTaskHandler(ANALYTICS_SEGMENT_MATERIALIZE_TASK_TYPE)!;
    const progress = vi.fn(async () => ({ cancelRequested: false }));
    const ctx: TaskRunContext = {
      taskId: 5, attempt: 1, payload: { segmentId: 'not-a-number' }, checkpoint: null,
      progress, reportItems: vi.fn(async () => undefined), isCancelRequested: () => false,
    };
    await expect(handler.run(ctx)).rejects.toThrow('无效的分群 ID');
    expect(materializeSegment).not.toHaveBeenCalled();
  });
});

