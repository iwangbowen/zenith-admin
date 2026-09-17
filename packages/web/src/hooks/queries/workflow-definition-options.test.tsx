import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { workflowDefinitionContract, workflowInstanceContract } from '@zenith/shared/workflow';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper } from '@/test-utils/query-harness';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));

import {
  useWorkflowDefinitionOptions, usePublishedWorkflowDefinitions,
  usePublishWorkflowDefinition, useDisableWorkflowDefinition, useEnableWorkflowDefinition,
  useDeleteWorkflowDefinition, useBatchDisableWorkflowDefinitions, useBatchEnableWorkflowDefinitions,
  useBatchDeleteWorkflowDefinitions, useDuplicateWorkflowDefinition, useImportWorkflowDefinition,
} from './workflow-definitions';
import { useWorkflowMonitorDefinitionOptions } from './workflow-monitor';
import { useSaveWorkflowDesignerDefinition } from './workflow-designer';
import { usePendingWorkflowDefinitionOptions, invalidateWorkflowPendingViews } from './workflow-tasks';
import { invalidateAfterInstanceChange } from './workflow-instances';

const lookupUrl = workflowDefinitionContract.all.fullPath;
const publishedUrl = workflowDefinitionContract.published.fullPath;
const pendingUrl = workflowInstanceContract.pendingDefinitionOptions.fullPath;
const external = { id: 7, name: '业务审批', status: 'published', formType: 'external' };

beforeEach(() => {
  recorder.reset();
  recorder.on('GET', lookupUrl, [external]).on('GET', publishedUrl, []).on('GET', pendingUrl, [external]);
});

describe('workflow definition option sources', () => {
  it('shares lightweight lookup between configuration and monitoring while launch uses its own filtered data', async () => {
    const { result } = renderHook(() => ({
      binding: useWorkflowDefinitionOptions(), monitor: useWorkflowMonitorDefinitionOptions(),
      launch: usePublishedWorkflowDefinitions(), pending: usePendingWorkflowDefinitionOptions(),
    }), { wrapper: createWrapper(createTestQueryClient()) });
    await waitFor(() => {
      expect(result.current.binding.data).toEqual([external]);
      expect(result.current.monitor.data).toEqual([external]);
      expect(result.current.pending.data).toEqual([external]);
      expect(result.current.launch.data).toEqual([]);
    });
    expect(recorder.countOf('GET', lookupUrl)).toBe(1);
    expect(recorder.countOf('GET', publishedUrl)).toBe(1);
    expect(recorder.countOf('GET', pendingUrl)).toBe(1);
  });

  it.each([
    ['publish', usePublishWorkflowDefinition, '/7/publish', { params: { id: 7 } }],
    ['disable', useDisableWorkflowDefinition, '/7/disable', { params: { id: 7 } }],
    ['enable', useEnableWorkflowDefinition, '/7/enable', { params: { id: 7 } }],
    ['delete', useDeleteWorkflowDefinition, '/7', { params: { id: 7 } }],
    ['batch disable', useBatchDisableWorkflowDefinitions, '/batch-disable', { body: { ids: [7] } }],
    ['batch enable', useBatchEnableWorkflowDefinitions, '/batch-enable', { body: { ids: [7] } }],
    ['batch delete', useBatchDeleteWorkflowDefinitions, '/batch-delete', { body: { ids: [7] } }],
    ['duplicate', useDuplicateWorkflowDefinition, '/7/duplicate', { params: { id: 7 } }],
    ['import', useImportWorkflowDefinition, '/import', { body: { name: '导入' } }],
    ['save', useSaveWorkflowDesignerDefinition, '/7', { id: 7, values: { name: '重命名' } }],
  ] as const)('refreshes long-lived lookup after %s', async (_name, useMutation, suffix, variables) => {
    const method = _name === 'delete' ? 'DELETE' : _name === 'save' ? 'PUT' : 'POST';
    recorder.on(method, `${workflowDefinitionContract.basePath}${suffix}`, external);
    const { result } = renderHook(() => ({ options: useWorkflowDefinitionOptions(), pending: usePendingWorkflowDefinitionOptions(), mutation: useMutation() }),
      { wrapper: createWrapper(createTestQueryClient()) });
    await waitFor(() => {
      expect(result.current.options.data).toEqual([external]);
      expect(result.current.pending.data).toEqual([external]);
    });
    recorder.on('GET', lookupUrl, [{ ...external, name: '更新后的流程' }]);
    recorder.on('GET', pendingUrl, [{ ...external, name: '更新后的流程' }]);
    // 各 mutation 的载荷类型不同，此表按操作分别提供合法形状；统一调用仅在测试中窄化。
    await result.current.mutation.mutateAsync(variables as never);
    await waitFor(() => {
      expect(result.current.options.data?.[0].name).toBe('更新后的流程');
      expect(result.current.pending.data?.[0].name).toBe('更新后的流程');
    });
    expect(recorder.countOf('GET', lookupUrl)).toBe(2);
  });

  it.each([invalidateWorkflowPendingViews, invalidateAfterInstanceChange])('refreshes pending options on task changes without refetching definition lookup', async (invalidate) => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({ pending: usePendingWorkflowDefinitionOptions(), lookup: useWorkflowDefinitionOptions() }),
      { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.pending.isSuccess && result.current.lookup.isSuccess).toBe(true));
    recorder.on('GET', pendingUrl, []);
    invalidate(qc);
    await waitFor(() => expect(result.current.pending.data).toEqual([]));
    expect(recorder.countOf('GET', pendingUrl)).toBe(2);
    expect(recorder.countOf('GET', lookupUrl)).toBe(1);
  });
});
