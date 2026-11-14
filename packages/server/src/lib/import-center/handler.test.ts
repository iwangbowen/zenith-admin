import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskHandlerRegistration } from '../task-center/types';
import { IMPORT_PREVIEW_TASK_TYPE, IMPORT_TASK_TYPE } from '@zenith/shared/tasks';

const mocks = vi.hoisted(() => ({ register: vi.fn(), insert: vi.fn(), finalize: vi.fn() }));
const files = vi.hoisted(() => ({ retain: vi.fn(), release: vi.fn() }));
vi.mock('../../services/files/file-gc.service', () => ({ retainManagedFiles: files.retain, releaseManagedFiles: files.release }));
vi.mock('../task-center', () => ({ registerTaskHandler: mocks.register }));
vi.mock('../../db', () => ({ withDbExecutor: (_tx: unknown, run: () => unknown) => run() }));
vi.mock('./authorization', () => ({ withImportAuthorization: (_task: unknown, work: () => unknown) => work() }));
vi.mock('../../services/files/files.service', () => ({ readFileContent: vi.fn(async () => ({ stream: new ReadableStream({ start(controller) { controller.close(); } }) })), readGeneratedManagedFile: vi.fn(async () => ({ stream: new ReadableStream({ start(controller) { controller.close(); } }) })), saveGeneratedManagedFile: vi.fn(async () => ({ id: 'error-file' })) }));
vi.mock('../context', () => ({ currentUser: vi.fn(() => ({ userId: 1 })) }));
vi.mock('./parser', () => ({ parseImportWorkbook: vi.fn(async () => [{ rowNum: 2, cells: { title: '正文' } }]) }));
vi.mock('./registry', () => ({ getImportDefinition: vi.fn(() => ({ columns: [{ key: 'title', header: '标题' }], prepare: async () => ({}), parseRow: (cells: unknown) => cells, insertRow: mocks.insert, finalize: mocks.finalize })) }));
import { registerImportTaskHandler } from './handler';
import { parseImportWorkbook } from './parser';
import { getImportDefinition } from './registry';
import { HTTPException } from 'hono/http-exception';
import type { AsyncTaskRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';

function context(payload: Record<string, unknown>, checkpoint: Record<string, unknown> | null = null) {
  const updates: Record<string, unknown>[] = [];
  return { payload: { entity: 'test', fileId: 'file', ...payload }, checkpoint, reportItems: vi.fn(),
    transaction: vi.fn(async (run: (tx: unknown) => unknown) => run({ update: () => ({ set: (values: Record<string, unknown>) => { updates.push(values); return { where: async () => [] }; } }) })),
    progress: vi.fn(async () => ({ cancelRequested: false })), updates,
  };
}
function handler(preview = true) {
  return mocks.register.mock.calls.map(([entry]) => entry as TaskHandlerRegistration).find(entry => entry.taskType === (preview ? IMPORT_PREVIEW_TASK_TYPE : IMPORT_TASK_TYPE))!;
}

describe('import preflight isolation', () => {
  beforeEach(() => { vi.clearAllMocks(); registerImportTaskHandler(); });
  it('reports every skipped file duplicate and persists accurate counts', async () => {
    vi.mocked(parseImportWorkbook).mockResolvedValueOnce([{ rowNum: 2, cells: { title: 'same' } }, { rowNum: 3, cells: { title: 'same' } }]);
    const definition = getImportDefinition('test');
    vi.mocked(getImportDefinition).mockReturnValueOnce({ ...definition, duplicateKeys: row => [String((row as Record<string, unknown>).title)] });
    const ctx = context({ duplicateMode: 'skip' });
    const result = await handler().run(ctx as unknown as Parameters<TaskHandlerRegistration['run']>[0]);
    expect(result).toMatchObject({ succeeded: 1, failed: 0, skipped: 1, total: 2 });
    expect(ctx.reportItems.mock.calls.flatMap(([items]) => items).map(item => item.status)).toEqual(['success', 'skipped']);
    expect(ctx.updates[0]).toMatchObject({ processedCount: 1, checkpoint: { processed: 1, succeeded: 1 } });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('keeps file duplicates as row errors rather than failing the entire task', async () => {
    vi.mocked(parseImportWorkbook).mockResolvedValueOnce([{ rowNum: 2, cells: { title: 'same' } }, { rowNum: 3, cells: { title: 'same' } }]);
    const definition = getImportDefinition('test');
    vi.mocked(getImportDefinition).mockReturnValueOnce({ ...definition, duplicateKeys: () => ['same'] });
    const ctx = context({ duplicateMode: 'error' });
    expect(await handler().run(ctx as unknown as Parameters<TaskHandlerRegistration['run']>[0])).toMatchObject({ succeeded: 1, failed: 1, skipped: 0, errorFileId: 'error-file' });
  });
  it('propagates infrastructure write failures and never marks them as row validation errors', async () => {
    mocks.insert.mockRejectedValueOnce(new HTTPException(503, { message: 'storage offline' }));
    const ctx = context({});
    await expect(handler(false).run(ctx as unknown as Parameters<TaskHandlerRegistration['run']>[0])).rejects.toThrow('storage offline');
    expect(ctx.reportItems).not.toHaveBeenCalled();
    expect(ctx.updates).toEqual([]);
  });
  it('retains failed rows across checkpoint resume so correction files remain complete', async () => {
    const ctx = context({}, { processed: 1, succeeded: 0, failed: 1, failedRows: [{ rowNum: 2, cells: { title: 'bad' }, error: 'invalid' }] });
    expect(await handler().run(ctx as unknown as Parameters<TaskHandlerRegistration['run']>[0])).toMatchObject({ failed: 1, errorFileId: 'error-file' });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('retains an error artifact once and releases input/error references only when removing the task', async () => {
    const tx = { update: () => ({ set: () => ({ where: async () => [] }) }) } as unknown as DbTransaction;
    const task = { id: 2, status: 'success', payload: { fileId: 'input-file' }, checkpoint: {}, result: { errorFileId: 'error-file' } } as unknown as AsyncTaskRow;
    await handler().settleInTransaction!(tx, task);
    expect(files.retain).toHaveBeenCalledExactlyOnceWith(tx, ['error-file']);
    expect(files.release).not.toHaveBeenCalled();
    const settled = { ...task, checkpoint: { managedErrorFileIds: ['error-file'] } };
    await handler().settleInTransaction!(tx, settled);
    expect(files.retain).toHaveBeenCalledOnce();
    await handler().cleanupInTransaction!(tx, settled);
    expect(files.release.mock.calls.map(([, ids]) => ids)).toEqual([['input-file'], ['error-file']]);
  });
  it('releases prior attempt artifacts before restart while preserving the input reference', async () => {
    const tx = {} as DbTransaction;
    await handler().resetInTransaction!(tx, { checkpoint: { managedErrorFileIds: ['old-error'] }, result: { errorFileId: 'old-error' }, payload: { fileId: 'input-file' } } as unknown as AsyncTaskRow);
    expect(files.release).toHaveBeenCalledExactlyOnceWith(tx, ['old-error']);
  });
  it('registers preview separately so it cannot consume the write mutex', () => {
    const registrations = mocks.register.mock.calls.map(([entry]) => entry as TaskHandlerRegistration);
    expect(registrations.find((entry) => entry.taskType === IMPORT_PREVIEW_TASK_TYPE)?.allowConcurrent).toBe(true);
    expect(registrations.find((entry) => entry.taskType === IMPORT_TASK_TYPE)?.allowConcurrent).toBe(false);
  });
  it.each([true, false])('derives write behavior from the registered task, not a tampered payload: %s', async (preview) => {
    const taskType = preview ? IMPORT_PREVIEW_TASK_TYPE : IMPORT_TASK_TYPE;
    const handler = mocks.register.mock.calls.map(([entry]) => entry as TaskHandlerRegistration).find((entry) => entry.taskType === taskType)!;
    const context = { payload: { entity: 'test', fileId: 'file', dryRun: !preview }, checkpoint: null, reportItems: vi.fn(), transaction: async (run: (tx: unknown) => unknown) => run({ update: () => ({ set: () => ({ where: async () => [] }) }) }), progress: vi.fn(async () => ({ cancelRequested: false })) } as unknown as Parameters<TaskHandlerRegistration['run']>[0];
    await handler.run(context);
    expect(mocks.insert).toHaveBeenCalledTimes(preview ? 0 : 1);
    expect(mocks.finalize).toHaveBeenCalledTimes(preview ? 0 : 1);
  });
});
