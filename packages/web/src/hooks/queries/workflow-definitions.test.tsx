/**
 * 可发起流程的消费者共用一份缓存，发布后即时刷新。
 * 记录筛选 / 关联 / 业务绑定使用独立轻量 lookup，见 workflow-definition-options.test.tsx。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import { LOOKUP_STALE_TIME } from '@/lib/query';
import {
  usePublishWorkflowDefinition,
  usePublishedWorkflowDefinitions,
  workflowDefinitionKeys,
} from './workflow-definitions';

const DEF = { id: 1, name: '请假审批', status: 'published' };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/workflows/definitions/published', [DEF])
    .on('POST', '/api/workflows/definitions/1/publish', null);
});

describe('已发布定义只保留一份缓存', () => {
  it('serves every consumer from a single cache entry instead of one per call site', async () => {
    const qc = createTestQueryClient();
    // 启动列表（默认 staleTime）与子流程目标选择器（5 分钟 staleTime）同时挂载
    const { result } = renderHook(
      () => ({
        launchpad: usePublishedWorkflowDefinitions(),
        subProcessPicker: usePublishedWorkflowDefinitions({ staleTime: LOOKUP_STALE_TIME }),
        schedules: usePublishedWorkflowDefinitions(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.launchpad.isSuccess).toBe(true);
      expect(result.current.subProcessPicker.isSuccess).toBe(true);
      expect(result.current.schedules.isSuccess).toBe(true);
    });

    // 三份缓存时这里会是 3
    expect(api.countOf('GET', '/api/workflows/definitions/published')).toBe(1);
    const entries = qc
      .getQueryCache()
      .getAll()
      .filter((q) => JSON.stringify(q.queryKey).includes('published'));
    expect(entries).toHaveLength(1);
  });

  it('refreshes the subprocess picker after publishing, which the designer-scoped cache never did', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        // 子流程选择器的 5 分钟 staleTime 曾让它在发布后长时间读不到新定义
        subProcessPicker: usePublishedWorkflowDefinitions({ staleTime: LOOKUP_STALE_TIME }),
        publish: usePublishWorkflowDefinition(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.subProcessPicker.isSuccess).toBe(true));

    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.publish.mutateAsync({ params: { id: 1 } });

    // 失效会覆盖 staleTime，长缓存不再是「发布后读不到」的借口
    await waitFor(() => {
      expect(fetches.countOf(workflowDefinitionKeys.published)).toBe(1);
      expect(api.countOf('GET', '/api/workflows/definitions/published')).toBe(1);
    });

    fetches.stop();
  });
});
