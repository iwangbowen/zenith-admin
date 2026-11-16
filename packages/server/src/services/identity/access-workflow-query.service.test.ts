import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), grant: vi.fn(), viewer: vi.fn(), workflow: vi.fn(), permission: vi.fn() }));
vi.mock('../../db', () => ({ db: { query: { identityAccessRequests: { findFirst: mocks.request }, identityAccessGrants: { findFirst: mocks.grant } } } }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 9, tenantId: 3, roles: [] }), hasPermission: mocks.permission }));
vi.mock('../workflow/public/access-approval', () => ({ requireAccessWorkflowViewer: mocks.viewer, getAccessBusinessWorkflow: mocks.workflow }));
vi.mock('./access-formatters', () => ({ formatAccessRequest: (row: unknown) => row, formatAccessGrant: (row: unknown) => row }));
import { getAccessWorkflowResult, getGovernanceRequestWorkflow } from './access-workflow-query.service';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ id: 7, workflowInstanceId: 41, tenantId: 3, provisionStatus: 'succeeded' });
  mocks.grant.mockResolvedValue({ id: 8, items: [{ id: 1, status: 'revoked' }] });
  mocks.permission.mockResolvedValue(false);
  mocks.viewer.mockResolvedValue({ id: 41 });
});

describe('access workflow live result', () => {
  it('authorizes the exact workflow/business pair before reading live grants', async () => {
    const result = await getAccessWorkflowResult(41);
    expect(mocks.viewer).toHaveBeenCalledWith(41, 'identity.access_request', '7');
    expect(result.grant?.items[0].status).toBe('revoked');
    expect(mocks.request.mock.calls[0][0].where).toBeDefined();
    expect(mocks.grant.mock.calls[0][0].where).toBeDefined();
  });
  it('does not expose grants to a nonparticipant', async () => {
    mocks.viewer.mockRejectedValue(Object.assign(new Error('无权查看'), { status: 403 }));
    await expect(getAccessWorkflowResult(41)).rejects.toMatchObject({ status: 403 });
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it('allows an authorized governance reader without granting workflow monitoring', async () => {
    mocks.permission.mockResolvedValue(true);
    await getAccessWorkflowResult(41);
    expect(mocks.viewer).not.toHaveBeenCalled();
    expect(mocks.grant).toHaveBeenCalledOnce();
  });
  it('keeps unissued approval distinct from an existing grant', async () => {
    mocks.request.mockResolvedValue({ id: 7, workflowInstanceId: 41, provisionStatus: 'failed', failureReason: '发放失败' });
    mocks.grant.mockResolvedValue(undefined);
    expect(await getAccessWorkflowResult(41)).toMatchObject({ request: { provisionStatus: 'failed' }, grant: null });
  });
  it('rejects a missing or tenant-invisible business record before workflow access', async () => {
    mocks.request.mockResolvedValue(undefined);
    await expect(getAccessWorkflowResult(41)).rejects.toMatchObject({ status: 404 });
    expect(mocks.viewer).not.toHaveBeenCalled();
  });
  it('loads governance read-only workflow using the server-owned business reference', async () => {
    mocks.workflow.mockResolvedValue({ id: 41, bizType: 'identity.access_request', bizId: '7' });
    await expect(getGovernanceRequestWorkflow(7)).resolves.toMatchObject({ id: 41 });
    expect(mocks.workflow).toHaveBeenCalledWith(41, 'identity.access_request', '7');
  });
});
