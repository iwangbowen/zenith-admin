import type { WorkflowTriggerNodeConfig } from '@zenith/shared/workflow';
import { renderWorkflowTemplate } from '../../../lib/workflow-jobs/handlers/shared';

/** Form mutation semantics shared by durable jobs and isolated memory effects. */
export function runtimeTriggerData(config: WorkflowTriggerNodeConfig, base: Record<string, unknown>) {
  const next = { ...base };
  for (const key of config.fieldKeys ?? []) {
    if (config.triggerType === 'deleteData') delete next[key];
    else if (config.triggerType === 'updateData') {
      const template = config.fieldValues?.[key];
      next[key] = template === undefined ? null : renderWorkflowTemplate(template, base);
    }
  }
  return next;
}
