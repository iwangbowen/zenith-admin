import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnyOperation } from '@zenith/shared/core';
import { workflowInstanceContract, workflowInstanceOpsContract, workflowTaskContract, type WorkflowTask } from '@zenith/shared/workflow';
import { mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks } from './data/workflow';
import { workflowExtraHandlers } from './handlers/workflow-extra';
import { mockAccessToken } from './utils/auth';
import { addMockSignGroup, createMockActivation, getMockApprovalActivations, resetMockApprovalState } from './utils/workflow-approval';

const stores = [mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks];
const snapshots = stores.map(store => structuredClone(store));
afterEach(() => {
  stores.forEach((store, index) => { (store as unknown[]).splice(0, store.length, ...structuredClone(snapshots[index])); });
  resetMockApprovalState();
});
let base: WorkflowTask, extra: WorkflowTask;
beforeEach(() => {
  resetMockApprovalState();
  const definition = mockWorkflowDefinitions[0], instance = mockWorkflowInstances[0];
  instance.status = 'running'; instance.definitionId = definition.id;
  const config = { key: 'review', label: '正式审批', type: 'approve' as const, approveMethod: 'or' as const, assigneeId: 1 };
  definition.flowData = { nodes: [{ id: config.key, type: 'approve', position: { x: 0, y: 0 }, data: config }], edges: [] };
  instance.definitionSnapshot = structuredClone({ ...definition, formFields: definition.formFields ?? null });
  base = { ...mockWorkflowTasks[0], id: 910001, instanceId: instance.id, nodeKey: config.key, nodeName: config.label, nodeType: 'approve',
    taskKind: 'approval', activationId: null, slotId: null, signPosition: null, waitReason: null, assigneeId: 1, status: 'pending',
    actionAt: null, signaturePolicy: 'none', decision: null };
  extra = { ...base, id: 910002, assigneeId: 2 };
  mockWorkflowTasks.splice(0, mockWorkflowTasks.length, base, extra);
  createMockActivation(instance, config, [base]);
  addMockSignGroup(base, [extra], { position: 'after' });
});
async function call(operation: AnyOperation, params: Record<string, number> = {}, body?: unknown) {
  let path = operation.fullPath;
  for (const [key, value] of Object.entries(params)) path = path.replace(`{${key}}`, String(value));
  for (const handler of workflowExtraHandlers) {
    const request = new Request(new URL(path, window.location.origin), { method: operation.method.toUpperCase(),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${mockAccessToken('admin')}` },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await (handler as unknown as { run(args: unknown): Promise<{ response?: Response } | null> }).run({ request, requestId: `approval-extra-${Math.random()}` });
    if (result?.response) return { status: result.response.status, body: await result.response.json() };
  }
  throw new Error(`No handler matched ${path}`);
}

describe('Demo extra workflow routes preserve formal approval barriers', () => {
  it('rejects early bulk handling and keeps the instance running after only the base seat approves', async () => {
    const blocked = await call(workflowTaskContract.batchApprove, {}, { taskIds: [extra.id] });
    expect(blocked.body.data).toMatchObject({ succeeded: 0, failed: 1 });
    expect(extra.status).toBe('waiting');
    const approved = await call(workflowTaskContract.batchApprove, {}, { taskIds: [base.id] });
    expect(approved.body.data).toMatchObject({ succeeded: 1, failed: 0 });
    expect(extra.status).toBe('pending');
    expect(mockWorkflowInstances[0].status).toBe('running');
    expect(getMockApprovalActivations(base.instanceId)[0]).toMatchObject({ baseApproved: 1, status: 'active' });
  });
  it('reassigns a waiting supplemental task without activating it or changing its formal seat', async () => {
    const slot = extra.slotId;
    expect((await call(workflowTaskContract.reassign, { taskId: extra.id }, { targetUserId: 3 })).status).toBe(200);
    expect(extra).toMatchObject({ slotId: slot, assigneeId: 3, status: 'waiting', waitReason: 'afterSign' });
    expect(getMockApprovalActivations(base.instanceId)[0].baseTotal).toBe(1);
  });
  it('forced jump cancels the old mandatory group and creates a distinct approval round', async () => {
    const previous = base.activationId;
    expect((await call(workflowInstanceOpsContract.jump, { id: base.instanceId }, { targetNodeKey: 'review', comment: '管理员回归测试' })).status).toBe(200);
    expect(extra.status).toBe('skipped');
    const activations = getMockApprovalActivations(base.instanceId);
    expect(activations.find(row => row.id === previous)?.status).toBe('cancelled');
    expect(activations.filter(row => row.status === 'active')).toHaveLength(1);
    expect(activations.find(row => row.status === 'active')?.id).not.toBe(previous);
  });
  it('batch withdrawal cancels every unfinished supplemental seat', async () => {
    expect((await call(workflowInstanceContract.batchWithdraw, {}, { instanceIds: [base.instanceId] })).body.data.succeeded).toBe(1);
    expect(base.status).toBe('skipped'); expect(extra.status).toBe('skipped');
    expect(getMockApprovalActivations(base.instanceId)[0].status).toBe('cancelled');
  });
});
