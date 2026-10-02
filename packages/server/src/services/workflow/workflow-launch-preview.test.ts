import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowFlowData, WorkflowFormField, WorkflowNodeConfig } from '@zenith/shared/workflow';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(), selectable: vi.fn(), selected: vi.fn(), starter: vi.fn(), names: vi.fn(),
}));
vi.mock('../../db', () => ({ db: {} }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 7, username: '张三', roles: [], tenantId: null }) }));
vi.mock('../../lib/workflow-token-engine', () => ({ advanceTokens: vi.fn() }));
vi.mock('../../lib/tenant', () => ({ tenantCondition: vi.fn() }));
vi.mock('../../lib/user-nicknames', () => ({ resolveUserNames: mocks.names }));
vi.mock('./workflow-forms.service', () => ({ resolveFormSnapshot: vi.fn() }));
vi.mock('./workflow-launch-access', () => ({ assertWorkflowInitiatorScope: vi.fn() }));
vi.mock('./workflow-assignee-resolver.service', () => ({
  resolveAssigneeIds: mocks.resolve, listSelectableApprovers: mocks.selectable,
  filterSelectedApproverIds: mocks.selected, buildStarterContext: mocks.starter,
}));

import { previewFlowData } from './workflow-preview.service';
import { applyInitiatorSelectedApprovers, sanitizeFormByStartPerms } from './instances/initiator-select';

const node = (key: string, type: WorkflowNodeConfig['type'], extra: Partial<WorkflowNodeConfig> = {}): WorkflowFlowData['nodes'][number] => ({
  id: key, position: { x: 0, y: 0 }, data: { key, label: key, type, ...extra },
});
const fields: WorkflowFormField[] = [
  { key: 'items', type: 'detail', label: '明细', required: true, children: [{ key: 'amount', type: 'amount', label: '金额', required: true }] },
  { key: 'total', type: 'formula', label: '合计', formula: 'SUM({items.amount})' },
];
const branched = (extra: Partial<WorkflowNodeConfig> = {}): WorkflowFlowData => ({
  nodes: [node('start', 'start'), node('gateway', 'exclusiveGateway'), node('large', 'approve', { assigneeType: 'initiatorSelect', ...extra }), node('small', 'approve', { assigneeType: 'initiatorSelect', ...extra }), node('end', 'end')],
  edges: [
    { id: 'entry', source: 'start', target: 'gateway' },
    { id: 'large-route', source: 'gateway', target: 'large', condition: { field: 'total', operator: 'gt', value: 10000 } },
    { id: 'small-route', source: 'gateway', target: 'small', isDefault: true },
    { id: 'large-end', source: 'large', target: 'end' },
    { id: 'small-end', source: 'small', target: 'end' },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.starter.mockResolvedValue({ userId: 7, deptIds: [20], roleIds: [], postIds: [] });
  mocks.resolve.mockResolvedValue([8]);
  mocks.selectable.mockResolvedValue([{ id: 8, name: '李四' }]);
  mocks.selected.mockImplementation(async (_config: WorkflowNodeConfig, ids: number[]) => ids.filter(id => id === 8));
  mocks.names.mockImplementation(async (ids: Iterable<number>) => new Map([...ids].map(id => [id, id === 7 ? '张三' : '李四'])));
});

describe('launch preview and selection share the path planner', () => {
  it('recomputes submitted formulas and requires only the matched branch', async () => {
    const values = { items: [{ amount: 7000 }, { amount: 6000 }], total: 1 };
    const flow = branched();
    const preview = await previewFlowData(flow, values, fields);
    expect(preview.find(item => item.nodeKey === 'large')).toMatchObject({ status: 'matched', selectionRequired: true });
    expect(preview.find(item => item.nodeKey === 'small')).toMatchObject({ status: 'excluded', selectionRequired: false, approvers: [] });
    expect(mocks.selectable).toHaveBeenCalledTimes(1);
    const applied = await applyInitiatorSelectedApprovers(flow, { large: [8] }, { formData: values, formFields: fields });
    expect(applied.nodes.find(item => item.data.key === 'large')?.data.userIds).toEqual([8]);
    expect(mocks.selected).toHaveBeenCalledTimes(1);
    expect(values.total).toBe(1);
    expect(flow.nodes.find(item => item.data.key === 'large')?.data.userIds).toBeUndefined();
  });

  it('requires a valid preselection for every still-unknown branch', async () => {
    const flow = branched();
    const preview = await previewFlowData(flow, {}, fields);
    expect(preview.filter(item => item.nodeType === 'approve')).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: 'large', status: 'unknown', selectionRequired: true, approverReason: expect.stringContaining('预选') }),
      expect.objectContaining({ nodeKey: 'small', status: 'unknown', selectionRequired: true }),
    ]));
    await expect(applyInitiatorSelectedApprovers(flow, { large: [8] }, { formFields: fields })).rejects.toThrow('small');
    await expect(applyInitiatorSelectedApprovers(flow, { large: [8], small: [99] }, { formFields: fields })).rejects.toThrow('small');
    await expect(applyInitiatorSelectedApprovers(flow, { large: [8], small: [8] }, { formFields: fields })).resolves.toBeDefined();
  });

  it('ignores forged hidden inputs and leaves their branches uncertain', async () => {
    const flow = branched();
    flow.nodes[0].data.fieldPermissions = { total: 'hidden' };
    const values = { total: 1 };
    const preview = await previewFlowData(flow, values);
    expect(preview.filter(item => item.nodeType === 'approve').every(item => item.status === 'unknown')).toBe(true);
    await expect(applyInitiatorSelectedApprovers(flow, { small: [8] }, { formData: sanitizeFormByStartPerms(flow, values) })).rejects.toThrow('large');
  });

  it('preselects both possible branches when an earlier handler can change a formula source', async () => {
    const flow = branched();
    flow.nodes.push(node('review', 'handler', { assigneeType: 'user', userIds: [8], fieldPermissions: { items: 'edit' } }));
    flow.edges[0].target = 'review';
    flow.edges.push({ id: 'review-gateway', source: 'review', target: 'gateway' });
    const values = { items: [{ amount: 2000 }] };
    const preview = await previewFlowData(flow, values, fields);
    expect(preview.filter(item => item.nodeType === 'approve').every(item => item.status === 'unknown' && item.selectionRequired)).toBe(true);
    await expect(applyInitiatorSelectedApprovers(flow, { small: [8] }, { formData: values, formFields: fields })).rejects.toThrow('large');
  });

  it('uses the real starter context for preview and submission decisions', async () => {
    const flow = branched();
    flow.edges[1].condition = { field: 'user', source: 'starter', operator: 'in', value: 7 };
    const preview = await previewFlowData(flow);
    expect(preview.find(item => item.nodeKey === 'large')?.status).toBe('matched');
    await expect(applyInitiatorSelectedApprovers(flow, { large: [8] }, {
      starter: { userId: 7, deptIds: [20], roleIds: [], postIds: [] },
    })).resolves.toBeDefined();
  });

  it('returns real names while leaving decision, random and runtime form assignees unevaluated', async () => {
    const configs: Partial<WorkflowNodeConfig>[] = [
      { assigneeType: 'user', userIds: [8] }, { assigneeType: 'decision' },
      { assigneeType: 'user', approveMethod: 'random' }, { assigneeType: 'formUser' },
    ];
    const flow: WorkflowFlowData = {
      nodes: [node('start', 'start'), ...configs.map((config, i) => node(String(i), 'approve', config)), node('end', 'end')],
      edges: ['start', '0', '1', '2', '3'].map((source, i) => ({ id: source, source, target: i === 4 ? 'end' : String(i) })),
    };
    const preview = await previewFlowData(flow);
    expect(preview[0].approvers).toEqual([{ id: 7, name: '张三' }]);
    expect(preview.find(item => item.nodeKey === '0')?.approvers).toEqual([{ id: 8, name: '李四' }]);
    expect(preview.filter(item => ['1', '2', '3'].includes(item.nodeKey)).every(item => !item.approvers.length && item.approverReason)).toBe(true);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });
});
