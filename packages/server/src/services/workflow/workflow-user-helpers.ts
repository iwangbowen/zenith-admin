import { workflowIdentity } from '../../lib/workflow-identity';

export interface WorkflowUserDisplay {
  name: string;
  avatar: string | null;
}

export async function loadWorkflowUserDisplays(
  ids: readonly number[],
): Promise<Map<number, WorkflowUserDisplay>> {
  return workflowIdentity().loadUserDisplays(ids);
}
