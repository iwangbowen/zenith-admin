import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { WorkflowEvent } from '@zenith/shared/workflow';
import type { DbTransaction } from '../../db/types';
import type { WorkflowJobContext } from '../../lib/workflow-jobs/types';
import { workflowAutomations, workflowInstances, workflowJobEffects, users, type WorkflowJobRow } from '../../db/schema';

const model = vi.hoisted(() => ({ db: {} as object, transaction: vi.fn(), enqueue: vi.fn(), create: vi.fn(),
  notify: vi.fn(), http: vi.fn(), context: undefined as WorkflowJobContext | undefined,
  failReceipt: undefined as string | undefined, launchAvailable: true }));
vi.mock('../../db', () => ({ db: model.db }));
vi.mock('../../lib/workflow-jobs/lease', () => ({
  currentWorkflowJobContext: () => model.context,
  workflowTransaction: model.transaction,
  withWorkflowJobTransaction: (_ctx: WorkflowJobContext, fn: (tx: DbTransaction) => Promise<unknown>) => model.transaction(fn),
}));
vi.mock('../../lib/workflow-jobs/engine', () => ({ enqueueJob: model.enqueue }));
vi.mock('./workflow-instances.service', () => ({ createInstance: model.create }));
vi.mock('./workflow-attachments.service', () => ({ bindWorkflowFormAttachments: async (_tx: unknown, _instance: unknown, _snapshot: unknown, data: unknown) => data }));
vi.mock('../messaging/notification-outbox.service', () => ({ notifyWithin: model.notify }));
vi.mock('../../lib/workflow-outbound', () => ({
  renderUrlTemplate: (tpl: string, get: (key: string) => unknown) => tpl.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(get(key) ?? '')),
  workflowHttp: model.http,
}));
import { readWorkflowJobStepResult, runWorkflowJobStep } from '../../lib/workflow-jobs/steps';
import { enqueueWorkflowAutomationsForEvent, executeWorkflowAutomationAction, settleWorkflowAutomationAction } from './workflow-automation-runtime';

interface Receipt { jobId: number; operationKey: string; effectKey: string; result: Record<string, unknown> }
interface State { receipts: Receipt[]; jobs: WorkflowJobRow[]; instance: { id: number; formData: Record<string, unknown>; formSnapshot: null }; launches: number[]; notifications: number[] }
let state: State;
let rules: Array<{ id: number; name: string; actions: Array<Record<string, unknown>> }>;
const dialect = new PgDialect();
const event = () => ({ type: 'instance.approved', eventId: 'event-approved-7', tenantId: null, instanceId: 7, definitionId: 3,
  instance: { id: 7, definitionId: 3, title: '采购通过', status: 'approved', initiatorId: 9, tenantId: null, formData: { note: '原始值' } } }) as WorkflowEvent;

function executor(staged: State) {
  return {
    _state: staged,
    select: () => {
      let table: unknown; let params: unknown[] = [];
      const rows = () => table === workflowJobEffects
        ? staged.receipts.filter((r) => r.operationKey === params[0] && (params.length < 2 || r.effectKey === params[1]))
        : table === workflowAutomations ? rules : table === users ? [{ nickname: '采购经办', username: 'buyer' }] : [staged.instance];
      const q = { from: (t: unknown) => { table = t; return q; }, where: (predicate: SQL) => { params = dialect.sqlToQuery(predicate).params; return q; },
        orderBy: () => q, for: () => q, limit: async (n: number) => rows().slice(0, n),
        then: (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(rows()).then(resolve, reject) };
      return q;
    },
    insert: () => ({ values: async (receipt: Receipt) => {
      if (model.failReceipt === receipt.effectKey) { model.failReceipt = undefined; throw new Error('receipt commit failed'); }
      staged.receipts.push(structuredClone(receipt));
    } }),
    update: (table: unknown) => ({ set: (patch: Record<string, unknown>) => ({ where: async () => {
      if (table === workflowInstances) Object.assign(staged.instance, structuredClone(patch));
    } }) }),
  } as unknown as DbTransaction;
}
function actionJob(job: WorkflowJobRow, attempt = 1) {
  model.context = { job, payload: job.payload, operationKey: job.operationKey, attempt, generation: 0,
    executionId: job.id, leaseToken: 'owned', signal: new AbortController().signal } as WorkflowJobContext;
  return model.context;
}
async function seed(actions: Array<Record<string, unknown>>) {
  rules[0].actions = actions;
  await enqueueWorkflowAutomationsForEvent(event());
  return state.jobs[0];
}

beforeEach(() => {
  vi.clearAllMocks(); model.failReceipt = undefined; model.launchAvailable = true;
  state = { receipts: [], jobs: [], instance: { id: 7, formData: { note: '原始值' }, formSnapshot: null }, launches: [], notifications: [] };
  rules = [{ id: 2, name: '采购后续', actions: [] }];
  model.context = { job: { id: 99 }, operationKey: 'event-operation' } as WorkflowJobContext;
  model.transaction.mockImplementation(async (fn) => {
    const staged = structuredClone(state); const result = await fn(executor(staged)); state = staged; return result;
  });
  Object.assign(model.db, { select: (...args: unknown[]) => (executor(state).select as (...args: unknown[]) => unknown)(...args) });
  model.enqueue.mockImplementation(async (input, tx) => {
    const staged = (tx as unknown as { _state: State })._state;
    if (staged.jobs.some((job) => job.idempotencyKey === input.idempotencyKey)) return null;
    const job = { ...structuredClone(input), id: staged.jobs.length + 1, operationKey: `operation-${staged.jobs.length + 1}`,
      status: 'pending', attempts: 0 } as WorkflowJobRow;
    staged.jobs.push(job); return job;
  });
  model.create.mockImplementation(async (_data, _caller, _attachments, stepKey) => {
    const receipt = await readWorkflowJobStepResult<{ instanceId: number }>(stepKey);
    if (receipt) return { id: receipt.instanceId };
    if (!model.launchAvailable) throw new Error('目标未发布');
    const result = await runWorkflowJobStep(stepKey, async (tx) => {
      const staged = (tx as unknown as { _state: State })._state; const id = 100 + staged.launches.length;
      staged.launches.push(id); return { instanceId: id };
    });
    return { id: result.instanceId };
  });
  model.notify.mockImplementation(async (tx) => {
    const staged = (tx as unknown as { _state: State })._state; staged.notifications.push(staged.notifications.length + 1); return staged.notifications.length;
  });
  model.http.mockResolvedValue({ status: 200, ok: true, text: async () => 'accepted' });
});

describe('durable automation actions', () => {
  it('freezes the whole chain and prevents a second chain on event replay or changed live rules', async () => {
    await seed([{ type: 'updateField', fields: { note: '已登记' } }, { type: 'startWorkflow', definitionId: 4, titleTemplate: '{{note}}' }]);
    rules[0].name = '后来改名'; rules[0].actions = [{ type: 'webhook', url: 'https://example.test/changed' }];
    model.context = { job: { id: 99 }, operationKey: 'replayed-event-operation' } as WorkflowJobContext;
    await enqueueWorkflowAutomationsForEvent(event());
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0].payload).toMatchObject({ ruleName: '采购后续', action: { type: 'updateField' }, remainingActions: [{ action: { type: 'startWorkflow' } }] });
  });

  it('passes committed field results to the next frozen input and does not reapply the successful step', async () => {
    const first = await seed([{ type: 'updateField', fields: { note: '已登记' } }, { type: 'startWorkflow', definitionId: 4, titleTemplate: '{{note}}' }]);
    await executeWorkflowAutomationAction(actionJob(first));
    const next = state.jobs[1];
    expect(next.payload).toMatchObject({ context: { formData: { note: '已登记' } } });
    state.instance.formData.note = '后续人工修改';
    await executeWorkflowAutomationAction(actionJob(first, 2));
    expect(state.instance.formData.note).toBe('后续人工修改');
    expect(state.jobs).toHaveLength(2);
    await executeWorkflowAutomationAction(actionJob(next));
    expect(model.create).toHaveBeenLastCalledWith(expect.objectContaining({ title: '已登记' }), expect.any(Object), [], 'automation-start-workflow');
    expect(state.launches).toHaveLength(1);
  });

  it('continues after a failed action and independently recovers it without repeating its successor', async () => {
    model.launchAvailable = false;
    const first = await seed([{ type: 'startWorkflow', definitionId: 4 }, { type: 'updateField', fields: { note: '后继完成' } }]);
    await expect(executeWorkflowAutomationAction(actionJob(first))).rejects.toThrow('目标未发布');
    expect(state.jobs).toHaveLength(2);
    await executeWorkflowAutomationAction(actionJob(state.jobs[1]));
    expect(state.instance.formData.note).toBe('后继完成');
    model.launchAvailable = true;
    await executeWorkflowAutomationAction(actionJob(first, 2));
    model.launchAvailable = false;
    await executeWorkflowAutomationAction(actionJob(first, 3));
    expect(state.launches).toHaveLength(1);
    expect(state.jobs).toHaveLength(2);
  });

  it('does not send a known successful webhook again after continuation persistence fails', async () => {
    const first = await seed([{ type: 'webhook', url: 'https://example.test/erp' }, { type: 'updateField', fields: { note: '已发送' } }]);
    model.failReceipt = 'automation-continuation';
    await expect(executeWorkflowAutomationAction(actionJob(first))).rejects.toThrow('receipt commit failed');
    expect(state.jobs).toHaveLength(1); // Enqueue and its receipt rolled back together.
    await executeWorkflowAutomationAction(actionJob(first, 2));
    expect(model.http).toHaveBeenCalledTimes(1);
    expect(state.jobs).toHaveLength(2);
  });

  it('commits a message once even when the action is retried', async () => {
    const first = await seed([{ type: 'sendMessage', title: '采购登记', content: '{{title}}' }]);
    await executeWorkflowAutomationAction(actionJob(first));
    await executeWorkflowAutomationAction(actionJob(first, 2));
    expect(state.notifications).toHaveLength(1);
  });

  it('recovers the crash-before-finally window using a committed field receipt, only once', async () => {
    const first = await seed([{ type: 'updateField', fields: { note: '已登记' } }, { type: 'startWorkflow', definitionId: 4 }]);
    state.receipts.push({ jobId: first.id, operationKey: first.operationKey, effectKey: 'automation-update-fields', result: { formData: { note: '已登记' } } });
    await model.transaction((tx) => settleWorkflowAutomationAction(tx, { ...first, status: 'dead' }));
    await model.transaction((tx) => settleWorkflowAutomationAction(tx, { ...first, status: 'dead' }));
    expect(state.jobs).toHaveLength(2);
    expect(state.jobs[1].payload).toMatchObject({ context: { formData: { note: '已登记' } } });
    expect(state.launches).toHaveLength(0); // Recovery only enqueues; it never executes external/internal actions.
  });

  it('dead-letters uncertain external work without repeating it while releasing the independent successor', async () => {
    const first = await seed([{ type: 'webhook', url: 'https://example.test/erp' }, { type: 'updateField', fields: { note: '后继' } }]);
    await model.transaction((tx) => settleWorkflowAutomationAction(tx, { ...first, status: 'dead', lastError: '外部操作结果待确认：租约失效' }));
    expect(model.http).not.toHaveBeenCalled();
    expect(state.jobs).toHaveLength(2);
    expect(state.jobs[0].idempotencyKey).toBe(first.idempotencyKey);
  });

  it('does not release an unregistered successor after explicit cancellation', async () => {
    const first = await seed([{ type: 'startWorkflow', definitionId: 4 }, { type: 'webhook', url: 'https://example.test/erp' }]);
    await model.transaction((tx) => settleWorkflowAutomationAction(tx, { ...first, status: 'canceled' }));
    expect(state.jobs).toHaveLength(1);
    expect(model.http).not.toHaveBeenCalled();
  });
});
