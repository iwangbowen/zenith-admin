import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowTask, WorkflowNodeConfig } from '@zenith/shared/workflow';
import { addMockSignGroup, cancelMockApprovalActivations, createMockActivation, delegateMockApprovalSeat, getMockApprovalActivations, reconcileMockActivation, reduceMockSignGroup, resetMockApprovalState, settleMockApprovalSeat, transferMockApprovalSeat } from './workflow-approval';

const T0 = '2026-10-02 10:00:00', T1 = '2026-10-02 10:01:00', T2 = '2026-10-02 10:02:00';
let taskId = 1;
const task = (userId: number, nodeType = 'approve'): WorkflowTask => ({ id: taskId++, instanceId: 1, nodeKey: 'review', nodeName: '评审', nodeType,
  activationId: null, slotId: null, taskKind: 'approval', waitReason: null, activatedAt: null, signPosition: null,
  assigneeId: userId, assigneeName: `用户${userId}`, status: 'pending', comment: null, actionAt: null, createdAt: T0 });
const node = (approveMethod: WorkflowNodeConfig['approveMethod'] = 'or'): WorkflowNodeConfig => ({ key: 'review', label: '评审', type: 'approve', approveMethod, approveRatio: 66 });
const view = () => getMockApprovalActivations(1)[0];

beforeEach(() => { resetMockApprovalState(); taskId = 1; });

describe('mock workflow formal seats and supplemental groups', () => {
  it('keeps before-sign anchor waiting and resumes it only after supplemental approval', () => {
    const base = task(1), extra = task(2); createMockActivation({ id: 1 }, node(), [base], { now: T0 });
    const added = addMockSignGroup(base, [extra], { position: 'before', now: T1 });
    expect(base.status).toBe('waiting'); expect(base.waitReason).toBe('beforeSign'); expect(base.activatedAt).toBe(T0);
    expect(extra.status).toBe('pending'); expect(extra.activatedAt).toBe(T1); expect(extra.signPosition).toBe('before');
    expect(() => settleMockApprovalSeat(base, 'approved')).toThrow('尚未激活');
    expect(settleMockApprovalSeat(extra, 'approved', { now: T2 }).completed).toBe(false);
    expect(base.status).toBe('pending'); expect(base.activatedAt).toBe(T2);
    expect(view().baseApproved).toBe(0); expect(view().signGroups[0].id).toBe(added.group.id);
    expect(settleMockApprovalSeat(base, 'approved').completed).toBe(true);
  });

  it('does not expose after-sign work or invent its activation time before the anchor approves', () => {
    const base = task(1), extra = task(2); const activation = createMockActivation({ id: 1 }, node(), [base], { now: T0 });
    addMockSignGroup(base, [extra], { position: 'after', now: T1 });
    expect(extra.status).toBe('waiting'); expect(extra.waitReason).toBe('afterSign'); expect(extra.activatedAt).toBeNull();
    reconcileMockActivation(1, activation.id, T2); expect(extra.activatedAt).toBeNull();
    expect(() => settleMockApprovalSeat(extra, 'approved')).toThrow('尚未激活');
    expect(settleMockApprovalSeat(base, 'approved', { now: T2 }).completed).toBe(false);
    expect(extra.status).toBe('pending'); expect(extra.activatedAt).toBe(T2);
    expect(settleMockApprovalSeat(extra, 'approved').completed).toBe(true);
  });

  it('does not rewrite OR base policy when a parallel AND group is added', () => {
    const bases = [task(1), task(2)], extras = [task(3), task(4)]; createMockActivation({ id: 1 }, node('or'), bases, { now: T0 });
    addMockSignGroup(bases[0], extras, { position: 'parallel', signMode: 'and', now: T1 });
    expect(settleMockApprovalSeat(bases[0], 'approved').completed).toBe(false);
    expect(bases[1].status).toBe('skipped'); expect(view().baseTotal).toBe(2); expect(view().baseRequired).toBe(1);
    expect(settleMockApprovalSeat(extras[0], 'approved').completed).toBe(false);
    expect(settleMockApprovalSeat(extras[1], 'approved').completed).toBe(true);
    expect(view().baseApproved).toBe(1);
  });

  it('cancels OR supplemental siblings without counting their task rows as base opinions', () => {
    const base = task(1), extras = [task(2), task(3)]; createMockActivation({ id: 1 }, node(), [base]);
    addMockSignGroup(base, extras, { position: 'parallel', signMode: 'or' });
    settleMockApprovalSeat(extras[0], 'approved'); expect(extras[1].status).toBe('skipped'); expect(view().baseApproved).toBe(0);
    expect(settleMockApprovalSeat(base, 'approved').completed).toBe(true);
  });

  it('freezes ratio threshold and preserves a mandatory after-sign anchor despite other base votes', () => {
    const bases = [task(1), task(2), task(3)], extra = task(4); createMockActivation({ id: 1 }, node('ratio'), bases);
    addMockSignGroup(bases[2], [extra], { position: 'after' });
    settleMockApprovalSeat(bases[0], 'approved'); expect(settleMockApprovalSeat(bases[1], 'approved').completed).toBe(false);
    expect(view().baseRequired).toBe(2); expect(bases[2].status).toBe('pending'); expect(extra.status).toBe('waiting');
    settleMockApprovalSeat(bases[2], 'approved'); expect(extra.status).toBe('pending');
    expect(settleMockApprovalSeat(extra, 'approved').completed).toBe(true); expect(view().baseApproved).toBe(3);
  });

  it('keeps a sequential successor waiting until the earlier after-sign group completes', () => {
    const bases = [task(1), task(2)], extra = task(3); createMockActivation({ id: 1 }, node('sequential'), bases);
    expect(bases[1].waitReason).toBe('sequence'); addMockSignGroup(bases[0], [extra], { position: 'after' });
    settleMockApprovalSeat(bases[0], 'approved'); expect(bases[1].status).toBe('waiting');
    settleMockApprovalSeat(extra, 'approved'); expect(bases[1].status).toBe('pending');
    expect(settleMockApprovalSeat(bases[1], 'approved').completed).toBe(true);
  });

  it('reduces by group/slot identity while the anchor is waiting, including full reduction', () => {
    const base = task(1), extras = [task(2), task(3)]; createMockActivation({ id: 1 }, node(), [base]);
    const added = addMockSignGroup(base, extras, { position: 'before', actorId: 1 });
    const first = reduceMockSignGroup(added.group.id, [extras[0].slotId!], { actorId: 1 });
    expect(first.removed).toEqual([extras[0]]); expect(base.status).toBe('waiting');
    const last = reduceMockSignGroup(added.group.id, [extras[1].slotId!], { actorId: 1, now: T2 });
    expect(last.group.status).toBe('cancelled'); expect(last.group.canReduce).toBe(false); expect(base.status).toBe('pending');
    expect(view().baseTotal).toBe(1); expect(view().baseRequired).toBe(1);
    expect(settleMockApprovalSeat(base, 'approved').completed).toBe(true);
  });

  it('allows the owner to find and reduce an after-sign group after its anchor has handled', () => {
    const base = task(1), extra = task(2); createMockActivation({ id: 1 }, node(), [base]);
    const added = addMockSignGroup(base, [extra], { position: 'after', actorId: 1 }); settleMockApprovalSeat(base, 'approved');
    expect(getMockApprovalActivations(1, 1)[0].signGroups[0].canReduce).toBe(true);
    expect(getMockApprovalActivations(1, 99)[0].signGroups[0].canReduce).toBe(false);
    expect(() => reduceMockSignGroup(added.group.id, [extra.slotId!], { actorId: 99 })).toThrow('无权');
    expect(reduceMockSignGroup(added.group.id, [extra.slotId!], { actorId: 1 }).completed).toBe(true);
  });

  it('rejects nested groups, original-seat reduction and already handled supplemental seats', () => {
    const base = task(1), extra = task(2); createMockActivation({ id: 1 }, node(), [base]);
    const added = addMockSignGroup(base, [extra], { position: 'parallel' });
    expect(() => addMockSignGroup(extra, [task(3)], { position: 'parallel' })).toThrow('嵌套');
    expect(() => reduceMockSignGroup(added.group.id, [base.slotId!])).toThrow('本组未办');
    settleMockApprovalSeat(extra, 'approved'); expect(() => reduceMockSignGroup(added.group.id, [extra.slotId!])).toThrow('已结束');
  });

  it('delegates a suggestion and receipt on the same formal seat without increasing the vote count', () => {
    const base = task(1), suggestion = task(2), receipt = task(1); createMockActivation({ id: 1 }, node(), [base]);
    const slotId = base.slotId; delegateMockApprovalSeat(base, suggestion, 2, { now: T1 });
    expect(base.status).toBe('skipped'); expect(suggestion.taskKind).toBe('suggestion'); expect(suggestion.slotId).toBe(slotId);
    const result = settleMockApprovalSeat(suggestion, 'rejected', { receiptTask: receipt, now: T2 });
    expect(result.failed).toBe(false); expect(result.completed).toBe(false); expect(receipt.slotId).toBe(slotId);
    expect(receipt.taskKind).toBe('approval'); expect(receipt.assigneeId).toBe(1); expect(view().baseApproved).toBe(0); expect(view().baseRejected).toBe(0);
    expect(view().baseTotal).toBe(1); expect(settleMockApprovalSeat(receipt, 'approved').completed).toBe(true);
  });

  it('transfers current assignee metadata without creating an additional formal slot', () => {
    const base = task(1); createMockActivation({ id: 1 }, node(), [base]); const slotId = base.slotId;
    transferMockApprovalSeat(base, 2, { now: T2, targetName: '新处理人' });
    expect(base.slotId).toBe(slotId); expect(base.activatedAt).toBe(T2); expect(view().slots).toHaveLength(1);
    expect(view().slots[0].currentAssigneeId).toBe(2); expect(view().slots[0].originalAssigneeId).toBe(1);
    expect(settleMockApprovalSeat(base, 'approved').completed).toBe(true);
  });

  it('cleans waiting after-sign and suggestion work on withdrawal or return', () => {
    const base = task(1), after = task(2), suggestion = task(3); createMockActivation({ id: 1 }, node(), [base]);
    addMockSignGroup(base, [after], { position: 'after' }); delegateMockApprovalSeat(base, suggestion, 3);
    cancelMockApprovalActivations(1, T2, '[退回] 未办席位取消');
    expect(view().status).toBe('cancelled'); expect(view().slots.every(slot => slot.status === 'cancelled')).toBe(true);
    expect([base, after, suggestion].every(row => row.status !== 'pending' && row.status !== 'waiting')).toBe(true); expect(after.activatedAt).toBeNull();
  });

  it('cleans all open same-activation seats on a supplemental AND rejection', () => {
    const base = task(1), extras = [task(2), task(3)]; createMockActivation({ id: 1 }, node(), [base]);
    addMockSignGroup(base, extras, { position: 'parallel', signMode: 'and' });
    expect(settleMockApprovalSeat(extras[0], 'rejected', { now: T2 }).failed).toBe(true);
    expect(base.status).toBe('skipped'); expect(extras[1].status).toBe('skipped'); expect(view().status).toBe('rejected');
  });

  it('settles handler seats through the same evaluator and ignores mutable display activation IDs', () => {
    const base = task(1, 'handler'); createMockActivation({ id: 1 }, { ...node(), type: 'handler' }, [base]);
    base.activationId = null; expect(settleMockApprovalSeat(base, 'approved').completed).toBe(true);
    expect(view().baseApproved).toBe(1);
  });
});

// Contract binding coverage supplements the adapter cases with real MSW endpoint payloads.
import { afterEach } from 'vitest';
import type { AnyOperation } from '@zenith/shared/core';
import { workflowInstanceContract, workflowTaskContract } from '@zenith/shared/workflow';
import { mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks } from '@/mocks/data/workflow';
import { workflowHandlers } from '@/mocks/handlers/workflow';
import { mockAccessToken } from '@/mocks/utils/auth';
const stores = [mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks];
const originals = stores.map(store => structuredClone(store));
afterEach(() => { stores.forEach((store, index) => { (store as unknown[]).splice(0, store.length, ...structuredClone(originals[index])); }); });
async function endpoint(operation: AnyOperation, body?: unknown, params: Record<string, number> = {}) {
  let route = operation.fullPath;
  for (const [key, value] of Object.entries(params)) route = route.replace(`{${key}}`, String(value));
  for (const handler of workflowHandlers) {
    const request = new Request(new URL(route, window.location.origin), { method: operation.method.toUpperCase(), headers: { 'content-type': 'application/json', authorization: `Bearer ${mockAccessToken('admin')}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await (handler as unknown as { run(args: unknown): Promise<{ response?: Response } | null> }).run({ request, requestId: crypto.randomUUID() });
    if (result?.response) return { status: result.response.status, body: await result.response.json() };
  }
  throw new Error('Missing handler '+route);
}
async function instance(method: WorkflowNodeConfig['approveMethod'] = 'or', users = [1]) {
  const definition = { ...structuredClone(mockWorkflowDefinitions[0]), id: 70000, status: 'published' as const, formId: null, formFields: [],
    flowData: { nodes: [
      { id: 'start', position: { x: 0, y: 0 }, data: { key: 'start', label: '发起', type: 'start' as const } },
      { id: 'review', position: { x: 0, y: 100 }, data: { ...node(method), userIds: users } },
      { id: 'end', position: { x: 0, y: 200 }, data: { key: 'end', label: '结束', type: 'end' as const } },
    ], edges: [{ id: 'start-review', source: 'start', target: 'review' }, { id: 'review-end', source: 'review', target: 'end' }] } };
  mockWorkflowDefinitions.push(definition);
  const response = await endpoint(workflowInstanceContract.create, { definitionId: definition.id, title: 'Mock席位契约演练', formData: {} });
  expect(response.status).toBe(200);
  return response.body.data;
}

describe('mock workflow approval contract integration', () => {
  it('returns a group DTO, hides before anchor from pending count, and reduces by slot IDs', async () => {
    const created = await instance(), base = created.tasks[0];
    const signed = await endpoint(workflowTaskContract.addSign, { targetUserIds: [2], position: 'before' }, { taskId: base.id });
    expect(signed.body.data.group.position).toBe('before'); expect(signed.body.data.created[0].slotId).toBeTypeOf('number');
    expect(signed.body.data.instance.tasks.find((t: WorkflowTask) => t.id === base.id).waitReason).toBe('beforeSign');
    const mine = await endpoint(workflowTaskContract.mySignGroups); expect(mine.body.data.list.some((g: { id: number }) => g.id === signed.body.data.group.id)).toBe(true);
    const count = await endpoint(workflowInstanceContract.pendingMineCount); const pending = await endpoint(workflowInstanceContract.pendingMine);
    expect(count.body.data.count).toBe(pending.body.data.total);
    const reduced = await endpoint(workflowTaskContract.reduceSign, { targetSlotIds: [signed.body.data.created[0].slotId] }, { groupId: signed.body.data.group.id });
    expect(reduced.status).toBe(200); expect(reduced.body.data.group.status).toBe('cancelled');
    expect(reduced.body.data.instance.tasks.find((t: WorkflowTask) => t.id === base.id).status).toBe('pending');
    const done = await endpoint(workflowTaskContract.approve, { comment: '同意' }, { taskId: base.id }); expect(done.body.data.status).toBe('approved');
  });

  it('rejects early after-sign approval, and exposes the group after its anchor handles', async () => {
    const created = await instance(), base = created.tasks[0];
    const signed = await endpoint(workflowTaskContract.addSign, { targetUserIds: [2], position: 'after' }, { taskId: base.id });
    const child = signed.body.data.created[0]; expect(child.status).toBe('waiting'); expect(child.activatedAt).toBeNull();
    expect((await endpoint(workflowTaskContract.approve, { comment: '提前审批' }, { taskId: child.id })).status).toBe(400);
    const middle = await endpoint(workflowTaskContract.approve, { comment: '同意' }, { taskId: base.id }); expect(middle.body.data.status).toBe('running');
    expect((await endpoint(workflowTaskContract.mySignGroups)).body.data.list.some((g: { id: number }) => g.id === signed.body.data.group.id)).toBe(true);
    const reduced = await endpoint(workflowTaskContract.reduceSign, { targetSlotIds: [child.slotId] }, { groupId: signed.body.data.group.id });
    expect(reduced.body.data.instance.status).toBe('approved'); expect(reduced.body.data.removed[0].status).toBe('skipped');
  });

  it('keeps suggestion and receipt on the same slot without counting suggestion approval', async () => {
    const created = await instance(), base = created.tasks[0];
    const delegated = await endpoint(workflowTaskContract.delegate, { targetUserId: 2 }, { taskId: base.id });
    const suggestion = delegated.body.data; expect(suggestion.taskKind).toBe('suggestion'); expect(suggestion.slotId).toBe(base.slotId);
    const advised = await endpoint(workflowTaskContract.approve, { comment: '建议通过' }, { taskId: suggestion.id });
    expect(advised.body.data.status).toBe('running'); expect(advised.body.data.approvalActivations[0].baseApproved).toBe(0);
    const receipt = advised.body.data.tasks.find((t: WorkflowTask) => t.taskKind === 'approval' && t.status === 'pending');
    expect(receipt.slotId).toBe(base.slotId);
    const approved = await endpoint(workflowTaskContract.approve, { comment: '确认同意' }, { taskId: receipt.id });
    expect(approved.body.data.status).toBe('approved'); expect(approved.body.data.approvalActivations[0].baseApproved).toBe(1);
  });

  it('preserves OR base votes with a parallel AND supplemental group', async () => {
    const created = await instance('or', [1, 2]), base = created.tasks[0];
    const signed = await endpoint(workflowTaskContract.addSign, { targetUserIds: [3, 4], position: 'parallel', signMode: 'and' }, { taskId: base.id });
    const baseline = await endpoint(workflowTaskContract.approve, { comment: '同意' }, { taskId: base.id });
    expect(baseline.body.data.status).toBe('running'); expect(baseline.body.data.approvalActivations[0]).toMatchObject({ baseTotal: 2, baseRequired: 1, baseApproved: 1 });
    for (const child of signed.body.data.created) await endpoint(workflowTaskContract.approve, { comment: '补充同意' }, { taskId: child.id });
    const detail = await endpoint(workflowInstanceContract.detail, undefined, { id: created.id });
    expect(detail.body.data.status).toBe('approved'); expect(detail.body.data.tasks.filter((t: WorkflowTask) => t.status === 'pending' || t.status === 'waiting')).toHaveLength(0);
  });

  it('cleans both pending and waiting slots on withdrawal', async () => {
    const created = await instance(), base = created.tasks[0];
    await endpoint(workflowTaskContract.addSign, { targetUserIds: [2], position: 'after' }, { taskId: base.id });
    const withdrawn = await endpoint(workflowInstanceContract.withdraw, undefined, { id: created.id }); expect(withdrawn.body.data.status).toBe('withdrawn');
    const detail = await endpoint(workflowInstanceContract.detail, undefined, { id: created.id });
    expect(detail.body.data.tasks.filter((t: WorkflowTask) => t.status === 'pending' || t.status === 'waiting')).toHaveLength(0);
    expect(detail.body.data.approvalActivations[0].status).toBe('cancelled');
  });

  it('cleans supplemental work on return while preserving the return decision as history', async () => {
    const created = await instance(), base = created.tasks[0];
    await endpoint(workflowTaskContract.addSign, { targetUserIds: [2], position: 'parallel' }, { taskId: base.id });
    const returned = await endpoint(workflowTaskContract.returnTask, { targetNodeKeys: ['__initiator__'], comment: '补充材料' }, { taskId: base.id });
    expect(returned.body.data.status).toBe('returned'); expect(returned.body.data.approvalActivations[0].status).toBe('cancelled');
    expect(returned.body.data.tasks.filter((t: WorkflowTask) => t.status === 'pending' || t.status === 'waiting')).toHaveLength(0);
    expect(returned.body.data.tasks.find((t: WorkflowTask) => t.id === base.id).decision.action).toBe('returnInitiator');
  });
});
