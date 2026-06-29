/**
 * 运行中实例迁移引擎（纯函数部分）：对比旧/新定义节点 key，给出可迁移性判定。
 * 不考虑向后兼容：活动 token/task 所在节点必须在新版本仍存在（同 key），否则阻断。
 */
import type { WorkflowFlowData, WorkflowMigrationNode } from '@zenith/shared';

export function nodeKeys(flow: WorkflowFlowData): Set<string> {
  return new Set((flow.nodes ?? []).map((n) => n.data.key));
}

/** 计算迁移节点视图：活动节点是否在新版本存在 + 活动任务/令牌数 */
export function buildMigrationNodes(
  newFlow: WorkflowFlowData,
  active: Array<{ nodeKey: string; tasks: number; tokens: number; label?: string }>,
): { nodes: WorkflowMigrationNode[]; blocked: string[] } {
  const keys = nodeKeys(newFlow);
  const labelOf = new Map((newFlow.nodes ?? []).map((n) => [n.data.key, n.data.label]));
  const nodes: WorkflowMigrationNode[] = active.map((a) => ({
    nodeKey: a.nodeKey,
    label: labelOf.get(a.nodeKey) ?? a.label ?? a.nodeKey,
    inNew: keys.has(a.nodeKey),
    activeTasks: a.tasks,
    activeTokens: a.tokens,
  }));
  const blocked = nodes.filter((n) => !n.inNew).map((n) => n.nodeKey);
  return { nodes, blocked };
}
