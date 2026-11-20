import { runtimeStartForm } from '../runtime/start-form';
// ─── 发起人自选审批人与表单起始权限（拆分自 workflow-instances.service.ts）───
import { applyRuntimeInitiatorSelections } from '../runtime/initiator-selection';
import { advanceTokens } from '../../../lib/workflow-token-engine';
import type { WorkflowFlowData, WorkflowStarterContext, WorkflowPathPlanOptions } from '@zenith/shared/workflow';
import { findNextApproverSelectNodes } from '@zenith/shared/workflow';
import { HTTPException } from 'hono/http-exception';
import { buildStarterContext, filterSelectedApproverIds } from '../workflow-assignee-resolver.service';
import type { DbExecutor } from '../../../db/types';

/** 发起前快速校验：流程是否存在可执行入口（token 引擎 seed dry-run，与实际物化同源） */
/** 后端字段权限强校验：剔除 start 节点标记为 hidden/read 的字段，防止客户端写入隐藏/只读字段 */
export function sanitizeFormByStartPerms(flowData: WorkflowFlowData, formData: Record<string, unknown>): Record<string, unknown> {
  return runtimeStartForm(flowData, formData);
}

export function hasExecutableEntry(flowData: WorkflowFlowData, formData: Record<string, unknown>, starter?: WorkflowStarterContext): boolean {
  const preview = advanceTokens({ flowData, formData, starter, liveTokens: [], trigger: { type: 'seed' } });
  return preview.tasksToCreate.length > 0 || preview.finished || preview.rejected || preview.pendingDecisions.length > 0;
}

export type SelectedApproverMap = Record<string, number[]>;

export async function applyInitiatorSelectedApprovers(
  flowData: WorkflowFlowData,
  selected: SelectedApproverMap | null | undefined,
  context: Pick<WorkflowPathPlanOptions, 'formData' | 'formFields' | 'starter'> = {},
  executor?: DbExecutor,
): Promise<WorkflowFlowData> {
  return applyRuntimeInitiatorSelections(flowData, selected, context, (config, ids) => filterSelectedApproverIds(config, ids, executor));
}


export async function assertSelectedNextApprovers(
  flowData: WorkflowFlowData,
  fromNodeKey: string,
  selectedNextApprovers: Record<string, number[]> | undefined,
  executor: DbExecutor,
  context: {
    /** 本次审批合并后的表单值（实例 formData + 本节点允许写回的 formUpdates） */
    formData?: Readonly<Record<string, unknown>>;
    /** 条件规则引用发起人维度（部门 / 角色 / 岗位）时才需要 */
    initiatorId?: number;
  } = {},
): Promise<void> {
  // 与引擎选边同源：条件分支只对命中（或尚不确定）的分支要求选人，
  // 否则「未经过分支上的 approverSelect」会被误判为必填，甚至把选人结果应用到错误分支。
  const starter = context.initiatorId != null && flowUsesStarterConditions(flowData)
    ? await buildStarterContext(context.initiatorId, executor)
    : undefined;
  const selectNodes = findNextApproverSelectNodes(flowData, fromNodeKey, { formData: context.formData, starter });
  if (selectNodes.length === 0) return;
  for (const node of selectNodes) {
    const picked = await filterSelectedApproverIds(node.data, selectedNextApprovers?.[node.data.key] ?? [], executor);
    if (picked.length === 0) {
      throw new HTTPException(400, { message: `请选择节点「${node.data.label || node.data.key}」的审批人` });
    }
  }
}

/** 流程条件中是否存在引用发起人维度（user/dept/role/post）的规则 */
function flowUsesStarterConditions(flowData: WorkflowFlowData): boolean {
  return (flowData.edges ?? []).some((edge) =>
    [edge.condition, ...(edge.conditions ?? []).flatMap((group) => group.rules)]
      .some((rule) => rule?.source === 'starter'));
}
