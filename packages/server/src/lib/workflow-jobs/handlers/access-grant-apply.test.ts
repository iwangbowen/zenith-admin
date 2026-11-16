import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskRunContext, TaskHandlerRegistration } from '../../task-center/types';
import type { AsyncTaskRow } from '../../../db/schema';
import type { DbTransaction } from '../../../db/types';

const mocks = vi.hoisted(() => ({ handler: undefined as TaskHandlerRegistration | undefined, apply: vi.fn(), set: vi.fn(), where: vi.fn() }));
vi.mock('../../task-center/registry', () => ({ registerTaskHandler: (handler: TaskHandlerRegistration) => { if (handler.taskType === 'identity-access-grant-apply') mocks.handler = handler; } }));
vi.mock('../../../services/identity/access-governance.service', () => ({ applyApprovedAccessRequest: mocks.apply }));
vi.mock('../../../db', () => ({ db: {} }));
import { registerAccessTaskHandlers } from '../../../services/identity/access-tasks';
registerAccessTaskHandlers();

const context = { taskId: 88, tenantId: 3, payload: { requestId: 77, workflowInstanceId: 41, approvedBy: 12 } } as unknown as TaskRunContext;
beforeEach(() => { vi.clearAllMocks(); mocks.set.mockReturnValue({ where: mocks.where }); mocks.where.mockResolvedValue(undefined); });

describe('durable access grant issuance', () => {
  it('supplies the trusted tenant, workflow and approval identity to the domain service', async () => {
    mocks.apply.mockResolvedValue({ id: 91 });
    await expect(mocks.handler!.run(context)).resolves.toEqual({ requestId: 77, grantId: 91 });
    expect(mocks.apply).toHaveBeenCalledWith(77, { workflowInstanceId: 41, tenantId: 3, approvedBy: 12 });
  });

  it('records an actionable failure and rethrows so the worker retries instead of reporting success', async () => {
    mocks.apply.mockRejectedValue(new Error('issuance unavailable'));
    await expect(mocks.handler!.run(context)).rejects.toThrow('issuance unavailable');
    await mocks.handler!.settleInTransaction!({ update: () => ({ set: mocks.set }) } as unknown as DbTransaction, { id: 88, payload: context.payload, status: 'failed', tenantId: 3, errorMessage: 'Failed query: insert into identity_access_grants params: private-data' } as AsyncTaskRow);
    expect(mocks.set).toHaveBeenCalledWith({ provisionStatus: 'failed', failureReason: '授权发放执行失败，请联系权限治理人员查看任务 #88 并重试' });
  });

  it('rejects malformed durable payloads before any privilege change', async () => {
    await expect(mocks.handler!.run({ ...context, payload: { requestId: -1 } })).rejects.toThrow('有效申请关联');
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('keeps prior infrastructure diagnostics private when an issuance task is cancelled', async () => {
    await mocks.handler!.settleInTransaction!({ update: () => ({ set: mocks.set }) } as unknown as DbTransaction, { id: 88, payload: context.payload, status: 'cancelled', tenantId: 3, errorMessage: 'Failed query: private-data' } as AsyncTaskRow);
    expect(mocks.set).toHaveBeenCalledWith({ provisionStatus: 'terminated', failureReason: '授权发放已终止，请联系权限治理人员查看任务 #88' });
  });
});
