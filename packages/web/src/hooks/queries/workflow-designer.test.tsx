/**
 * 设计器 lookup 归属所有者域：连接器下拉的 key 由 workflowConnectorContract.list 派生，
 * 连接器管理页保存后随 lists 前缀一起回源。曾经它藏在 ['workflow','designer','connectors','options'] 下，
 * 只有 ['workflow'] 全域广播才碰得到，连接器改名后设计器里最长 5 分钟显示旧名。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { workflowConnectorContract, workflowDefinitionContract } from '@zenith/shared/workflow';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper, isFresh } from '@/test-utils/query-harness';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));

import { useSaveWorkflowDesignerDefinition, useWorkflowDesignerConnectorOptions, workflowDesignerKeys } from './workflow-designer';
import { useSaveWorkflowConnector } from './workflow-connectors';
import { usePublishedWorkflowDefinitions, useWorkflowDefinitionList, workflowDefinitionKeys } from './workflow-definitions';

const CONNECTORS_URL = workflowConnectorContract.list.fullPath;
const DEFINITIONS_URL = workflowDefinitionContract.list.fullPath;
const PUBLISHED_URL = workflowDefinitionContract.published.fullPath;

beforeEach(() => {
  recorder.reset();
  recorder
    .on('GET', CONNECTORS_URL, { list: [{ id: 1, name: '钉钉', type: 'http' }], total: 1, page: 1, pageSize: 100 })
    .on('POST', CONNECTORS_URL, { id: 2, name: '飞书', type: 'http' })
    .on('GET', DEFINITIONS_URL, { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', PUBLISHED_URL, [])
    .on('POST', DEFINITIONS_URL, { id: 5, name: '报销', status: 'draft', version: 1 });
});

describe('workflow designer lookups', () => {
  it('maps connector options through select and refetches them after a connector is saved elsewhere', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({
      options: useWorkflowDesignerConnectorOptions(),
      save: useSaveWorkflowConnector(),
    }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.options.isSuccess).toBe(true));
    expect(result.current.options.data).toEqual([{ value: 1, label: '钉钉（http）' }]);
    expect(qc.getQueryData(workflowDesignerKeys.connectorOptions)).toBeDefined();

    recorder.on('GET', CONNECTORS_URL, { list: [{ id: 1, name: '钉钉', type: 'http' }, { id: 2, name: '飞书', type: 'http' }], total: 2, page: 1, pageSize: 100 });
    recorder.resetCalls();
    await result.current.save.mutateAsync({ values: { name: '飞书', type: 'http' } });
    await waitFor(() => expect(recorder.countOf('GET', CONNECTORS_URL)).toBe(1));
    await waitFor(() => expect(result.current.options.data).toHaveLength(2));
  });

  it('creating a definition from the designer refetches the definition list but not the published lookup', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(() => ({
      list: useWorkflowDefinitionList({ page: 1, pageSize: 10 }),
      published: usePublishedWorkflowDefinitions(),
      save: useSaveWorkflowDesignerDefinition(),
    }), { wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.list.isSuccess && result.current.published.isSuccess).toBe(true));

    recorder.resetCalls();
    await result.current.save.mutateAsync({ values: { name: '报销', flowData: { nodes: [], edges: [] } } });
    expect(recorder.calls.find((c) => c.method === 'POST')?.url).toBe(DEFINITIONS_URL);
    await waitFor(() => expect(recorder.countOf('GET', DEFINITIONS_URL)).toBe(1));
    expect(recorder.countOf('GET', PUBLISHED_URL)).toBe(0);
    expect(isFresh(qc, workflowDefinitionKeys.published)).toBe(true);
  });
});
