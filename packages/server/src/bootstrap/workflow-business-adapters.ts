import { accessWorkflowBusinessAdapter } from '../integrations/access-approval/adapter';
import type { WorkflowBusinessAdapter } from '../lib/workflow-business-types';

/** 只声明领域适配器；导入不启动进程、订阅或数据库访问。 */
export const WORKFLOW_BUSINESS_ADAPTERS: readonly WorkflowBusinessAdapter[] = [accessWorkflowBusinessAdapter];

import { registerWorkflowBusinessAdapter, sealWorkflowBusinessAdapters } from '../lib/workflow-business';
import { registerWorkflowIdentity } from '../lib/workflow-identity';
import { loadUserDisplays, listSelectableUsers } from '../services/identity/public/directory';
import { resolveSignature } from '../services/identity/public/signatures';
export function registerWorkflowIntegrations(): void {
  for (const adapter of WORKFLOW_BUSINESS_ADAPTERS) registerWorkflowBusinessAdapter(adapter);
  sealWorkflowBusinessAdapters();
  registerWorkflowIdentity({ loadUserDisplays, listSelectableUsers, resolveSignature });
}
