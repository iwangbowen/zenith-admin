import { workflowFlowDataSchema } from '@zenith/shared/workflow/graph-schema';
import type { WorkflowFlowData } from '@zenith/shared/workflow';
/** 所有写入口共用 canonical graph 契约；不接受树或隐式旧格式转换。 */
export function normalizeDefinitionFlowData(flowData: unknown): WorkflowFlowData | null {
 return flowData == null ? null : workflowFlowDataSchema.parse(flowData);
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
