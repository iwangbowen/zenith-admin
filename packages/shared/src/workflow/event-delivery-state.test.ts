import { describe, expect, it } from 'vitest';
import { workflowEventDeliveryState } from './event-delivery-state';

const attempt = {
  executionId: 10, executionStatus: 'failed' as const, latestExecutionId: 10,
  latestExecutionStatus: 'failed' as const, jobStatus: 'dead' as const,
  jobAttempts: 5, subscriptionEnabled: true,
};

describe('workflow event delivery state', () => {
  it('preserves a historical failure after a later delivery succeeds', () => {
    expect(workflowEventDeliveryState({ ...attempt, latestExecutionId: 11, latestExecutionStatus: 'succeeded', jobStatus: 'succeeded' }))
      .toMatchObject({ status: 'failed', jobStatus: 'success', isLatestExecution: false, canRetry: false, canReplay: false });
  });

  it('distinguishes no-op skips from successful deliveries', () => {
    expect(workflowEventDeliveryState({ ...attempt, executionStatus: 'skipped', latestExecutionStatus: 'skipped', jobStatus: 'succeeded' }))
      .toMatchObject({ status: 'skipped', jobStatus: 'skipped', canRetry: false, canReplay: true });
  });

  it('exposes pending automatic retries without enabling manual retry', () => {
    expect(workflowEventDeliveryState({ ...attempt, jobStatus: 'pending', jobAttempts: 1 }))
      .toMatchObject({ status: 'failed', jobStatus: 'retrying', canRetry: false, canReplay: false });
  });

  it('reports a newly queued manual retry without rewriting its old attempt', () => {
    expect(workflowEventDeliveryState({ ...attempt, jobStatus: 'pending', jobAttempts: 0 }))
      .toMatchObject({ status: 'failed', jobStatus: 'pending', canRetry: false, canReplay: false });
  });

  it('makes only the latest enabled dead-letter attempt retryable', () => {
    expect(workflowEventDeliveryState(attempt)).toMatchObject({ status: 'failed', jobStatus: 'dead', canRetry: true, canReplay: true });
    expect(workflowEventDeliveryState({ ...attempt, subscriptionEnabled: false })).toMatchObject({ canRetry: false, canReplay: false });
    expect(workflowEventDeliveryState({ ...attempt, latestExecutionId: 11 })).toMatchObject({ canRetry: false, canReplay: false });
  });

  it('records cancellation separately from request failure', () => {
    expect(workflowEventDeliveryState({ ...attempt, executionStatus: 'canceled', latestExecutionStatus: 'canceled', jobStatus: 'canceled' }))
      .toMatchObject({ status: 'cancelled', jobStatus: 'cancelled', canRetry: true });
  });

  it('never enables terminal operations while a request is running', () => {
    expect(workflowEventDeliveryState({ ...attempt, executionStatus: 'running', latestExecutionStatus: 'running', jobStatus: 'running' }))
      .toMatchObject({ status: 'running', jobStatus: 'running', canRetry: false, canReplay: false });
  });
});
