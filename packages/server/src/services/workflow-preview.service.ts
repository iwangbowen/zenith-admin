/**
 * 提交前审批链路预览（T1-1）
 *
 * 对已发布流程做"干跑"遍历：从 start 沿正常边走，按节点 assigneeType 解析出真实审批人姓名，
 * 供发起页在提交前展示「审批人：张三 → 李四 → …」。条件/并行分支会标注分支名并展开所有分支。
 */
import { eq, and, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { workflowDefinitions, users } from '../db/schema';
import { tenantCondition } from '../lib/tenant';
import { currentUser } from '../lib/context';
import { resolveAssigneeIds } from './workflow-assignee-resolver.service';
import type { WorkflowFlowData, WorkflowApproverPreviewNode } from '@zenith/shared';

const APPROVER_TYPES = new Set(['approve', 'handler']);

export async function previewFlow(
  definitionId: number,
  formData?: Record<string, unknown> | null,
): Promise<WorkflowApproverPreviewNode[]> {
  const user = currentUser();
  const tc = tenantCondition(workflowDefinitions, user);
  const conds = [eq(workflowDefinitions.id, definitionId)];
  if (tc) conds.push(tc);
  const [def] = await db.select().from(workflowDefinitions).where(and(...conds)).limit(1);
  if (!def) throw new HTTPException(404, { message: '流程定义不存在' });
  const flowData = def.flowData as WorkflowFlowData | null;
  if (!flowData?.nodes?.length) throw new HTTPException(400, { message: '流程未配置，无法预览' });

  const nodeById = new Map(flowData.nodes.map((n) => [n.id, n]));
  const outEdges = new Map<string, WorkflowFlowData['edges']>();
  const inDegree = new Map<string, number>();
  for (const e of flowData.edges) {
    if (e.isException) continue;
    if (nodeById.get(e.target)?.data.type === 'catchNode') continue;
    (outEdges.get(e.source) ?? outEdges.set(e.source, []).get(e.source)!).push(e);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }
  const startNode = flowData.nodes.find((n) => n.data.type === 'start');
  if (!startNode) throw new HTTPException(400, { message: '流程缺少开始节点' });

  const fd = (formData ?? {}) as Record<string, unknown>;
  const pendingIds = new Set<number>();
  const entries: Array<{ nodeKey: string; nodeName: string; nodeType: string; ids: number[]; approveMethod: string | null; branchLabel: string | null }> = [];
  const visited = new Set<string>();

  // 发起人节点：始终作为链路第一个节点，展示当前发起人
  entries.push({ nodeKey: '__initiator__', nodeName: '发起人', nodeType: 'start', ids: [user.userId], approveMethod: null, branchLabel: null });
  pendingIds.add(user.userId);

  const walk = async (nodeId: string, branchLabel: string | null): Promise<void> => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeById.get(nodeId);
    if (!node) return;
    const type = node.data.type;
    if (APPROVER_TYPES.has(type) || type === 'ccNode' || type === 'subProcess') {
      let ids: number[] = [];
      if (type !== 'subProcess') {
        try {
          ids = await resolveAssigneeIds(node.data, { initiatorId: user.userId, formData: fd });
        } catch {
          ids = [];
        }
      }
      ids.forEach((id) => pendingIds.add(id));
      entries.push({
        nodeKey: node.data.key,
        nodeName: node.data.label,
        nodeType: type,
        ids,
        approveMethod: node.data.approveMethod ?? null,
        branchLabel,
      });
    }
    const outs = outEdges.get(nodeId) ?? [];
    const isBranch = outs.length > 1;
    for (const e of outs) {
      const targetMerge = (inDegree.get(e.target) ?? 0) > 1;
      const nextLabel = targetMerge ? null : (isBranch ? (e.label || '分支') : branchLabel);
      await walk(e.target, nextLabel);
    }
  };
  await walk(startNode.id, null);

  const idList = [...pendingIds];
  const nameMap = new Map<number, string>();
  if (idList.length > 0) {
    const rows = await db.select({ id: users.id, nickname: users.nickname, username: users.username })
      .from(users).where(inArray(users.id, idList));
    for (const r of rows) nameMap.set(r.id, r.nickname ?? r.username);
  }

  return entries.map((e) => ({
    nodeKey: e.nodeKey,
    nodeName: e.nodeName,
    nodeType: e.nodeType,
    approvers: e.ids.map((id) => ({ id, name: nameMap.get(id) ?? `用户#${id}` })),
    approveMethod: e.approveMethod,
    branchLabel: e.branchLabel,
    empty: APPROVER_TYPES.has(e.nodeType) && e.ids.length === 0,
  }));
}
