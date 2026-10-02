/** 提交前只读预览：与发起校验共用路径规划，不执行节点副作用或随机选人。 */
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { planWorkflowPath } from '@zenith/shared/workflow';
import type { WorkflowFlowData, WorkflowApproverPreviewNode, WorkflowFormField, WorkflowPredictedPathNode } from '@zenith/shared/workflow';
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

const APPROVER_TYPES = new Set(['approve', 'handler']);
const INITIATOR_SELECT_TYPES = new Set(['initiatorSelect', 'initiatorSelectScope']);

export async function previewFlow(
  definitionId: number,
  formData?: Record<string, unknown> | null,
): Promise<WorkflowApproverPreviewNode[]> {
  const user = currentUser();
  const [def] = await db.select().from(workflowDefinitions)
    .where(buildWhere(eq(workflowDefinitions.id, definitionId), eq(workflowDefinitions.status, 'published'), tenantCondition(workflowDefinitions, user))).limit(1);
  requireRow(def, '流程定义不存在或未发布');
  await assertWorkflowInitiatorScope(def, user);
  const flowData = def.flowData as WorkflowFlowData | null;
  if (!flowData?.nodes?.length) throw new HTTPException(400, { message: '流程未配置，无法预览' });
  const snapshot = def.formType === 'designer' ? await resolveFormSnapshot(def.formId) : null;
  return previewFlowData(flowData, formData, snapshot?.fields);
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
  const planned = plan.nodes.filter(node => APPROVER_TYPES.has(node.nodeType) || node.nodeType === 'ccNode' || node.nodeType === 'subProcess');
  const path: WorkflowPredictedPathNode[] = planned.filter(node => node.nodeType !== 'subProcess').map(node => ({
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
  });
  const byKey = new Map(predicted.map(node => [node.key, node]));
  const initiatorNames = await resolveUserNames([user.userId]);
  const nodes = await Promise.all(planned.map(async (node): Promise<WorkflowApproverPreviewNode> => {
    const config = configs.get(node.nodeKey)!;
    const prediction = byKey.get(node.nodeKey);
    const isInitiatorSelect = INITIATOR_SELECT_TYPES.has(config.assigneeType ?? '');
    const selectionRequired = isInitiatorSelect && node.status !== 'excluded';
    const approvers = prediction?.estimatedApprovers ?? [];
    return {
      nodeKey: node.nodeKey,
      nodeName: node.nodeName,
      nodeType: node.nodeType,
      status: node.status,
      reason: node.reason,
      approvers,
      approverReason: node.status === 'excluded' ? null : selectionRequired
        ? (node.status === 'unknown' ? '路径待确认，请预选审批人；仅进入该节点时生效' : '请由发起人选择审批人')
        : node.nodeType === 'subProcess' ? '子流程进入后按其流程配置确定' : prediction?.approverReason ?? null,
      selectableApprovers: selectionRequired ? await listSelectableApprovers(config) : undefined,
      selectionRequired,
      approveMethod: config.approveMethod ?? null,
      branchLabel: plan.branches.find(branch => branch.target === node.nodeId)?.label ?? null,
      empty: node.status !== 'excluded' && APPROVER_TYPES.has(node.nodeType) && !approvers.length && !selectionRequired,
    };
  }));
  return [{
    nodeKey: '__initiator__', nodeName: '发起人', nodeType: 'start',
    approvers: [{ id: user.userId, name: initiatorNames.get(user.userId) ?? user.username }],
    status: 'matched', reason: '当前发起人', approverReason: null,
    approveMethod: null, branchLabel: null, empty: false,
  }, ...nodes];
}
