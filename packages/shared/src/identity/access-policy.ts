import type { PermissionMeta } from '../core/permissions';
import type { WorkflowFlowData } from '../workflow/types';
import { ACCESS_APPROVAL_POLICIES, ACCESS_APPROVAL_STEPS, type AccessApprovalPolicy, type AccessRiskLevel } from './access-governance-constants';
import type { AccessApprovalPlan, AccessPolicySnapshot } from './access-governance-validation';
import type { AccessSourceRef } from './access-governance-validation';
import type { DataScope } from './constants';

export const ACCESS_RISK_ORDER: Record<AccessRiskLevel, number> = { low: 0, high: 1, critical: 2 };
export const ACCESS_APPROVAL_ORDER: Record<AccessApprovalPolicy, number> = { none: 0, manager: 1, manager_security: 2, two_person: 3 };
export const ACCESS_MINIMUM_APPROVAL: Record<AccessRiskLevel, AccessApprovalPolicy> = { low: 'none', high: 'manager_security', critical: 'two_person' };

export function higherAccessRisk(a: AccessRiskLevel, b: AccessRiskLevel): AccessRiskLevel {
  return ACCESS_RISK_ORDER[a] >= ACCESS_RISK_ORDER[b] ? a : b;
}

export function stricterAccessApproval(a: AccessApprovalPolicy, b: AccessApprovalPolicy): AccessApprovalPolicy {
  return ACCESS_APPROVAL_ORDER[a] >= ACCESS_APPROVAL_ORDER[b] ? a : b;
}

export function accessPolicyBaseline(permissionCode: string, meta: PermissionMeta): AccessPolicySnapshot {
  const riskLevel = meta.riskLevel ?? 'low';
  return {
    permissionCode, policyId: null, version: 0, riskLevel,
    permanentAllowed: meta.permanentAllowed === true, emergencyAllowed: meta.emergencyAllowed === true, maxEmergencyMinutes: meta.maxEmergencyMinutes ?? 60,
    approvalPolicy: meta.approvalPolicy ?? (riskLevel === 'low' ? 'manager' : ACCESS_MINIMUM_APPROVAL[riskLevel]),
    maxDurationMinutes: meta.maxDurationMinutes ?? null,
    reviewIntervalDays: meta.reviewIntervalDays ?? (riskLevel === 'critical' ? 30 : riskLevel === 'high' ? 90 : 0),
    mfaRequired: riskLevel === 'critical',
    enabled: meta.selfRequestable !== false && meta.uiOnly !== true,
  };
}

export function effectiveAccessPolicy(baseline: AccessPolicySnapshot, configured?: {
  id: number; version: number; riskLevel: AccessRiskLevel; approvalPolicy: AccessApprovalPolicy; maxDurationMinutes?: number | null;
  reviewIntervalDays: number; mfaRequired: boolean; enabled: boolean; permanentAllowed: boolean; emergencyAllowed: boolean; maxEmergencyMinutes: number;
}): AccessPolicySnapshot {
  if (!configured) return baseline;
  const riskLevel = higherAccessRisk(baseline.riskLevel, configured.riskLevel);
  return {
    ...baseline, policyId: configured.id, version: configured.version, riskLevel,
    approvalPolicy: stricterAccessApproval(configured.approvalPolicy, ACCESS_MINIMUM_APPROVAL[riskLevel]),
    maxDurationMinutes: configured.maxDurationMinutes ?? null,
    reviewIntervalDays: riskLevel === 'low' ? configured.reviewIntervalDays : Math.min(configured.reviewIntervalDays || (riskLevel === 'critical' ? 30 : 90), riskLevel === 'critical' ? 30 : 90),
    mfaRequired: riskLevel === 'critical' || configured.mfaRequired,
    enabled: baseline.enabled && configured.enabled,
    permanentAllowed: configured.permanentAllowed, emergencyAllowed: configured.emergencyAllowed, maxEmergencyMinutes: configured.maxEmergencyMinutes,
  };
}

export function aggregateAccessPolicies(policies: readonly AccessPolicySnapshot[]) {
  const limits = policies.flatMap(policy => policy.maxDurationMinutes == null ? [] : [policy.maxDurationMinutes]);
  return {
    riskLevel: policies.reduce<AccessRiskLevel>((risk, policy) => higherAccessRisk(risk, policy.riskLevel), 'low'),
    approvalPolicy: policies.reduce<AccessApprovalPolicy>((mode, policy) => stricterAccessApproval(mode, policy.approvalPolicy), 'none'),
    maxDurationMinutes: limits.length ? Math.min(...limits) : null,
    mfaRequired: policies.some(policy => policy.mfaRequired),
    permanentAllowed: policies.every(policy => policy.permanentAllowed),
    emergencyAllowed: policies.every(policy => policy.emergencyAllowed),
    maxEmergencyMinutes: Math.min(...policies.map(policy => policy.maxEmergencyMinutes), 1440),
  };
}

export function accessScopesOverlap(a: { dataScope?: DataScope | null; deptScopeIds: number[] }, b: { dataScope?: DataScope | null; deptScopeIds: number[] }): boolean {
  if (a.dataScope === 'custom' && b.dataScope === 'custom') return a.deptScopeIds.some(id => b.deptScopeIds.includes(id));
  return true;
}

export function accessScopeKey(dataScope: DataScope, deptScopeIds: readonly number[]): string {
  const ids = dataScope === 'custom' ? [...new Set(deptScopeIds)].sort((a, b) => a - b) : [];
  if (ids.length > 100) throw new Error('单项自定义范围最多包含 100 个部门');
  return `${dataScope}:${ids.join(',')}`;
}

export function mergeAccessPermissionItems(items: ReadonlyArray<{
  permissionCode: string | null; permissionLabel?: string | null; dataScope?: DataScope | null; deptScopeIds: number[]; sourceRefs?: AccessSourceRef[];
  menuId?: number | null; pageTitle?: string | null; pagePath?: string | null;
}>) {
  const merged = new Map<string, { permissionCode: string; permissionLabel: string | null; menuId: number | null; pageTitle: string | null; pagePath: string | null; dataScope: DataScope; deptScopeIds: number[]; scopeKey: string; sourceRefs: AccessSourceRef[] }>();
  for (const item of items) {
    if (!item.permissionCode) continue;
    const dataScope = item.dataScope ?? 'self';
    const deptScopeIds = dataScope === 'custom' ? [...new Set(item.deptScopeIds)].sort((a, b) => a - b) : [];
    const scopeKey = accessScopeKey(dataScope, deptScopeIds);
    const menuId = item.menuId ?? null;
    const key = `${menuId ?? 'permission'}:${item.permissionCode}:${scopeKey}`;
    const previous = merged.get(key);
    const refs = [...(previous?.sourceRefs ?? []), ...(item.sourceRefs ?? [])];
    merged.set(key, { permissionCode: item.permissionCode, permissionLabel: item.permissionLabel ?? null,
      menuId, pageTitle: item.pageTitle ?? null, pagePath: item.pagePath ?? null, dataScope, deptScopeIds, scopeKey,
      sourceRefs: [...new Map(refs.map(ref => [JSON.stringify(ref), ref])).values()] });
  }
  return [...merged.values()];
}

export function accessPermissionCount(items: ReadonlyArray<{ permissionCode?: string | null }>): number {
  return new Set(items.flatMap(item => item.permissionCode ? [item.permissionCode] : [])).size;
}

export function accessSourceLabel(sources: readonly AccessSourceRef[]): string {
  return sources.map(source => source.kind === 'role' ? `${source.label}（版本 ${source.roleVersion}）` : source.label).join('、');
}

export function isAccessManagerNode(nodeKey: string): boolean {
  return ACCESS_APPROVAL_POLICIES.some(policy => ACCESS_APPROVAL_STEPS[policy].some(step => step.nodeKey === nodeKey && step.kind === 'manager'));
}

/** 冻结完整流程及实际审批人，保留未命中分支供原有流程图展示和高亮。 */
export function buildAccessApprovalFlow(plan: AccessApprovalPlan, settings?: WorkflowFlowData['settings']): WorkflowFlowData {
  const required = ACCESS_APPROVAL_STEPS[plan.approvalPolicy];
  if (!required || required.length !== plan.steps.length || required.some((step, index) => step.nodeKey !== plan.steps[index]?.nodeKey)
    || new Set(plan.steps.map(step => step.userId)).size !== plan.steps.length || plan.steps.some(step => !Number.isSafeInteger(step.userId) || step.userId <= 0)) {
    throw new Error('权限审批计划的节点、顺序或独立审批人无效');
  }
  const template = buildAccessApprovalTemplate(settings);
  return {
    ...template,
    nodes: template.nodes.map<WorkflowFlowData['nodes'][number]>(node => {
      const step = plan.steps.find(item => item.nodeKey === node.data.key);
      if (!step) return node;
      return { ...node, data: {
        ...node.data, label: step.label, assigneeType: 'user', assigneeIds: [step.userId], approvalType: 'manual',
        assigneeNames: [step.userName],
      } };
    }),
  };
}

/** 定义页展示可用策略分支；发起时由同域策略评估冻结为实际审批计划。 */
export function buildAccessApprovalTemplate(settings?: WorkflowFlowData['settings']): WorkflowFlowData {
  const nodes: WorkflowFlowData['nodes'] = [
    { id: 'access-start', type: 'workflowNode', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '提交权限申请' } },
    { id: 'access-policy', type: 'workflowNode', position: { x: 0, y: 160 }, data: { key: 'policy_gateway', type: 'exclusiveGateway', label: '按有效策略分流' } },
  ];
  const edges: WorkflowFlowData['edges'] = [{ id: 'access-start-policy', source: 'access-start', target: 'access-policy' }];
  const labels: Record<AccessApprovalPolicy, string> = { none: '自动批准', manager: '一级审批', manager_security: '两级审批', two_person: '三级独立审批' };
  for (const [branchIndex, policy] of ACCESS_APPROVAL_POLICIES.entries()) {
    const steps = ACCESS_APPROVAL_STEPS[policy];
    const ids = steps.length ? steps.map(step => 'access-' + step.nodeKey) : ['access-auto-approve'];
    edges.push({ id: 'access-branch-' + policy, label: labels[policy], source: 'access-policy', target: ids[0], condition: { field: 'approvalPolicy', operator: 'eq', value: policy } });
    if (!steps.length) nodes.push({ id: ids[0], type: 'workflowNode', position: { x: branchIndex * 320, y: 320 }, data: { key: 'policy_auto_approve', type: 'approve', label: '策略自动批准', approvalType: 'autoApprove' } });
    for (const [index, step] of steps.entries()) nodes.push({ id: ids[index], type: 'workflowNode', position: { x: branchIndex * 320, y: 320 + index * 160 }, data: {
      key: step.nodeKey, type: 'approve', label: step.label, assigneeType: 'formUser', formUserField: step.userField,
      approvalType: 'manual', approveMethod: 'or', emptyStrategy: 'reject', sameInitiatorStrategy: 'selfApprove', deduplicateStrategy: 'repeatApprove',
      signaturePolicy: 'none', rejectStrategy: 'terminate', operations: ['opinionRequired'], fieldPermissions: {},
      actionButtons: { approve: { enabled: true }, reject: { enabled: true }, transfer: { enabled: false }, delegate: { enabled: false }, addSign: { enabled: false }, reduceSign: { enabled: false }, return: { enabled: false } },
    } });
    for (const [index, id] of ids.entries()) edges.push({ id: id + '-next', source: id, target: ids[index + 1] ?? 'access-end' });
  }
  nodes.push(
    { id: 'access-invalid', type: 'workflowNode', position: { x: 1280, y: 320 }, data: { key: 'policy_invalid', type: 'approve', label: '策略无效，拒绝申请', approvalType: 'autoReject', rejectStrategy: 'terminate' } },
    { id: 'access-end', type: 'workflowNode', position: { x: 640, y: 840 }, data: { key: 'end', type: 'end', label: '审批结束，发放结果另行查询' } },
  );
  edges.push({ id: 'access-policy-invalid', label: '无有效策略', source: 'access-policy', target: 'access-invalid', isDefault: true }, { id: 'access-invalid-end', source: 'access-invalid', target: 'access-end' });
  return { nodes, edges, settings: { ...settings, notifyInitiator: true, approverDedupMode: 'none', allowResubmit: false, allowWithdraw: true, allowComment: settings?.allowComment ?? true, summaryFields: ['targetUserName', 'riskLabel', 'expiresAt'] } };
}
