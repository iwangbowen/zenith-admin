/** 提交前只读预览：与发起校验共用路径规划，不执行节点副作用或随机选人。 */
import { eq } from 'drizzle-orm';
import { getWorkflowDefinitionBusinessAdapter } from '../../lib/workflow-business';
import { HTTPException } from 'hono/http-exception';
import { getWorkflowNumberingFields, planWorkflowPath } from '@zenith/shared/workflow';
import { classifyWorkflowNode } from '@zenith/shared/workflow';
import type { WorkflowCustomFormConfig, WorkflowFlowData, WorkflowApproverPreviewNode, WorkflowFormField, WorkflowPredictedPathNode } from '@zenith/shared/workflow';
import { db } from '../../db';
import { workflowDefinitions } from '../../db/schema';
import { tenantCondition } from '../../lib/tenant';
import { currentUser } from '../../lib/context';
import { buildStarterContext, listSelectableApprovers, resolveAssigneeIds } from './workflow-assignee-resolver.service';
import { requireRow } from '../../lib/db-assert';
import { buildWhere } from '../../lib/where-helpers';
import { resolveUserNames } from '../../lib/user-nicknames';
import { resolveFormSnapshot } from './workflow-forms.service';
import { assertWorkflowInitiatorScope } from './workflow-launch-access';
import { enrichPredictedApprovers } from './workflow-path-prediction';
import { sanitizeFormByStartPerms } from './instances/initiator-select';
import { toDefinitionSnapshot } from './instances/shared';

const APPROVER_TYPES = new Set(['approve', 'handler']);
const INITIATOR_SELECT_TYPES = new Set(['initiatorSelect', 'initiatorSelectScope']);
const DYNAMIC_ASSIGNEE_TYPES = new Set(['formUser', 'formDepartment', 'expression', 'nodeApprover', 'decision', 'approverSelect', ...INITIATOR_SELECT_TYPES]);

export async function previewFlow(
  definitionId: number,
  formData?: Record<string, unknown> | null,
): Promise<WorkflowApproverPreviewNode[]> {
  const user = currentUser();
  const [def] = await db.select().from(workflowDefinitions)
    .where(buildWhere(eq(workflowDefinitions.id, definitionId), eq(workflowDefinitions.status, 'published'), tenantCondition(workflowDefinitions, user))).limit(1);
  requireRow(def, '流程定义不存在或未发布');
  await assertWorkflowInitiatorScope(def, user);
  let flowData = def.flowData as WorkflowFlowData | null;
  if (!flowData?.nodes?.length) throw new HTTPException(400, { message: '流程未配置，无法预览' });
  const snapshot = def.formType === 'designer' ? await resolveFormSnapshot(def.formId) : null;
  const customForm = def.customForm as WorkflowCustomFormConfig | null;
  const formFields = getWorkflowNumberingFields(def.formType, snapshot?.fields ?? [], customForm);
  let previewData = formData ?? {};
  const businessAdapter = getWorkflowDefinitionBusinessAdapter(toDefinitionSnapshot(def));
  if (businessAdapter?.prepare) {
    const prepared = await businessAdapter.prepare({ mode: 'preview', definition: toDefinitionSnapshot(def, flowData), formData: previewData, flowData, actor: user });
    previewData = prepared.formData;
    flowData = prepared.flowData;
  }
  return previewFlowData(flowData, previewData, formFields);
}

/** 业务调用方先授权已发布定义；业务变量无表单快照时不推算派生字段。 */
export async function previewFlowData(
  flowData: WorkflowFlowData,
  formData?: Record<string, unknown> | null,
  formFields?: WorkflowFormField[],
): Promise<WorkflowApproverPreviewNode[]> {
  const user = currentUser();
  if (!flowData.nodes.some(node => node.data.type === 'start')) {
    throw new HTTPException(400, { message: '流程缺少开始节点' });
  }
  const starter = await buildStarterContext(user.userId);
  const plan = planWorkflowPath(flowData, {
    formData: sanitizeFormByStartPerms(flowData, formData ?? {}),
    formFields,
    starter,
    recomputeDerivedValues: true,
  });
  const configs = new Map(flowData.nodes.map(node => [node.data.key, node.data]));
  const branchMemberships = buildPreviewBranchMemberships(plan);
  const planned = plan.nodes.filter(node => APPROVER_TYPES.has(node.nodeType)
    || node.nodeType === 'ccNode'
    || node.nodeType === 'subProcess'
    || node.nodeType === 'delay'
    || node.nodeType === 'trigger');
  const path: WorkflowPredictedPathNode[] = planned.filter(node => APPROVER_TYPES.has(node.nodeType) || node.nodeType === 'ccNode').map(node => ({
    key: node.nodeKey,
    name: node.nodeName,
    type: node.nodeType === 'ccNode' ? 'cc' : node.nodeType as 'approve' | 'handler',
    status: node.status,
    reason: node.reason,
  }));
  const predicted = await enrichPredictedApprovers(path, flowData, {
    resolve: config => INITIATOR_SELECT_TYPES.has(config.assigneeType ?? '')
      ? Promise.resolve([])
      : resolveAssigneeIds(config, { initiatorId: user.userId, formData: { ...plan.formData } }),
    names: resolveUserNames,
    initiatorId: user.userId,
  });
  const byKey = new Map(predicted.map(node => [node.key, node]));
  const initiatorNames = await resolveUserNames([user.userId]);
  const nodes = await Promise.all(planned.map(async (node): Promise<WorkflowApproverPreviewNode> => {
    const config = configs.get(node.nodeKey)!;
    const prediction = byKey.get(node.nodeKey);
    const behavior = classifyWorkflowNode(config);
    const isWait = behavior.kind === 'wait';
    // 抄送 / 子流程 / 等待节点没有“审批动作”，自动动作只标注人工审批 / 办理节点
    const automaticAction = node.nodeType !== 'approve' && node.nodeType !== 'handler' ? null
      : prediction?.policySkipped ? 'approve' : config.approvalType === 'autoReject' ? 'reject' : config.approvalType === 'autoApprove' || config.approveMethod === 'auto' ? 'approve' : null;
    const isInitiatorSelect = INITIATOR_SELECT_TYPES.has(config.assigneeType ?? '');
    const selectionRequired = isInitiatorSelect && node.status !== 'excluded';
    const approvers = isWait ? [] : prediction?.estimatedApprovers ?? [];
    const dynamicApprover = config.approveMethod === 'random' || DYNAMIC_ASSIGNEE_TYPES.has(config.assigneeType ?? '');
    const approverState: 'known' | 'empty' | 'unknown' =
      isWait || automaticAction || approvers.length > 0 ? (isWait ? 'unknown' : 'known')
        : node.status === 'excluded' || node.nodeType === 'subProcess' || dynamicApprover || selectionRequired ? 'unknown'
          : 'empty';
    const waitReason = behavior.waitReason;
    const waitText = waitReason === 'delay' ? '到达设定时间后继续'
      : waitReason === 'subprocess' ? (behavior.blocks ? '子流程进入后按其流程配置确定' : '子流程已发起，不等待其完成')
        : waitReason === 'external' || waitReason === 'trigger'
          ? (config.triggerConfig?.triggerType === 'callback' ? '等待外部回调后继续' : '等待异步处理完成后继续')
          : null;
    return {
      nodeKey: node.nodeKey,
      nodeName: node.nodeName,
      nodeType: node.nodeType,
      status: node.status,
      reason: node.reason,
      approvers,
      approverReason: node.status === 'excluded' ? null
        : selectionRequired ? (node.status === 'unknown' ? '路径待确认，请预选审批人；仅进入该节点时生效' : '请由发起人选择审批人')
          : waitText ?? prediction?.approverReason ?? null,
      selectableApprovers: selectionRequired ? await listSelectableApprovers(config) : undefined,
      selectionRequired,
      approveMethod: automaticAction || isWait ? null : config.approveMethod ?? null,
      automaticAction,
      blocking: isWait && behavior.blocks,
      waitReason,
      requiresApproverSelection: behavior.requiresApproverSelection,
      branchLabel: plan.branches.find(branch => branch.target === node.nodeId)?.label
        ?? branchMemberships.get(node.nodeId)?.[0]?.branchLabel
        ?? null,
      branchPath: branchMemberships.get(node.nodeId),
      approverState,
    };
  }));
  return [{
    nodeKey: '__initiator__', nodeName: '发起人', nodeType: 'start',
    approvers: [{ id: user.userId, name: initiatorNames.get(user.userId) ?? user.username }],
    status: 'matched', reason: '当前发起人', approverReason: null,
    approveMethod: null, branchLabel: null, approverState: 'known',
  }, ...nodes];
}

type WorkflowPathPlan = ReturnType<typeof planWorkflowPath>;
type BranchMembership = NonNullable<WorkflowApproverPreviewNode['branchPath']>;

/**
 * 为预测节点标注所属条件分支，供前端把「条件未定」的多条分支聚合展示。
 *
 * 分支归属按网关逐条计算：从分支入口沿未排除边求出可达节点集合，被两条及以上分支同时
 * 可达的节点（汇聚点及其后的主线）不属于任何单条分支，不参与聚合。嵌套网关会为同一节点
 * 记录多层分支，按网关在预测顺序中的先后从外层到内层排列。
 */
function buildPreviewBranchMemberships(
  plan: WorkflowPathPlan,
): Map<string, BranchMembership> {
  const memberships = new Map<string, BranchMembership>();
  const outgoing = new Map<string, WorkflowPathPlan['edges'][number][]>();
  for (const edge of plan.edges) {
    if (edge.status === 'excluded') continue;
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }
  const gatewayOrder = new Map(plan.nodes.map((node, index) => [node.nodeKey, index]));

  for (const gateway of plan.nodes) {
    if (!['exclusiveGateway', 'routeGateway', 'inclusiveGateway'].includes(gateway.nodeType)) continue;
    const branches = plan.branches.filter((branch) => branch.gatewayKey === gateway.nodeKey);
    // 单分支或已被排他到只剩一条路径时无需聚合
    if (branches.filter((branch) => branch.status !== 'excluded').length < 2) continue;

    const reach = new Map<string, Set<string>>();
    for (const branch of branches) {
      const visited = new Set<string>();
      const queue = [branch.target];
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (visited.has(id) || id === gateway.nodeId) continue;
        visited.add(id);
        for (const edge of outgoing.get(id) ?? []) {
          if (edge.target !== gateway.nodeId) queue.push(edge.target);
        }
      }
      reach.set(branch.edgeId, visited);
    }
    const reachCount = new Map<string, number>();
    for (const visited of reach.values()) {
      for (const id of visited) reachCount.set(id, (reachCount.get(id) ?? 0) + 1);
    }

    branches.forEach((branch, index) => {
      if (branch.status === 'excluded') return;
      const branchLabel = branch.label ?? (branch.isDefault ? '默认' : `分支${index + 1}`);
      for (const nodeId of reach.get(branch.edgeId) ?? []) {
        if ((reachCount.get(nodeId) ?? 0) > 1) continue;
        const list = memberships.get(nodeId) ?? [];
        list.push({
          gatewayKey: branch.gatewayKey,
          gatewayLabel: gateway.nodeName,
          gatewayType: gateway.nodeType as BranchMembership[number]['gatewayType'],
          branchKey: `${branch.gatewayKey}#${index + 1}`,
          branchLabel,
          status: branch.status,
        });
        memberships.set(nodeId, list);
      }
    });
  }

  for (const list of memberships.values()) {
    list.sort((a, b) => (gatewayOrder.get(a.gatewayKey) ?? 0) - (gatewayOrder.get(b.gatewayKey) ?? 0));
  }
  return memberships;
}
