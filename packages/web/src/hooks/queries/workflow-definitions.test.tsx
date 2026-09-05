/**
 * 已发布流程定义的单一缓存契约
 *
 * `/api/workflows/definitions/published` 曾在三处各建一份缓存：
 *   - workflowDefinitionKeys.published            （启动列表、日程绑定等 5 个页面）
 *   - workflowDesignerKeys.publishedDefinitionOptions（设计器关联流程选择器，staleTime 5 分钟）
 *   - ['workflow','tasks','definitions']          （待办筛选下拉）
 *
 * 而发布走 `workflowDefinitionKeys.all = ['workflow','definitions']`，前缀盖不到后两个，
 * 新发布的定义在那两个下拉里最长 5 分钟不出现。
 *
 * 断言落在实际请求与缓存条目数上：只 spy invalidateQueries 无法区分「三份缓存」与
 * 「一份缓存」，因为两种写法下失效调用完全相同。
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
    // 启动列表（默认 staleTime）与设计器关联流程选择器（5 分钟 staleTime）同时挂载
    const { result } = renderHook(
      () => ({
        launchpad: usePublishedWorkflowDefinitions(),
        designerPicker: usePublishedWorkflowDefinitions({ staleTime: LOOKUP_STALE_TIME }),
        pendingFilter: usePublishedWorkflowDefinitions(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.launchpad.isSuccess).toBe(true);
      expect(result.current.designerPicker.isSuccess).toBe(true);
      expect(result.current.pendingFilter.isSuccess).toBe(true);
    });

    // 三份缓存时这里会是 3
    expect(api.countOf('GET', '/api/workflows/definitions/published')).toBe(1);
    const entries = qc
      .getQueryCache()
      .getAll()
      .filter((q) => JSON.stringify(q.queryKey).includes('published'));
    expect(entries).toHaveLength(1);
  });

  it('refreshes the designer picker after publishing, which the designer-scoped cache never did', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        // 设计器选择器的 5 分钟 staleTime 曾让它在发布后长时间读不到新定义
        designerPicker: usePublishedWorkflowDefinitions({ staleTime: LOOKUP_STALE_TIME }),
        publish: usePublishWorkflowDefinition(),
      }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.designerPicker.isSuccess).toBe(true));

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
