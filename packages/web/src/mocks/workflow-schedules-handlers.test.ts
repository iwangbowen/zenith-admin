import { afterEach, describe, expect, it } from 'vitest';
import { fillPath, type AnyOperation, type ApiResponse, type InputOf, type OutputOf } from '@zenith/shared/core';
import { workflowScheduleContract, workflowScheduleRunDetailSchema } from '@zenith/shared/workflow';
import { mockSchedules, mockScheduleRuns, workflowExtraHandlers } from './handlers/workflow-extra';
import { mockWorkflowDefinitions, mockWorkflowInstances, mockWorkflowTasks } from './data/workflow';

const definitions = structuredClone(mockWorkflowDefinitions);
const instances = structuredClone(mockWorkflowInstances);
const tasks = structuredClone(mockWorkflowTasks);
afterEach(() => {
  mockSchedules.splice(0); mockScheduleRuns.splice(0);
  mockWorkflowDefinitions.splice(0, mockWorkflowDefinitions.length, ...structuredClone(definitions));
  mockWorkflowInstances.splice(0, mockWorkflowInstances.length, ...structuredClone(instances));
  mockWorkflowTasks.splice(0, mockWorkflowTasks.length, ...structuredClone(tasks));
});

async function call<Op extends AnyOperation>(operation: Op, input: InputOf<Op>) {
  const { params, body, query } = input as { params?: Record<string, unknown>; body?: unknown; query?: Record<string, unknown> };
  const url = new URL(fillPath(operation.fullPath, params), window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
  for (const handler of workflowExtraHandlers) {
    const request = new Request(url, { method: operation.method.toUpperCase(), headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await (handler as unknown as { run: (args: unknown) => Promise<{ response?: Response } | null> }).run({ request, requestId: 'schedule-ledger-test' });
    if (result?.response) return { status: result.response.status, body: await result.response.json() as ApiResponse<OutputOf<Op>> };
  }
  throw new Error('No schedule handler matched');
}

async function seed() {
  const definition = mockWorkflowDefinitions.find((d) => d.status === 'published' && d.formType !== 'external')!;
  const result = await call(workflowScheduleContract.create, { body: { name: '测试月度费用', definitionId: definition.id,
    cronExpression: '0 9 1 * *', initiatorId: 1, formData: { period: '2026-10', amount: 100 }, status: 'enabled' } });
  return result.body.data;
}

describe('schedule Demo occurrence contract', () => {
  it('queues a manual occurrence without interpreting the previous result and then exposes its instance and attempts', async () => {
    const rule = await seed();
    mockSchedules[0].lastRunStatus = 'fail';
    const next = rule.nextRunAt;
    const queued = await call(workflowScheduleContract.run, { params: { id: rule.id } });
    expect(queued.body.data.lastRunStatus).toBe('fail');
    expect(queued.body.data.nextRunAt).toBe(next);
    expect(mockScheduleRuns[0].status).toBe('pending');
    const result = await call(workflowScheduleContract.runs, { params: { id: rule.id }, query: {} });
    const run = result.body.data.list[0];
    expect(run).toMatchObject({ status: 'succeeded', attempts: 1, trigger: 'manual' });
    expect(run.instanceId).not.toBeNull();
    const detail = await call(workflowScheduleContract.runDetail, { params: { id: rule.id, jobId: run.id } });
    expect(workflowScheduleRunDetailSchema.safeParse(detail.body.data).success).toBe(true);
    expect(detail.body.data.executions).toHaveLength(1);
    expect((await call(workflowScheduleContract.retryRun, { params: { id: rule.id, jobId: run.id } })).status).toBe(400);
  });

  it('replay keeps frozen input/history after rule edits and retains the same created instance', async () => {
    const rule = await seed();
    await call(workflowScheduleContract.run, { params: { id: rule.id } });
    await call(workflowScheduleContract.runs, { params: { id: rule.id }, query: {} });
    const run = mockScheduleRuns[0]; const instanceId = run.instanceId; const payload = structuredClone(run.payload);
    const originalNext = rule.nextRunAt;
    await call(workflowScheduleContract.update, { params: { id: rule.id }, body: { name: '新名称', formData: { amount: 999 } } });
    expect(mockSchedules[0].nextRunAt).toBe(originalNext);
    run.status = 'canceled';
    await call(workflowScheduleContract.retryRun, { params: { id: rule.id, jobId: run.id } });
    expect(run.payload).toEqual(payload);
    expect(run.executions).toHaveLength(1);
    await call(workflowScheduleContract.runDetail, { params: { id: rule.id, jobId: run.id } });
    expect(run.instanceId).toBe(instanceId);
    expect(run.executions).toHaveLength(2);
    expect(run.generation).toBe(1);
  });
});
