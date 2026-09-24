import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskHandlerRegistration } from '../task-center/types';
import { IMPORT_PREVIEW_TASK_TYPE, IMPORT_TASK_TYPE } from '@zenith/shared/tasks';

const mocks = vi.hoisted(() => ({ register: vi.fn(), insert: vi.fn(), finalize: vi.fn() }));
vi.mock('../task-center', () => ({ registerTaskHandler: mocks.register }));
vi.mock('../../services/files/files.service', () => ({ readFileContent: vi.fn(async () => ({ stream: new ReadableStream({ start(controller) { controller.close(); } }) })) }));
vi.mock('../context', () => ({ currentUser: vi.fn(() => ({ userId: 1 })) }));
vi.mock('./parser', () => ({ parseImportWorkbook: vi.fn(async () => [{ rowNum: 2, cells: { title: '正文' } }]) }));
vi.mock('./registry', () => ({ getImportDefinition: vi.fn(() => ({ columns: [{ key: 'title' }], prepare: async () => ({}), parseRow: (cells: unknown) => cells, insertRow: mocks.insert, finalize: mocks.finalize })) }));
import { registerImportTaskHandler } from './handler';

describe('import preflight isolation', () => {
  beforeEach(() => { vi.clearAllMocks(); registerImportTaskHandler(); });
  it('registers preview separately so it cannot consume the write mutex', () => {
    const registrations = mocks.register.mock.calls.map(([entry]) => entry as TaskHandlerRegistration);
    expect(registrations.find((entry) => entry.taskType === IMPORT_PREVIEW_TASK_TYPE)?.allowConcurrent).toBe(true);
    expect(registrations.find((entry) => entry.taskType === IMPORT_TASK_TYPE)?.allowConcurrent).toBe(false);
  });
  it.each([true, false])('derives write behavior from the registered task, not a tampered payload: %s', async (preview) => {
    const taskType = preview ? IMPORT_PREVIEW_TASK_TYPE : IMPORT_TASK_TYPE;
    const handler = mocks.register.mock.calls.map(([entry]) => entry as TaskHandlerRegistration).find((entry) => entry.taskType === taskType)!;
    const context = { payload: { entity: 'test', fileId: 'file', dryRun: !preview }, checkpoint: null, reportItems: vi.fn(), progress: vi.fn(async () => ({ cancelRequested: false })) } as unknown as Parameters<TaskHandlerRegistration['run']>[0];
    await handler.run(context);
    expect(mocks.insert).toHaveBeenCalledTimes(preview ? 0 : 1);
    expect(mocks.finalize).toHaveBeenCalledTimes(preview ? 0 : 1);
  });
});
