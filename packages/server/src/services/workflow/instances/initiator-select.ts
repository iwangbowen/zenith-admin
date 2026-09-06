// ─── 发起人自选审批人与表单起始权限（拆分自 workflow-instances.service.ts）───
import { uniquePositiveInts } from '@zenith/shared/core';
import { advanceTokens } from '../../../lib/workflow-token-engine';
import type { WorkflowFlowData, WorkflowStarterContext } from '@zenith/shared/workflow';
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
  return preview.tasksToCreate.length > 0 || preview.finished || preview.rejected;
}

export type SelectedApproverMap = Record<string, number[]>;

const INITIATOR_SELECT_ASSIGNEE_TYPES = new Set(['initiatorSelect', 'initiatorSelectScope']);

function normalizeSelectedApproverMap(input?: SelectedApproverMap | null): SelectedApproverMap {
  const out: SelectedApproverMap = {};
  for (const [nodeKey, ids] of Object.entries(input ?? {})) {
    if (!nodeKey || !Array.isArray(ids)) continue;
    const normalized = uniquePositiveInts(ids);
    if (normalized.length > 0) out[nodeKey] = normalized;
  }
  return out;
}

export async function applyInitiatorSelectedApprovers(
  flowData: WorkflowFlowData,
  selected: SelectedApproverMap | null | undefined,
  executor?: DbExecutor,
): Promise<WorkflowFlowData> {
  const normalized = normalizeSelectedApproverMap(selected);
  const selectNodes = (flowData.nodes ?? []).filter((node) => INITIATOR_SELECT_ASSIGNEE_TYPES.has(node.data.assigneeType ?? ''));
  if (selectNodes.length === 0) return flowData;

  const selectedByNode = new Map<string, number[]>();
  for (const node of selectNodes) {
    const picked = await filterSelectedApproverIds(node.data, normalized[node.data.key] ?? [], executor);
    if (picked.length === 0) {
      throw new HTTPException(400, { message: `请选择节点「${node.data.label || node.data.key}」的审批人` });
    }
    selectedByNode.set(node.data.key, picked);
  }

  return {
    ...flowData,
    nodes: flowData.nodes.map((node) => {
      const picked = selectedByNode.get(node.data.key);
      if (!picked) return node;
      return {
        ...node,
        data: {
          ...node.data,
          userIds: picked,
          assigneeIds: picked,
          assigneeId: picked.length === 1 ? picked[0] : null,
        },
      };
    }),
  };
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
