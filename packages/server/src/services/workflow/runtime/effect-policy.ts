import type { WorkflowNodeConfig, WorkflowTimeoutConfig, WorkflowNodeFailurePolicy } from '@zenith/shared/workflow';

export function runtimeTimeoutAction(config: WorkflowTimeoutConfig, remindCount: number) {
  if (config.action === 'autoApprove' || config.action === 'autoReject') return config.action;
  return remindCount + 1 < (config.remindCount ?? 3) ? 'remind' : config.escalateAction ?? 'none';
}

export function runtimeSubprocessOutcome(config: WorkflowNodeConfig | null | undefined, outcomes: string[], total: number) {
  const rejected = outcomes.some(status => status !== 'approved' && status !== 'finished')
    && (config?.subProcessOnChildReject ?? 'abort') === 'abort' && config?.subProcessIgnoreReject !== true;
  return rejected ? 'reject' : outcomes.length >= total ? 'approve' : 'wait';
}

export function runtimeFailureDisposition(policy: WorkflowNodeFailurePolicy, hasFallbackNode: boolean) {
  if (policy.action === 'terminate') return 'terminate';
  if (policy.action === 'continue') return 'continue';
  if (policy.action === 'fallback' && policy.fallbackNodeKey && hasFallbackNode) return 'jump';
  if (policy.action === 'fallback' && policy.fallbackAction) return 'continue';
  return 'repair';
}
