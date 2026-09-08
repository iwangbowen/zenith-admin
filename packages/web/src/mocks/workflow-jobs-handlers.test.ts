import { afterEach, describe, expect, it, vi } from 'vitest';
import { fillPath, type AnyOperation, type ApiResponse, type InputOf, type OutputOf } from '@zenith/shared/core';
import { workflowEngineContract, workflowInstanceContract, workflowInstanceOpsContract, workflowJobDetailSchema, workflowJobSummaryItemSchema, type WorkflowJob } from '@zenith/shared/workflow';
import { mockWorkflowJobs, mockWorkflowJobExecutions } from './data/workflow-jobs';
import { mockWorkflowInstances } from './data/workflow';
import { workflowHandlers } from './handlers/workflow';
import { mockDateTimeOffset } from './utils/date';

const originalJobs = structuredClone(mockWorkflowJobs);
const originalExecutions = structuredClone(mockWorkflowJobExecutions);
const originalInstances = structuredClone(mockWorkflowInstances);

afterEach(() => {
  vi.useRealTimers();
  mockWorkflowJobs.splice(0, mockWorkflowJobs.length, ...structuredClone(originalJobs));
  mockWorkflowJobExecutions.splice(0, mockWorkflowJobExecutions.length, ...structuredClone(originalExecutions));
  mockWorkflowInstances.splice(0, mockWorkflowInstances.length, ...structuredClone(originalInstances));
});

function job(overrides: Partial<WorkflowJob>): WorkflowJob {
  return { ...originalJobs[0], status: 'pending', generation: 2, attempts: 0, maxAttempts: 5,
    runAt: mockDateTimeOffset(-60_000), lockedAt: null, lockedBy: null, leaseUntil: null, executionDeadline: null,
    ...overrides };
}

async function call<Op extends AnyOperation>(operation: Op, input: InputOf<Op>) {
  const { params, query, body } = input as { params?: Record<string, unknown>; query?: Record<string, string | number>; body?: unknown };
  const url = new URL(fillPath(operation.fullPath, params), window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
  for (const handler of workflowHandlers) {
    const request = new Request(url, { method: operation.method.toUpperCase(),
      headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await (handler as unknown as {
      run: (args: unknown) => Promise<{ response?: Response } | null>;
    }).run({ request, requestId: 'workflow-job-test' });
    if (result?.response) return { status: result.response.status, body: await result.response.json() as ApiResponse<OutputOf<Op>> };
  }
  throw new Error(`No handler matched ${operation.method} ${url.pathname}`);
}

describe('workflow job mock contract', () => {
  it('includes lease metadata, generation and paused counts in API responses', async () => {
    mockWorkflowJobs.splice(0, mockWorkflowJobs.length, job({ status: 'paused' }));
    const detail = await call(workflowEngineContract.jobDetail, { params: { id: 9001 } });
    const summary = await call(workflowEngineContract.jobsSummary, {});
    const list = await call(workflowEngineContract.jobs, { query: { status: 'paused' } });

    expect(workflowJobDetailSchema.safeParse(detail.body.data).success).toBe(true);
    expect(detail.body.data).toMatchObject({ generation: 2, leaseUntil: null, executionDeadline: null, executionTimeoutMs: 600_000 });
    expect(detail.body.data.executions[0].generation).toBe(0);
    const total = summary.body.data.find((item) => item.jobType === 'webhook_delivery');
    expect(workflowJobSummaryItemSchema.safeParse(total).success).toBe(true);
    expect(total).toMatchObject({ total: 1, paused: 1 });
    expect(list.body.data.list).toHaveLength(1);
  });

  it('reconciles only expired ownership and submits wakeups without completing jobs', async () => {
    const active = job({ id: 1, status: 'running', lockedAt: mockDateTimeOffset(-3600_000),
      leaseUntil: mockDateTimeOffset(60_000), executionDeadline: mockDateTimeOffset(600_000) });
    const expired = job({ id: 2, status: 'running', attempts: 2, leaseUntil: mockDateTimeOffset(-60_000) });
    const exhausted = job({ id: 3, status: 'running', attempts: 5, leaseUntil: mockDateTimeOffset(60_000), executionDeadline: mockDateTimeOffset(-60_000) });
    const paused = job({ id: 4, status: 'paused' });
    mockWorkflowJobs.splice(0, mockWorkflowJobs.length, active, expired, exhausted, paused);
    const input = { params: { action: 'recover-webhooks' as const }, body: { limit: 20 } };

    const preview = await call(workflowEngineContract.previewAction, input);
    const runtime = await call(workflowEngineContract.jobRuntimeStatus, {});
    const result = await call(workflowEngineContract.runAction, input);

    expect(preview.body.data).toMatchObject({ duePending: 0, stuckRunning: 2 });
    expect(runtime.body.data.stuckRunningJobs).toBe(2);
    expect(result.body.data.detail).toEqual({ recovered: 2, requeued: 1, dead: 1 });
    expect(result.body.data.message).toContain('已提交补投');
    expect(active.status).toBe('running');
    expect(expired).toMatchObject({ status: 'pending', attempts: 2, generation: 2, leaseUntil: null, executionDeadline: null });
    expect(exhausted.status).toBe('dead');
    expect(paused.status).toBe('paused');
    const repeated = await call(workflowEngineContract.runAction, input);
    expect(repeated.body.data.detail).toEqual({ recovered: 0, requeued: 1, dead: 0 });
    expect(expired.generation).toBe(2);
  });

  it('dead-letters an expired unsafe external effect whose result is unknown', async () => {
    const uncertain = job({ id: 9001, status: 'running', attempts: 1,
      leaseUntil: mockDateTimeOffset(-60_000), lockedBy: 'worker:1' });
    const execution = structuredClone(originalExecutions.find((entry) => entry.jobId === uncertain.id)!);
    Object.assign(execution, { status: 'running', requestMethod: 'POST', responseStatus: null, finishedAt: null });
    mockWorkflowJobs.splice(0, mockWorkflowJobs.length, uncertain);
    mockWorkflowJobExecutions.splice(0, mockWorkflowJobExecutions.length, execution);

    const result = await call(workflowEngineContract.runAction, {
      params: { action: 'recover-webhooks' }, body: { limit: 20 },
    });

    expect(result.body.data.detail).toEqual({ recovered: 1, requeued: 0, dead: 1 });
    expect(uncertain).toMatchObject({ status: 'dead', lockedBy: null, leaseUntil: null });
    expect(uncertain.lastError).toContain('外部操作结果待确认');
  });

  it('starts a new generation on manual retry without rewriting historical executions', async () => {
    const previous = structuredClone(mockWorkflowJobExecutions.filter((entry) => entry.jobId === 9001));
    mockWorkflowJobs.splice(0, mockWorkflowJobs.length, job({ status: 'dead', attempts: 5, generation: 4 }));

    const result = await call(workflowEngineContract.retryJob, { params: { id: 9001 }, body: {} });

    expect(result.body.data).toMatchObject({ status: 'pending', generation: 5, attempts: 0, leaseUntil: null, executionDeadline: null });
    expect(mockWorkflowJobExecutions.filter((entry) => entry.jobId === 9001)).toEqual(previous);
  });

  it.each(['running', 'paused'] as const)('cancels %s work and invalidates its generation', async (status) => {
    mockWorkflowJobs.splice(0, mockWorkflowJobs.length, job({ status, leaseUntil: mockDateTimeOffset(60_000) }));
    const result = await call(workflowEngineContract.skipJob, { params: { id: 9001 } });
    expect(result.body.data).toMatchObject({ status: 'canceled', generation: 3, leaseUntil: null });
  });

  it('requires instance resume for paused jobs instead of accepting manual retry', async () => {
    mockWorkflowJobs.splice(0, mockWorkflowJobs.length, job({ status: 'paused' }));
    const result = await call(workflowEngineContract.retryJob, { params: { id: 9001 }, body: {} });
    expect(result.status).toBe(400);
    expect(mockWorkflowJobs[0]).toMatchObject({ status: 'paused', generation: 2 });
  });

  it('freezes timer jobs on instance suspension and restores the remaining delay on resume', async () => {
    const now = Math.floor(Date.now() / 1000) * 1000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const instance = mockWorkflowInstances.find((item) => item.status === 'running')!;
    const timer = job({ jobType: 'delay_wake', instanceId: instance.id, status: 'running', attempts: 2,
      lockedBy: 'worker:1', runAt: mockDateTimeOffset(60_000) });
    const delivery = job({ id: 9002, instanceId: instance.id, jobType: 'webhook_delivery' });
    const pendingTimer = job({ id: 9003, jobType: 'task_timeout', instanceId: instance.id,
      status: 'pending', attempts: 2, runAt: mockDateTimeOffset(30_000) });
    const pendingTrigger = job({ id: 9004, jobType: 'trigger_dispatch', instanceId: instance.id, status: 'pending' });
    const unsafeExternal = job({ id: 9005, jobType: 'external_dispatch', instanceId: instance.id,
      status: 'running', attempts: 1, lockedBy: 'worker:2' });
    const unsafeExecution = structuredClone(originalExecutions[0]);
    Object.assign(unsafeExecution, { id: 9905, jobId: unsafeExternal.id, status: 'running',
      requestMethod: 'POST', responseStatus: null, finishedAt: null });
    mockWorkflowJobs.splice(0, mockWorkflowJobs.length, timer, delivery, pendingTimer, pendingTrigger, unsafeExternal);
    mockWorkflowJobExecutions.push(unsafeExecution);

    await call(workflowInstanceOpsContract.suspend, { params: { id: instance.id }, body: { reason: 'maintenance' } });
    expect(timer).toMatchObject({ status: 'paused', generation: 3, attempts: 1, lockedBy: null });
    expect(pendingTimer).toMatchObject({ status: 'paused', generation: 3, attempts: 2 });
    expect(pendingTrigger.status).toBe('paused');
    expect(unsafeExternal).toMatchObject({ status: 'dead', generation: 3, lockedBy: null });
    expect(unsafeExternal.lastError).toContain('外部操作结果待确认');
    expect(delivery.status).toBe('pending');
    vi.setSystemTime(now + 120_000);
    await call(workflowInstanceOpsContract.resume, { params: { id: instance.id } });

    expect(timer).toMatchObject({ status: 'pending', generation: 4, attempts: 1 });
    expect(pendingTimer).toMatchObject({ status: 'pending', generation: 4, attempts: 2 });
    expect(pendingTrigger.status).toBe('pending');
    expect(unsafeExternal.status).toBe('dead');
    expect(new Date(timer.runAt).getTime()).toBe(now + 180_000);
  });

  it('cancels only advancing jobs when an instance is canceled', async () => {
    const instance = mockWorkflowInstances.find((item) => item.status === 'running')!;
    const advancing = job({ id: 1, instanceId: instance.id, jobType: 'external_dispatch', status: 'running', lockedBy: 'worker:1' });
    const trigger = job({ id: 2, instanceId: instance.id, jobType: 'trigger_dispatch' });
    const delivery = job({ id: 3, instanceId: instance.id, jobType: 'webhook_delivery' });
    mockWorkflowJobs.splice(0, mockWorkflowJobs.length, advancing, trigger, delivery);

    await call(workflowInstanceContract.cancel, { params: { id: instance.id } });

    expect(advancing).toMatchObject({ status: 'canceled', generation: 3, lockedBy: null });
    expect(trigger.status).toBe('pending');
    expect(delivery.status).toBe('pending');
  });
});
