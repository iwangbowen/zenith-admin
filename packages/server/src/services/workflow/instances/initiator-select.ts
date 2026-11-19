// ─── 发起人自选审批人与表单起始权限（拆分自 workflow-instances.service.ts）───
import { applyRuntimeInitiatorSelections } from '../runtime/initiator-selection';
import { advanceTokens } from '../../../lib/workflow-token-engine';
import type { WorkflowFlowData, WorkflowStarterContext, WorkflowPathPlanOptions } from '@zenith/shared/workflow';
import { findNextApproverSelectNodes } from '@zenith/shared/workflow';
import { HTTPException } from 'hono/http-exception';
import { filterSelectedApproverIds } from '../workflow-assignee-resolver.service';
import type { DbExecutor } from '../../../db/types';

/** 发起前快速校验：流程是否存在可执行入口（token 引擎 seed dry-run，与实际物化同源） */
/** 后端字段权限强校验：剔除 start 节点标记为 hidden/read 的字段，防止客户端写入隐藏/只读字段 */
export function sanitizeFormByStartPerms(flowData: WorkflowFlowData, formData: Record<string, unknown>): Record<string, unknown> {
  const start = flowData.nodes?.find((n) => n.data.type === 'start')?.data;
  const perms = start?.fieldPermissions;
  if (!perms) return formData;
  const out: Record<string, unknown> = { ...formData };
  for (const [k, p] of Object.entries(perms)) if ((p === 'hidden' || p === 'read') && k in out) delete out[k];
  return out;
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
): Promise<void> {
  // 仅校验「紧邻的下一审批节点」中的 approverSelect（穿过网关/抄送，遇到人工节点即停），
  // 与引擎本次推进实际物化的任务一致，避免对更下游 approverSelect 的过早强制选人。
  const selectNodes = findNextApproverSelectNodes(flowData, fromNodeKey);
  if (selectNodes.length === 0) return;
  for (const node of selectNodes) {
    const picked = await filterSelectedApproverIds(node.data, selectedNextApprovers?.[node.data.key] ?? [], executor);
    if (picked.length === 0) {
      throw new HTTPException(400, { message: `请选择节点「${node.data.label || node.data.key}」的审批人` });
    }
  }
}
