import type { WorkflowApproverPreviewNode } from '@zenith/shared/workflow';

export interface PreviewBranchRow {
  branchKey: string;
  label: string;
  nodes: WorkflowApproverPreviewNode[];
  /** 该分支上的人工审批 / 办理步骤数 */
  humanSteps: number;
}

export interface PreviewBranchGroup {
  gatewayKey: string;
  gatewayLabel: string;
  /** 条件未定的原因（同一分支组的节点共享同一句） */
  reason: string | null;
  rows: PreviewBranchRow[];
  /** 该组第一个节点在预览列表中的下标，用于在原位置渲染汇总项 */
  firstIndex: number;
  /** 该组最后一个节点下标，展开后在它之后提供「收起分支」 */
  lastIndex: number;
  /** 各组分支可能经过的最少 / 最多人工步骤 */
  minHumanSteps: number;
  maxHumanSteps: number;
}

export interface GroupedPreview {
  groups: PreviewBranchGroup[];
  /** 被汇总项替代的节点 key */
  hiddenNodeKeys: Set<string>;
  /** 首个节点下标 → 汇总项 */
  groupByFirstIndex: Map<number, PreviewBranchGroup>;
}

const emptyResult = (): GroupedPreview => ({ groups: [], hiddenNodeKeys: new Set(), groupByFirstIndex: new Map() });

function isHumanStep(node: WorkflowApproverPreviewNode): boolean {
  return (node.nodeType === 'approve' || node.nodeType === 'handler') && !node.automaticAction;
}

/**
 * 把「条件未定」的多条互斥分支聚合成一个步骤，避免面板把每条可能路径都平铺出来。
 *
 * - 只有同一网关下存在 ≥2 条仍可能命中的分支、且没有任何分支已明确命中时才聚合；
 * - 节点若位于多层嵌套分支内，取最外层的可聚合网关，内层节点一并归入外层分支的链路；
 * - 并行网关（所有分支都会经过）不参与聚合，由服务端只标注互斥 / 包容 / 路由网关。
 */
export function groupUnknownBranches(nodes: readonly WorkflowApproverPreviewNode[]): GroupedPreview {
  const gateways = new Map<string, {
    label: string;
    order: number;
    branches: Map<string, { label: string; status: string }>;
  }>();

  nodes.forEach((node) => {
    for (const ref of node.branchPath ?? []) {
      let gateway = gateways.get(ref.gatewayKey);
      if (!gateway) {
        gateway = { label: ref.gatewayLabel, order: gateways.size, branches: new Map() };
        gateways.set(ref.gatewayKey, gateway);
      }
      gateway.branches.set(ref.branchKey, { label: ref.branchLabel, status: ref.status });
    }
  });

  const aggregatable = new Set<string>();
  for (const [gatewayKey, gateway] of gateways) {
    const branches = [...gateway.branches.values()].filter((branch) => branch.status !== 'excluded');
    if (branches.length < 2) continue;
    if (branches.some((branch) => branch.status === 'matched')) continue;
    if (!branches.some((branch) => branch.status === 'unknown')) continue;
    aggregatable.add(gatewayKey);
  }
  if (aggregatable.size === 0) return emptyResult();

  // 节点归属最外层的可聚合网关：外层已折叠时内层不再单独展开
  const gatewayOfNode = new Map<string, string>();
  nodes.forEach((node) => {
    const outermost = (node.branchPath ?? []).find((ref) => aggregatable.has(ref.gatewayKey));
    if (outermost) gatewayOfNode.set(node.nodeKey, outermost.gatewayKey);
  });

  const indexOfNode = new Map(nodes.map((node, index) => [node.nodeKey, index]));
  const groups: PreviewBranchGroup[] = [];
  const hiddenNodeKeys = new Set<string>();

  for (const gatewayKey of aggregatable) {
    const gateway = gateways.get(gatewayKey)!;
    const rows: PreviewBranchRow[] = [];
    for (const [branchKey, branch] of gateway.branches) {
      if (branch.status === 'excluded') continue;
      const branchNodes = nodes.filter((node) => gatewayOfNode.get(node.nodeKey) === gatewayKey
        && (node.branchPath ?? []).some((ref) => ref.gatewayKey === gatewayKey && ref.branchKey === branchKey));
      if (branchNodes.length === 0) continue;
      rows.push({
        branchKey,
        label: branch.label,
        nodes: branchNodes,
        humanSteps: branchNodes.filter(isHumanStep).length,
      });
    }
    if (rows.length < 2) continue;
    const indexes = rows.flatMap((row) => row.nodes.map((node) => indexOfNode.get(node.nodeKey) ?? 0));
    const firstIndex = Math.min(...indexes);
    const lastIndex = Math.max(...indexes);
    const reason = rows.flatMap((row) => row.nodes).map((node) => node.reason).find(Boolean) ?? null;
    groups.push({
      gatewayKey,
      gatewayLabel: gateway.label,
      reason,
      rows,
      firstIndex,
      lastIndex,
      minHumanSteps: Math.min(...rows.map((row) => row.humanSteps)),
      maxHumanSteps: Math.max(...rows.map((row) => row.humanSteps)),
    });
    for (const row of rows) for (const node of row.nodes) hiddenNodeKeys.add(node.nodeKey);
  }

  groups.sort((a, b) => a.firstIndex - b.firstIndex);
  const groupByFirstIndex = new Map(groups.map((group) => [group.firstIndex, group]));
  return { groups, hiddenNodeKeys, groupByFirstIndex };
}

/** 分支链路文案：节点名 + 类型/自动动作提示，按流转顺序用箭头连接 */
export function branchChainText(nodes: readonly WorkflowApproverPreviewNode[], max = 6): string {
  const label = (node: WorkflowApproverPreviewNode): string => {
    if (node.nodeType === 'ccNode') return `${node.nodeName}（抄送）`;
    if (node.nodeType === 'subProcess') return `${node.nodeName}（子流程）`;
    if (node.automaticAction === 'approve') return `${node.nodeName}（自动通过）`;
    if (node.automaticAction === 'reject') return `${node.nodeName}（自动拒绝）`;
    if (node.selectionRequired) return `${node.nodeName}（自选审批人）`;
    return node.nodeName;
  };
  const shown = nodes.slice(0, max).map(label);
  if (nodes.length > max) shown.push(`等 ${nodes.length} 个节点`);
  return shown.join(' → ');
}
