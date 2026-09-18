import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  transaction: vi.fn(), insert: vi.fn(), select: vi.fn(), update: vi.fn(),
  user: { userId: 12, username: 'finance', tenantId: null },
  requireCase: vi.fn(), postJournal: vi.fn(), startWorkflow: vi.fn(), notify: vi.fn(),
}));
vi.mock('../../db', () => ({ db: { select: mocks.select, insert: mocks.insert, update: mocks.update, transaction: mocks.transaction } }));
vi.mock('../../lib/context', () => ({ currentUser: () => mocks.user, hasPermission: async () => true }));
vi.mock('../../lib/tenant', () => ({ tenantCondition: () => undefined, exactTenantCondition: () => undefined }));
vi.mock('../../lib/settings', () => ({ getSettings: async () => ({ reconApprovalDefinitionId: null }) }));
vi.mock('../../lib/workflow-biz-bridge', () => ({ onWorkflowResult: vi.fn(), startWorkflowForBiz: mocks.startWorkflow }));
vi.mock('../workflow/workflow-business-context.service', () => ({ getBusinessWorkflowContext: vi.fn(), previewBusinessWorkflow: vi.fn(), requireBusinessApprovalInstance: vi.fn() }));
vi.mock('./payment-journal.service', () => ({ postSystemJournalWithin: mocks.postJournal }));
vi.mock('../messaging/notification-outbox.service', () => ({ notifyWithin: mocks.notify }));
vi.mock('./payment-recon-common', () => ({ requireReconCase: mocks.requireCase, assertReconWriteScope: vi.fn(), reconJson: (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? String(item) : item)), reconNotificationPolicy: async () => ({ settings: {}, recipients: [] }) }));

import { createReconAdjustment, executeReconAdjustment, reverseReconAdjustment, submitReconAdjustment } from './payment-recon-adjustment.service';

const stamp = new Date('2026-09-18T00:00:00Z');
const adjustment = () => ({ id: 9, caseId: 4, caseVersion: 1, applicationId: 3, channelConfigId: 2, amount: 25n, direction: 'in', reason: '复核真实渠道差额', evidence: {}, status: 'draft', workflowInstanceId: null, journalId: null, reversalOfId: null, applicantId: 12, approverId: null, approvedAt: null, executedAt: null, tenantId: null, createdAt: stamp, updatedAt: stamp, createdBy: 12, updatedBy: 12 });

beforeEach(() => {
  vi.clearAllMocks(); mocks.rows = [];
  const executor = { select: mocks.select, insert: mocks.insert, update: mocks.update };
  mocks.transaction.mockImplementation(async (work: (tx: typeof executor) => unknown) => work(executor));
  mocks.select.mockImplementation(() => {
    const query = { from: vi.fn(), where: vi.fn(), for: vi.fn(), limit: vi.fn(), orderBy: vi.fn() };
    query.from.mockReturnValue(query); query.where.mockReturnValue(query); query.for.mockReturnValue(query);
    query.limit.mockImplementation(async () => mocks.rows.shift() ?? []);
    query.orderBy.mockImplementation(async () => mocks.rows.shift() ?? []);
    return query;
  });
});

describe('payment adjustment service mutation boundaries', () => {
  it('never creates money records from an unallocated channel-only case', async () => {
    const record = { id: 4, tenantId: null, applicationId: null, status: 'open', type: 'channel_only', localAmount: null, channelAmount: 25n };
    mocks.requireCase.mockResolvedValue(record); mocks.rows = [[{ periodId: 2 }], [{ id: 2 }], [record]];
    await expect(createReconAdjustment(4, { applicationId: 3, channelConfigId: 2, amount: '25', direction: 'in', reason: 'test' })).rejects.toThrow('明确本地归属');
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.postJournal).not.toHaveBeenCalled();
  });
  it('refuses submission on behalf of another applicant before starting a workflow', async () => {
    mocks.rows = [[{ ...adjustment(), applicantId: 99 }]];
    await expect(submitReconAdjustment(9, { definitionId: 3 })).rejects.toThrow('申请人本人');
    expect(mocks.startWorkflow).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it('replays an executed adjustment without posting another journal', async () => {
    const executed = { ...adjustment(), status: 'executed', journalId: 88, approverId: 13, executedAt: stamp };
    mocks.rows = [[executed], [executed]];
    const result = await executeReconAdjustment(9);
    expect(result.journalId).toBe(88); expect(result.amount).toBe('25');
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.postJournal).not.toHaveBeenCalled();
  });
  it('cannot reverse an unexecuted adjustment or create a direct money reversal', async () => {
    const draft = adjustment();
    mocks.rows = [[draft], [{ periodId: 2 }], [{ id: 2 }], [{ id: 4, tenantId: null }], [draft]];
    await expect(reverseReconAdjustment(9, { reason: 'test reversal' })).rejects.toThrow('已执行的原始调整');
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.postJournal).not.toHaveBeenCalled();
  });
});
