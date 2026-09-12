/**
 * system-scheduler 域缓存一致性契约
 *
 * 收敛前四个写操作都按域根广播，任务清单 / 运行日志 / 节点心跳 / 运行详情一并回源。收敛后：
 *  1. 手动执行：任务行（最近运行状态）+ 运行日志；节点清单保持 fresh
 *  2. 保存任务配置：只动任务行
 *  3. 确认告警：运行列表 + 该条运行详情 + 任务行 alertCount
 *  4. 清理运行日志：运行列表回源、未挂载的运行详情缓存移除；任务行与节点保持 fresh
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  hasCacheEntry,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  systemSchedulerKeys,
  useAcknowledgeSystemSchedulerAlert,
  useCleanupSystemSchedulerRuns,
  useRunSystemSchedulerTask,
  useSaveSystemSchedulerTaskConfig,
  useSystemSchedulerNodes,
  useSystemSchedulerRunDetail,
  useSystemSchedulerRuns,
  useSystemSchedulerTasks,
} from './system-scheduler';

const RUN_PARAMS = { page: 1, pageSize: 20 };
const NODE_PARAMS = { page: 1, pageSize: 10 };
const RUN = { id: 7, taskName: 'cleanup', status: 'success' };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/system-scheduler/tasks', [{ name: 'cleanup', title: '清理', alertCount: 1 }])
    .on('GET', '/api/system-scheduler/runs', { list: [RUN], total: 1, page: 1, pageSize: 20 })
    .on('GET', '/api/system-scheduler/runs/7', RUN)
    .on('GET', '/api/system-scheduler/nodes', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('POST', '/api/system-scheduler/tasks/cleanup/run', { message: 'ok' })
    .on('PUT', '/api/system-scheduler/tasks/cleanup/config', { name: 'cleanup' })
    .on('POST', '/api/system-scheduler/runs/7/ack-alert', RUN)
    .on('POST', '/api/system-scheduler/runs/cleanup', { deleted: 3 });
});

async function mountPage() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      tasks: useSystemSchedulerTasks(),
      runs: useSystemSchedulerRuns(RUN_PARAMS),
      nodes: useSystemSchedulerNodes(NODE_PARAMS),
      run: useRunSystemSchedulerTask(),
      saveConfig: useSaveSystemSchedulerTaskConfig(),
      ack: useAcknowledgeSystemSchedulerAlert(),
      cleanup: useCleanupSystemSchedulerRuns(),
    }),
    { wrapper: createWrapper(qc) },
  );
  await waitFor(() => {
    expect(hook.result.current.tasks.isSuccess).toBe(true);
    expect(hook.result.current.runs.isSuccess).toBe(true);
    expect(hook.result.current.nodes.isSuccess).toBe(true);
  });
  return { qc, hook };
}

describe('useRunSystemSchedulerTask', () => {
  it('refetches tasks and runs but leaves the node heartbeat list fresh', async () => {
    const { qc, hook } = await mountPage();
    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.run.mutateAsync({ params: { name: 'cleanup' } });
    await waitFor(() => {
      expect(fetches.countOf(systemSchedulerKeys.tasks)).toBe(1);
      expect(fetches.countOf(systemSchedulerKeys.runs)).toBe(1);
    });

    expect(fetches.countOf(systemSchedulerKeys.nodes)).toBe(0);
    expect(isFresh(qc, systemSchedulerKeys.nodeList(NODE_PARAMS))).toBe(true);
    fetches.stop();
  });
});

describe('useSaveSystemSchedulerTaskConfig', () => {
  it('only refetches the task list', async () => {
    const { qc, hook } = await mountPage();
    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.saveConfig.mutateAsync({
      params: { name: 'cleanup' },
      body: { enabled: true, logRetentionDays: 30, logRetentionRuns: 1000, failureAlertThreshold: 3, alertEnabled: false, manualSingleton: true },
    });
    await waitFor(() => expect(fetches.countOf(systemSchedulerKeys.tasks)).toBe(1));

    expect(fetches.countOf(systemSchedulerKeys.runs)).toBe(0);
    expect(isFresh(qc, systemSchedulerKeys.runList(RUN_PARAMS))).toBe(true);
    expect(isFresh(qc, systemSchedulerKeys.nodeList(NODE_PARAMS))).toBe(true);
    fetches.stop();
  });
});

describe('useAcknowledgeSystemSchedulerAlert', () => {
  it('refetches the run list, the acknowledged run detail and the task alert counters', async () => {
    const { qc, hook } = await mountPage();
    const detail = renderHook(() => useSystemSchedulerRunDetail(7), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.ack.mutateAsync({ params: { id: 7 }, body: { note: '已处理' } });
    await waitFor(() => {
      expect(fetches.countOf(systemSchedulerKeys.runs)).toBe(1);
      expect(fetches.countOf(systemSchedulerKeys.runDetail(7))).toBe(1);
      expect(fetches.countOf(systemSchedulerKeys.tasks)).toBe(1);
    });

    expect(isFresh(qc, systemSchedulerKeys.nodeList(NODE_PARAMS))).toBe(true);
    fetches.stop();
  });
});

describe('useCleanupSystemSchedulerRuns', () => {
  it('refetches the run list, drops inactive run details, and leaves tasks / nodes fresh', async () => {
    const { qc, hook } = await mountPage();
    // 抽屉已关闭遗留的运行详情：清理后可能已不存在，应移除而非失效
    qc.setQueryData(systemSchedulerKeys.runDetail(7), RUN);
    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.cleanup.mutateAsync({ query: { taskName: 'cleanup' } });
    await waitFor(() => expect(fetches.countOf(systemSchedulerKeys.runs)).toBe(1));

    expect(hasCacheEntry(qc, systemSchedulerKeys.runDetail(7))).toBe(false);
    expect(api.countOf('GET', '/api/system-scheduler/runs/7')).toBe(0);
    expect(fetches.countOf(systemSchedulerKeys.tasks)).toBe(0);
    expect(isFresh(qc, systemSchedulerKeys.tasks)).toBe(true);
    expect(isFresh(qc, systemSchedulerKeys.nodeList(NODE_PARAMS))).toBe(true);
    fetches.stop();
  });
});
