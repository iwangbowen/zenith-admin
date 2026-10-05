import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowScheduleLaunchPayload } from '@zenith/shared/workflow';
import type { WorkflowJobContext } from '../types';
import { WorkflowJobLeaseLostError, WorkflowJobPermanentError } from '../errors';

const model = vi.hoisted(() => ({
  create: vi.fn(), select: vi.fn(), directUpdate: vi.fn(), transaction: vi.fn(),
  receipt: vi.fn(), changes: [] as Record<string, unknown>[], owned: true, failSummary: false,
}));
vi.mock('../../../db', () => ({ db: { select: model.select, update: model.directUpdate } }));
vi.mock('../../../services/workflow/workflow-instances.service', () => ({ createInstance: model.create }));
vi.mock('../registry', () => ({ registerJobHandler: vi.fn() }));
vi.mock('../steps', () => ({ readWorkflowJobStepResult: model.receipt }));
vi.mock('../lease', () => ({ withWorkflowJobTransaction: model.transaction }));

import { handleScheduleLaunch, parseScheduleLaunchPayload } from './schedule-launch';

const payload: WorkflowScheduleLaunchPayload = { scheduleId: 2, definitionId: 6, initiatorId: 4,
  title: '十月补货 2026-10-01', scheduledAt: '2026-10-01T01:00:00.000Z', trigger: 'scheduled',
  formData: { quantity: 12, period: '2026-10' } };
function context(): WorkflowJobContext {
  return { job: { id: 25, tenantId: 7, maxAttempts: 5 }, payload: structuredClone(payload), attempt: 1,
    generation: 0, signal: new AbortController().signal } as WorkflowJobContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  model.changes = []; model.owned = true; model.failSummary = false;
  model.receipt.mockResolvedValue(undefined);
  model.select.mockImplementation(() => ({ from: () => ({ where: () => ({ limit: async () => [{ username: 'warehouse', status: 'enabled' }] }) }) }));
  model.directUpdate.mockImplementation(() => { throw new Error('unfenced summary write'); });
  model.create.mockResolvedValue({ id: 31 });
  model.transaction.mockImplementation(async (ctx, callback) => {
    ctx.signal.throwIfAborted();
    if (!model.owned) throw new WorkflowJobLeaseLostError();
    return callback({ update: () => ({ set: (change: Record<string, unknown>) => ({ where: async () => {
      if (model.failSummary) throw new Error('summary unavailable');
      model.changes.push(change);
    } }) }) });
  });
});

describe('schedule occurrence execution', () => {
  it('rejects a disabled initiator before creating a new instance', async () => {
    model.select.mockImplementation(() => ({ from: () => ({ where: () => ({ limit: async () => [{ username: 'warehouse', status: 'disabled' }] }) }) }));
    await expect(handleScheduleLaunch(context())).rejects.toThrow('发起人已停用');
    expect(model.create).not.toHaveBeenCalled();
    expect(model.changes[0]).toMatchObject({ lastRunStatus: 'fail' });
  });
  it('launches the original frozen input and records an instance result', async () => {
    const result = await handleScheduleLaunch(context());
    expect(model.create).toHaveBeenCalledWith({ definitionId: 6, title: payload.title, formData: payload.formData },
      { userId: 4, username: 'warehouse', tenantId: 7, roles: [] }, [], 'schedule-launch');
    expect(result.result).toMatchObject({ instanceId: 31, scheduledAt: payload.scheduledAt, scheduleId: 2 });
    expect(model.changes).toMatchObject([{ lastRunStatus: 'success' }]);
    expect(model.directUpdate).not.toHaveBeenCalled();
  });

  it('throws business failure to the ledger so the same occurrence can retry', async () => {
    model.create.mockRejectedValue(new Error('流程定义未发布'));
    await expect(handleScheduleLaunch(context())).rejects.toThrow('流程定义未发布');
    expect(model.changes[0]).toMatchObject({ lastRunStatus: 'fail' });
    expect(model.changes[0].lastRunMessage).toContain('流程定义未发布');
    expect(model.directUpdate).not.toHaveBeenCalled();
  });

  it('recovers a committed launch receipt before mutable user checks, without another instance or events', async () => {
    model.receipt.mockResolvedValue({ instanceId: 31 });
    model.select.mockImplementation(() => { throw new Error('user has since been removed'); });
    const result = await handleScheduleLaunch({ ...context(), attempt: 2, generation: 1 });
    expect(result.result).toMatchObject({ instanceId: 31, scheduledAt: payload.scheduledAt });
    expect(model.select).not.toHaveBeenCalled();
    expect(model.create).not.toHaveBeenCalled();
    expect(model.changes).toMatchObject([{ lastRunStatus: 'success' }]);
  });

  it('a stale owner cannot write success or failure metadata after losing its lease', async () => {
    model.owned = false;
    await expect(handleScheduleLaunch(context())).rejects.toBeInstanceOf(WorkflowJobLeaseLostError);
    expect(model.changes).toEqual([]);
    expect(model.transaction).toHaveBeenCalledTimes(1);
    expect(model.directUpdate).not.toHaveBeenCalled();
  });

  it('does not overwrite metadata when cancellation interrupts the launch', async () => {
    const controller = new AbortController();
    const ctx = { ...context(), signal: controller.signal };
    model.create.mockImplementation(async () => { controller.abort(new WorkflowJobLeaseLostError()); throw controller.signal.reason; });
    await expect(handleScheduleLaunch(ctx)).rejects.toBeInstanceOf(WorkflowJobLeaseLostError);
    expect(model.transaction).not.toHaveBeenCalled();
    expect(model.changes).toEqual([]);
  });

  it('a committed launch remains reusable when the summary update failed', async () => {
    model.failSummary = true;
    model.create.mockImplementation(async () => { model.receipt.mockResolvedValue({ instanceId: 31 }); return { id: 31 }; });
    await expect(handleScheduleLaunch(context())).rejects.toThrow('summary unavailable');
    model.failSummary = false;
    const retried = await handleScheduleLaunch({ ...context(), attempt: 2 });
    expect(retried.result?.instanceId).toBe(31);
    expect(model.create).toHaveBeenCalledTimes(1);
  });

  it.each([{ ...payload, scheduleId: 0 }, { ...payload, scheduledAt: 'bad' }, { ...payload, formData: [] }, { ...payload, trigger: 'invalid' }])('malformed internal payload is permanent: %j', (input) => {
    expect(() => parseScheduleLaunchPayload(input)).toThrow(WorkflowJobPermanentError);
    expect(model.create).not.toHaveBeenCalled();
  });
});
