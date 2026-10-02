import { afterEach, describe, expect, it } from 'vitest';
import type { AnyOperation } from '@zenith/shared/core';
import { WORKFLOW_RETURN_TO_INITIATOR_KEY, workflowDefinitionContract, workflowInstanceContract, workflowTaskContract, type WorkflowFlowData, type WorkflowNodeConfig } from '@zenith/shared/workflow';
import { mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks } from './data/workflow';
import { workflowHandlers } from './handlers/workflow';
import { workflowExtraHandlers } from './handlers/workflow-extra';
import { mockAccessToken } from './utils/auth';
import { resetMockApprovalState } from './utils/workflow-approval';

const stores = [mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks];
const snapshots = stores.map(store => structuredClone(store));
afterEach(() => {
  stores.forEach((store, index) => { (store as unknown[]).splice(0, store.length, ...structuredClone(snapshots[index])); });
  resetMockApprovalState();
});
const node = (key: string, type: WorkflowNodeConfig['type'] = 'approve', config: Partial<WorkflowNodeConfig> = {}) => ({
  id: key, type, position: { x: 0, y: 0 }, data: { key, label: key, type, assigneeId: 1, signaturePolicy: 'none' as const, ...config },
});
const edge = (source: string, target: string, config: Partial<WorkflowFlowData['edges'][number]> = {}) => ({ id: `${source}-${target}`, source, target, ...config });
function definition(nodes: WorkflowFlowData['nodes'], edges: WorkflowFlowData['edges']) {
  const item = { ...structuredClone(mockWorkflowDefinitions[0]), id: 930001, name: '图推进验证', status: 'published' as const,
    formFields: [{ key: 'amount', label: '金额', type: 'number' as const }], flowData: { nodes, edges } };
  mockWorkflowDefinitions.push(item); return item;
}
async function call(operation: AnyOperation, body: unknown = {}, params: Record<string, number> = {}) {
  let path = operation.fullPath;
  for (const [key, value] of Object.entries(params)) path = path.replace(`{${key}}`, String(value));
  for (const handler of [...workflowExtraHandlers, ...workflowHandlers]) {
    const request = new Request(new URL(path, window.location.origin), { method: operation.method.toUpperCase(),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${mockAccessToken('admin')}` }, body: JSON.stringify(body) });
    const result = await (handler as unknown as { run(args: unknown): Promise<{ response?: Response } | null> }).run({ request, requestId: crypto.randomUUID() });
    if (result?.response) return { status: result.response.status, body: await result.response.json() };
  }
  throw new Error(`No handler for ${path}`);
}
async function start(formData: Record<string, unknown> = {}) {
  const result = await call(workflowInstanceContract.create, { definitionId: 930001, title: '完整业务流程', formData });
  expect(result.status).toBe(200); return mockWorkflowInstances.find(item => item.id === result.body.data.id)!;
}
const openKeys = (id: number) => mockWorkflowTasks.filter(task => task.instanceId === id && (task.status === 'pending' || task.status === 'waiting')).map(task => task.nodeKey);
async function approve(id: number, key: string) {
  const task = mockWorkflowTasks.find(item => item.instanceId === id && item.nodeKey === key && item.status === 'pending')!;
  expect(task).toBeDefined();
  const result = await call(workflowTaskContract.approve, {}, { taskId: task.id }); expect(result.status).toBe(200);
}

describe('Demo workflow follows the graph after formal approval', () => {
  it('advances a travel request through manager and finance for single and batch handling', async () => {
    definition([node('start', 'start'), node('manager'), node('finance'), node('end', 'end')], [edge('start', 'manager'), edge('manager', 'finance'), edge('finance', 'end')]);
    const instance = await start(); expect(openKeys(instance.id)).toEqual(['manager']);
    await approve(instance.id, 'manager');
    expect(instance.status).toBe('running'); expect(openKeys(instance.id)).toEqual(['finance']);
    const task = mockWorkflowTasks.find(item => item.instanceId === instance.id && item.nodeKey === 'finance')!;
    expect((await call(workflowTaskContract.batchApprove, { taskIds: [task.id] })).body.data.succeeded).toBe(1);
    expect(instance.status).toBe('approved'); expect(openKeys(instance.id)).toEqual([]);
  });

  it.each([500, 5000])('takes the amount branch for %s instead of the first approval in the nodes array', async amount => {
    definition([node('start', 'start'), node('expensive'), node('condition', 'exclusiveGateway'), node('ordinary'), node('end', 'end')],
      [edge('start', 'condition'), edge('condition', 'expensive', { condition: { field: 'amount', operator: 'gte', value: 1000 } }), edge('condition', 'ordinary'), edge('expensive', 'end'), edge('ordinary', 'end')]);
    const instance = await start({ amount });
    const key = amount >= 1000 ? 'expensive' : 'ordinary'; expect(openKeys(instance.id)).toEqual([key]);
    await approve(instance.id, key); expect(instance.status).toBe('approved');
    expect(mockWorkflowTasks.filter(task => task.instanceId === instance.id)).toHaveLength(1);
  });

  it('waits for both procurement branches before creating the director task', async () => {
    definition([node('start', 'start'), node('split', 'parallelGateway'), node('finance'), node('purchase'), node('join', 'parallelGateway'), node('director'), node('end', 'end')],
      [edge('start', 'split'), edge('split', 'finance'), edge('split', 'purchase'), edge('finance', 'join'), edge('purchase', 'join'), edge('join', 'director'), edge('director', 'end')]);
    const instance = await start(); expect(openKeys(instance.id)).toEqual(['finance', 'purchase']);
    await approve(instance.id, 'finance'); expect(openKeys(instance.id)).toEqual(['purchase']); expect(instance.status).toBe('running');
    await approve(instance.id, 'purchase'); expect(openKeys(instance.id)).toEqual(['director']);
    await approve(instance.id, 'director'); expect(instance.status).toBe('approved');
  });

  it('keeps the after-sign group as a barrier before the next business node', async () => {
    definition([node('start', 'start'), node('manager', 'approve', { approveMethod: 'or' }), node('finance'), node('end', 'end')],
      [edge('start', 'manager'), edge('manager', 'finance'), edge('finance', 'end')]);
    const instance = await start(); const base = mockWorkflowTasks.find(task => task.instanceId === instance.id)!;
    const added = await call(workflowTaskContract.addSign, { targetUserIds: [2], position: 'after', signMode: 'and' }, { taskId: base.id });
    expect(added.status).toBe(200); const extra = mockWorkflowTasks.find(task => task.id === added.body.data.created[0].id)!;
    expect(extra.status).toBe('waiting'); await approve(instance.id, 'manager');
    expect(extra.status).toBe('pending'); expect(openKeys(instance.id)).toEqual(['manager']);
    await approve(instance.id, 'manager'); expect(openKeys(instance.id)).toEqual(['finance']);
  });

  it('uses the same planner for excluded/unknown launch selections and never predicts a random assignee', async () => {
    definition([node('start', 'start'), node('condition', 'exclusiveGateway'), node('chosen', 'approve', { assigneeId: null, assigneeType: 'initiatorSelect', selectScopeType: 'user', selectScopeIds: [1] }), node('ordinary', 'approve', { approveMethod: 'random' }), node('end', 'end')],
      [edge('start', 'condition'), edge('condition', 'chosen', { condition: { field: 'amount', operator: 'gte', value: 1000 } }), edge('condition', 'ordinary'), edge('chosen', 'end'), edge('ordinary', 'end')]);
    const preview = await call(workflowDefinitionContract.preview, { formData: { amount: 10 } }, { id: 930001 });
    expect(preview.body.data.find((item: { nodeKey: string }) => item.nodeKey === 'chosen')).toMatchObject({ status: 'excluded' });
    expect(preview.body.data.find((item: { nodeKey: string }) => item.nodeKey === 'chosen').selectionRequired).not.toBe(true);
    expect(preview.body.data.find((item: { nodeKey: string }) => item.nodeKey === 'ordinary').approvers).toEqual([]);
    const unknown = await call(workflowDefinitionContract.preview, { formData: {} }, { id: 930001 });
    expect(unknown.body.data.find((item: { nodeKey: string }) => item.nodeKey === 'chosen')).toMatchObject({ status: 'unknown', selectionRequired: true });
    const missing = await call(workflowInstanceContract.create, { definitionId: 930001, title: '缺少预选', formData: { amount: 5000 } });
    expect(missing.status).toBe(400);
    expect((await start({ amount: 10 })).status).toBe('running');
  });

  it('suspends unsupported automatic effects with a reason instead of reporting approval', async () => {
    definition([node('start', 'start'), node('trigger', 'trigger'), node('end', 'end')], [edge('start', 'trigger'), edge('trigger', 'end')]);
    const instance = await start(); expect(instance.status).toBe('suspended'); expect(instance.suspendReason).toContain('Demo 暂不执行');
  });

  it('suspends a cycle explicitly instead of silently treating one traversal as completion', async () => {
    definition([node('start', 'start'), node('review'), node('condition', 'exclusiveGateway'), node('end', 'end')],
      [edge('start', 'review'), edge('review', 'condition'), edge('condition', 'review', { condition: { field: 'amount', operator: 'gt', value: 0 } }), edge('condition', 'end')]);
    const instance = await start({ amount: 20 }); expect(instance.status).toBe('suspended'); expect(instance.suspendReason).toContain('循环流程');
  });

  it('starts a new approval round after returning and resubmitting rather than reusing the old vote', async () => {
    definition([node('start', 'start'), node('manager'), node('finance'), node('end', 'end')], [edge('start', 'manager'), edge('manager', 'finance'), edge('finance', 'end')]);
    const instance = await start(); await approve(instance.id, 'manager');
    const old = mockWorkflowTasks.find(task => task.instanceId === instance.id && task.nodeKey === 'manager')!;
    const finance = mockWorkflowTasks.find(task => task.instanceId === instance.id && task.nodeKey === 'finance')!;
    expect((await call(workflowTaskContract.returnTask, { targetNodeKeys: [WORKFLOW_RETURN_TO_INITIATOR_KEY], comment: '补充材料' }, { taskId: finance.id })).status).toBe(200);
    expect(instance.status).toBe('returned');
    expect((await call(workflowInstanceContract.submitDraft, {}, { id: instance.id })).status).toBe(200);
    expect(openKeys(instance.id)).toEqual(['manager']);
    expect(mockWorkflowTasks.find(task => task.instanceId === instance.id && task.status === 'pending')!.activationId).not.toBe(old.activationId);
  });

  it('keeps an earlier gateway decision frozen when a later approval edits its source field', async () => {
    definition([node('start', 'start'), node('condition', 'exclusiveGateway'), node('large', 'approve', { fieldPermissions: { amount: 'edit' } }), node('small'), node('end', 'end')],
      [edge('start', 'condition'), edge('condition', 'large', { condition: { field: 'amount', operator: 'gte', value: 1000 } }), edge('condition', 'small'), edge('large', 'end'), edge('small', 'end')]);
    const instance = await start({ amount: 2000 }); const task = mockWorkflowTasks.find(item => item.instanceId === instance.id)!;
    expect((await call(workflowTaskContract.approve, { formUpdates: { amount: 20 } }, { taskId: task.id })).status).toBe(200);
    expect(instance.formData?.amount).toBe(20); expect(instance.status).toBe('approved');
    expect(mockWorkflowTasks.filter(item => item.instanceId === instance.id).map(item => item.nodeKey)).toEqual(['large']);
  });

  it('simulation excludes the unselected monetary branch instead of approving every configured node', async () => {
    definition([node('start', 'start'), node('expensive'), node('condition', 'exclusiveGateway'), node('ordinary'), node('end', 'end')],
      [edge('start', 'condition'), edge('condition', 'expensive', { condition: { field: 'amount', operator: 'gte', value: 1000 } }), edge('condition', 'ordinary'), edge('expensive', 'end'), edge('ordinary', 'end')]);
    const result = await call(workflowDefinitionContract.simulate, { definitionId: 930001, formData: { amount: 20 } });
    expect(result.status).toBe(200); expect(result.body.data.pathSignature).toEqual(['start', 'condition', 'ordinary']);
    expect(result.body.data.edgeResults.find((item: { edgeId: string }) => item.edgeId === 'condition-expensive').taken).toBe(false);
  });
});
