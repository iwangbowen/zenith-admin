import type { WorkflowEventSignMode } from './types';

/** A blank editor field keeps the saved key; HMAC always has a usable key. */
export function resolveWorkflowSubscriptionSecret(
  mode: WorkflowEventSignMode,
  supplied: string | null | undefined,
  previous: string | null | undefined,
  generate: () => string,
): string | null {
  if (supplied?.trim()) return supplied;
  if (previous?.trim()) return previous;
  return mode === 'hmacSha256' ? generate() : null;
}
