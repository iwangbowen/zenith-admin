import type { WorkflowFlowData } from '@zenith/shared/workflow';

export function runtimeStartForm(flow: WorkflowFlowData, input: Record<string, unknown>) {
  const permissions = flow.nodes.find(node => node.data.type === 'start')?.data.fieldPermissions;
  const values = { ...input };
  for (const [key, permission] of Object.entries(permissions ?? {})) if (permission === 'read' || permission === 'hidden') delete values[key];
  return values;
}
