import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../../db/types';
import type { AsyncTaskRow } from '../../db/schema';
const state = vi.hoisted(() => ({ retain: vi.fn(), remember: vi.fn() }));
vi.mock('../files/file-gc.service', () => ({ retainManagedFiles: state.retain, releaseManagedFiles: vi.fn() }));
vi.mock('../../lib/transaction-effects', () => ({ rememberTransactionEffect: state.remember, flushTransactionEffects: vi.fn() }));
import { settleExportTask } from './export-jobs.service';
import { registerExport, defineExport } from '../../lib/export-center/registry';
registerExport(defineExport({ entity: 'test.settle', moduleName: 'Test', filenamePrefix: 'Test', columns: [], permissions: { export: 'test' }, countRows: async () => 0, streamRows: async () => [] }));
function transaction(job: Record<string, unknown>) {
  const set = vi.fn();
  const tx = { select: () => ({ from: () => ({ where: () => ({ for: () => ({ limit: async () => [job] }) }) }) }), update: () => ({ set: (values: unknown) => { set(values); return { where: async () => [] }; } }) } as unknown as DbTransaction;
  return { tx, set };
}
beforeEach(() => vi.clearAllMocks());
describe('export task transactional settlement', () => {
  it('retains the artifact and completes the domain in the terminal transaction', async () => {
    const { tx, set } = transaction({ id: 1, entity: 'test.settle', status: 'running', raw: false, sensitive: false });
    await settleExportTask(tx, { id: 2, status: 'success', completedAt: new Date(), result: { fileId: 'file', filename: 'result.csv', fileSize: 12, rowCount: 3, sha256: 'hash' } } as unknown as AsyncTaskRow);
    expect(state.retain).toHaveBeenCalledWith(tx, ['file']);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', processedRows: 3, rowCount: 3, stage: 'completed', sha256: 'hash' }));
    expect(set.mock.calls[0][0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
  it('keeps cancellation visible and prevents it from becoming success', async () => {
    const { tx, set } = transaction({ id: 1, entity: 'test.settle', status: 'running' });
    await settleExportTask(tx, { id: 2, status: 'cancelled', cancelRequested: true, completedAt: new Date(), errorMessage: null } as AsyncTaskRow);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', stage: 'cancelled', cancelRequested: true }));
    expect(state.retain).not.toHaveBeenCalled();
  });
  it('mirrors automatic retries without publishing an artifact', async () => {
    const { tx, set } = transaction({ id: 1, entity: 'test.settle', status: 'running' });
    await settleExportTask(tx, { id: 2, status: 'pending', cancelRequested: false, dispatchToken: 'new-round', startedAt: new Date(), errorMessage: 'temporary' } as AsyncTaskRow);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', executionToken: 'new-round', errorMessage: 'temporary' }));
    expect(state.retain).not.toHaveBeenCalled();
  });
});

