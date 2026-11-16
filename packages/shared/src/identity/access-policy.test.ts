import { describe, expect, it } from 'vitest';
import { planWorkflowPath } from '../workflow/path-planner';
import { accessWorkflowInputSchema } from './access-governance-validation';
import { accessPolicyBaseline, aggregateAccessPolicies, buildAccessApprovalFlow, buildAccessApprovalTemplate, effectiveAccessPolicy, mergeAccessPermissionItems } from './access-policy';

const form = { permissionCodes: ['system:user:list'], reason: '权限治理有效期测试', requestType: 'temporary', startMode: 'immediate' };

describe('explicit limited and permanent access validity', () => {
  it('accepts permanent grants without an artificial maximum duration', () => {
    expect(accessWorkflowInputSchema.parse({ ...form, validityMode: 'permanent', expiresAt: null }).expiresAt).toBeNull();
    expect(accessWorkflowInputSchema.safeParse({ ...form, validityMode: 'limited', expiresAt: '2030-10-19 12:00:00' }).success).toBe(true);
  });
  it('does not confuse an omitted limited expiry with permanent intent', () => {
    expect(accessWorkflowInputSchema.safeParse({ ...form, validityMode: 'limited', expiresAt: null }).success).toBe(false);
    expect(accessWorkflowInputSchema.safeParse({ ...form, expiresAt: null }).success).toBe(false);
    expect(accessWorkflowInputSchema.safeParse({ ...form, validityMode: 'permanent', expiresAt: '2030-10-19 12:00:00' }).success).toBe(false);
  });
  it('keeps independent approval and MFA floors without forcing risk-based expiration', () => {
    const baseline = accessPolicyBaseline('example:write', { label: '写入', menu: 'Example', riskLevel: 'critical' });
    const policy = effectiveAccessPolicy(baseline, { id: 1, version: 2, riskLevel: 'low', approvalPolicy: 'none', maxDurationMinutes: null, reviewIntervalDays: 365, mfaRequired: false, enabled: true });
    expect(policy).toMatchObject({ riskLevel: 'critical', approvalPolicy: 'two_person', mfaRequired: true, reviewIntervalDays: 30, maxDurationMinutes: null });
  });
  it('only aggregates explicitly configured limits for limited validity', () => {
    const base = accessPolicyBaseline('example:list', { label: '查询', menu: 'Example' });
    expect(aggregateAccessPolicies([base]).maxDurationMinutes).toBeNull();
    expect(aggregateAccessPolicies([base, { ...base, maxDurationMinutes: 1440 }]).maxDurationMinutes).toBe(1440);
  });
});

describe('access policy template and resolved execution plan', () => {
  it.each([
    ['none', []], ['manager', ['approve_manager']], ['manager_security', ['approve_security_manager', 'approve_security']],
    ['two_person', ['approve_second_manager', 'approve_first_security', 'approve_second_security']],
  ] as const)('routes the template from effective policy %s rather than request labels', (approvalPolicy, expected) => {
    const flow = buildAccessApprovalFlow({ approvalPolicy, mfaRequired: approvalPolicy === 'two_person', steps: expected.map((nodeKey, index) => ({ nodeKey, label: nodeKey, userId: index + 2, userName: `审批人${index + 2}`, reason: '策略解析' })) });
    expect(flow.nodes.map(node => node.data.key)).toEqual(buildAccessApprovalTemplate().nodes.map(node => node.data.key));
    const plan = planWorkflowPath(flow, { formData: { approvalPolicy, requestType: 'emergency', validityMode: 'permanent' } });
    expect(plan.nodes.filter(node => node.nodeType === 'approve' && node.status === 'matched').map(node => node.nodeKey)).toEqual(approvalPolicy === 'none' ? ['policy_auto_approve'] : expected);
  });
  it('freezes resolved people and disables resubmission without losing independence', () => {
    const flow = buildAccessApprovalFlow({ approvalPolicy: 'manager_security', mfaRequired: false, steps: [
      { nodeKey: 'approve_security_manager', label: '负责人', userId: 7, userName: '主管', reason: '部门负责人' },
      { nodeKey: 'approve_security', label: '安全审批', userId: 8, userName: '安全员', reason: '独立安全审批' },
    ] });
    expect(flow.nodes.filter(node => ['approve_security_manager', 'approve_security'].includes(node.data.key)).map(node => node.data.assigneeIds)).toEqual([[7], [8]]);
    expect(flow.nodes.some(node => node.data.key === 'approve_second_security')).toBe(true);
    expect(flow.nodes.some(node => node.data.type === 'exclusiveGateway')).toBe(true);
    const prediction = planWorkflowPath(flow, { formData: { approvalPolicy: 'manager_security' } });
    expect(prediction.nodes.filter(node => node.nodeType === 'approve' && node.status === 'matched').map(node => node.nodeKey)).toEqual(['approve_security_manager', 'approve_security']);
    expect(prediction.nodes.find(node => node.nodeKey === 'approve_second_security')?.status).toBe('excluded');
    expect(flow.settings).toMatchObject({ allowResubmit: false, approverDedupMode: 'none' });
  });
  it('uses one exhaustive strategy gateway with a rejecting default and no shared approval nodes', () => {
    const flow = buildAccessApprovalTemplate();
    expect(flow.nodes.filter(node => node.data.type === 'exclusiveGateway')).toHaveLength(1);
    expect(flow.edges.filter(edge => edge.source === 'access-policy').map(edge => edge.condition?.value).filter(Boolean)).toEqual(['none', 'manager', 'manager_security', 'two_person']);
    for (const approvalPolicy of ['invalid']) {
      const prediction = planWorkflowPath(flow, { formData: { approvalPolicy } });
      expect(prediction.nodes.filter(node => node.nodeType === 'approve' && node.status === 'matched').map(node => node.nodeKey)).toEqual(['policy_invalid']);
    }
    const unresolved = planWorkflowPath(flow, { formData: {} });
    expect(unresolved.nodes.filter(node => node.nodeType === 'approve' && node.status === 'matched')).toEqual([]);
    for (const node of flow.nodes.filter(node => node.data.approvalType === 'manual')) {
      expect(node.data).toMatchObject({ emptyStrategy: 'reject', deduplicateStrategy: 'repeatApprove', rejectStrategy: 'terminate', operations: ['opinionRequired'] });
      expect(node.data.actionButtons).toMatchObject({ approve: { enabled: true }, reject: { enabled: true }, transfer: { enabled: false }, delegate: { enabled: false }, addSign: { enabled: false }, return: { enabled: false } });
    }
  });
  it('rejects a forged or incomplete resolved approval plan before it can enter execution', () => {
    expect(() => buildAccessApprovalFlow({ approvalPolicy: 'manager', mfaRequired: false, steps: [] })).toThrow('审批计划');
    expect(() => buildAccessApprovalFlow({ approvalPolicy: 'manager_security', mfaRequired: false, steps: [
      { nodeKey: 'approve_security_manager', label: '负责人', userId: 7, userName: '主管', reason: '负责人' },
      { nodeKey: 'approve_security', label: '安全审批', userId: 7, userName: '主管', reason: '安全审批' },
    ] })).toThrow('审批计划');
  });
  it('preserves per-permission data scopes when expanding role packages', () => {
    const items = mergeAccessPermissionItems([
      { permissionCode: 'example:list', dataScope: 'all', deptScopeIds: [] },
      { permissionCode: 'example:edit', dataScope: 'self', deptScopeIds: [] },
      { permissionCode: 'example:edit', dataScope: 'custom', deptScopeIds: [3] },
      { permissionCode: 'example:edit', dataScope: 'custom', deptScopeIds: [4] },
    ]);
    expect(items).toHaveLength(4);
    expect(items.filter(item => item.dataScope === 'custom').map(item => item.deptScopeIds)).toEqual([[3], [4]]);
    expect(items.find(item => item.permissionCode === 'example:edit' && item.dataScope === 'self')).toBeDefined();
  });
  it('deduplicates identical scopes while preserving independent role versions and direct selection', () => {
    const [item] = mergeAccessPermissionItems([
      { permissionCode: 'example:list', dataScope: 'self', sourceRefs: [{ kind: 'direct', label: '直接申请' }] },
      { permissionCode: 'example:list', dataScope: 'self', sourceRefs: [{ kind: 'role', roleId: 3, roleVersion: 2, label: '查询包' }] },
    ]);
    expect(item.scopeKey).toBe('self:');
    expect(item.sourceRefs).toHaveLength(2);
  });
});
