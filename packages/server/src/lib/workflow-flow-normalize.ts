import { workflowFlowDataSchema } from '@zenith/shared/workflow/graph-schema';
import { workflowEdgeHasCondition } from '@zenith/shared/workflow';
import type { WorkflowEdge, WorkflowFlowData } from '@zenith/shared/workflow';
/** 所有写入口共用 canonical graph 契约；不接受树或隐式旧格式转换。 */
export function normalizeDefinitionFlowData(flowData: unknown): WorkflowFlowData | null {
  if (flowData == null) return null;
  const graph = workflowFlowDataSchema.parse(flowData);
  return { ...graph, edges: canonicalizeEdges(graph.edges) };
}

/**
 * Canonical edge order：同一源节点的出边按 priority 排序并回填 priority，其余边保持首次出现顺序。
 * 运行时与预测都按数组顺序消费出边，规范化后“数组顺序 = 显式优先级”，不再依赖调用方顺序。
 */
function canonicalizeEdges(edges: WorkflowEdge[]): WorkflowEdge[] {
  const groups = new Map<string, Array<{ edge: WorkflowEdge; index: number }>>();
  const sourceOrder: string[] = [];
  edges.forEach((edge, index) => {
    const list = groups.get(edge.source);
    if (!list) {
      groups.set(edge.source, [{ edge, index }]);
      sourceOrder.push(edge.source);
      return;
    }
    list.push({ edge, index });
  });
  const out: WorkflowEdge[] = [];
  for (const source of sourceOrder) {
    const list = groups.get(source)!;
    list.sort((a, b) => (a.edge.priority ?? a.index) - (b.edge.priority ?? b.index) || a.index - b.index);
    list.forEach(({ edge }, priority) => {
      out.push({
        ...edge,
        priority,
        // 默认 = 无条件；显式 isDefault 只作为 UI 提示，与条件互斥
        ...(edge.isException ? {} : { isDefault: !workflowEdgeHasCondition(edge) }),
      });
    });
  }
  return out;
}

/** 读路径统一剔除遗留顶层字段（如旧 process 树结构）：不校验不抛错，保证旧行可读，
 * 且读出结果可直接回写 PUT（避免 GET 返回 process 而 PUT 严格拒绝的读写不对称）。 */
export function sanitizeFlowDataForRead(flowData: unknown): WorkflowFlowData | null {
 if (flowData == null || typeof flowData !== 'object') return null;
 const { process: _legacy, ...rest } = flowData as Record<string, unknown>;
 return rest as unknown as WorkflowFlowData;
}
export function collectFlowAssigneeIds(flowData: unknown): number[] {
 const graph = normalizeDefinitionFlowData(flowData);
 const ids = new Set<number>();
 for (const { data } of graph?.nodes ?? []) {
  if (data.assigneeType !== undefined && data.assigneeType !== 'user') continue;
  for (const id of [...(data.assigneeIds ?? []), ...(data.userIds ?? []), ...(data.assigneeId ? [data.assigneeId] : [])]) ids.add(id);
 }
 return [...ids];
}
export function applyFlowAssigneeNames(flowData: unknown, names: Map<number, string>): WorkflowFlowData | null {
 const graph = normalizeDefinitionFlowData(flowData);
 for (const { data } of graph?.nodes ?? []) {
  if (data.assigneeType !== undefined && data.assigneeType !== 'user') continue;
  const ids = data.assigneeIds ?? data.userIds ?? (data.assigneeId ? [data.assigneeId] : []);
  if (ids.length) data.assigneeNames = ids.map(id => names.get(id) ?? ('用户#' + id));
 }
 return graph;
}
