import { SEED_WORKFLOW_CONNECTORS } from '@zenith/shared';
import type { WorkflowConnector } from '@zenith/shared';

export const mockWorkflowConnectors: WorkflowConnector[] = SEED_WORKFLOW_CONNECTORS.map((c) => ({
  ...c,
  description: c.description ?? null,
  config: c.config as Record<string, unknown>,
  hasCredentials: false,
  breakerState: 'closed',
  tenantId: null,
  createdBy: null,
  updatedBy: null,
}));

let idSeq = Math.max(0, ...mockWorkflowConnectors.map((c) => c.id)) + 1;
export const getNextConnectorId = (): number => idSeq++;
