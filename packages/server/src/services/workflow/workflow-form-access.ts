import { resolveNodeFieldPermissions, type WorkflowFieldPermission, type WorkflowFlowData } from '@zenith/shared/workflow';

export interface WorkflowFormViewerContext {
  initiatorId: number;
  definitionSnapshot?: { flowData?: WorkflowFlowData | null } | null;
  tasks: Array<{ assigneeId: number | null; nodeKey: string }>;
}

/** A field is hidden only when every node available to this viewer hides it. */
export function hiddenWorkflowFieldKeys(row: WorkflowFormViewerContext, userId: number): Set<string> {
  const flowData = row.definitionSnapshot?.flowData;
  if (!flowData?.nodes?.length) return new Set();
  const maps: Array<Record<string, WorkflowFieldPermission>> = [];
  if (row.initiatorId === userId) {
    const permissions = flowData.nodes.find((node) => node.data.type === 'start')?.data.fieldPermissions;
    if (!permissions) return new Set();
    maps.push(permissions);
  }
  for (const key of new Set(row.tasks.filter((task) => task.assigneeId === userId).map((task) => task.nodeKey))) {
    const permissions = resolveNodeFieldPermissions(flowData, key);
    if (!permissions) return new Set();
    maps.push(permissions);
  }
  if (!maps.length) return new Set();
  return new Set(Object.keys(maps[0]).filter((key) => maps.every((permissions) => permissions[key] === 'hidden')));
}

export function sanitizeDetailFormDataForViewer(row: WorkflowFormViewerContext & { formData: unknown }, userId: number): unknown {
  if (!row.formData || typeof row.formData !== 'object' || Array.isArray(row.formData)) return row.formData;
  const hidden = hiddenWorkflowFieldKeys(row, userId);
  return Object.fromEntries(Object.entries(row.formData).filter(([key]) => !hidden.has(key)));
}
