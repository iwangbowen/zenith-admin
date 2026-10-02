import { workflowFlowDataSchema } from '@zenith/shared/workflow/graph-schema';
import type { WorkflowFlowData } from '@zenith/shared/workflow';
/** 所有写入口共用 canonical graph 契约；不接受树或隐式旧格式转换。 */
export function normalizeDefinitionFlowData(flowData: unknown): WorkflowFlowData | null {
 return flowData == null ? null : workflowFlowDataSchema.parse(flowData);
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
