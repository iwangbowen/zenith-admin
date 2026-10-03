import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({ update: vi.fn(), select: vi.fn(), insert: vi.fn(), mkdir: vi.fn(), stat: vi.fn(), readFile: vi.fn(), upload: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../db', () => ({ db: { update: mocks.update, select: mocks.select, insert: mocks.insert } }));
vi.mock('node:fs', () => ({ promises: { mkdir: mocks.mkdir, stat: mocks.stat, readFile: mocks.readFile } }));
vi.mock('./file-storage', () => ({ uploadFileByConfig: mocks.upload, extractBucketName: () => null, resolveObjectAcl: () => 'private' }));
vi.mock('./logger', () => ({ default: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));
import { runBackupJob } from './db-backup';
import { managedFiles } from '../db/schema';

const dialect = new PgDialect({ casing: 'snake_case' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(rows: unknown): any {
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'limit', 'set', 'returning', 'values']) builder[method] = vi.fn(() => builder);
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return builder;
}
const file = { filename: 'test.sql.gz', filePath: 'C:/backup/test.sql.gz', mimeType: 'application/gzip' };
const fileId = '018f6f8a-0001-7000-8000-000000000001';
function storage() {
  mocks.select.mockReturnValue(chain([{ id: 1, name: 'storage', provider: 'local' }]));
  mocks.insert.mockReturnValue(chain([{ id: fileId }]));
}

describe('backup executor terminal state fencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.stat.mockResolvedValue({ size: 1024 });
    mocks.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.upload.mockResolvedValue({ objectKey: 'backup/test', size: 1024, mimeType: file.mimeType, extension: '.gz' });
    mocks.select.mockReturnValue(chain([]));
  });

  it('does not execute a pending row that was finalized or deleted before claim', async () => {
    const claim = chain([]);
    mocks.update.mockReturnValue(claim);
    const produce = vi.fn();
    await runBackupJob(7, '测试备份', produce);
    expect(produce).not.toHaveBeenCalled();
    expect(dialect.sqlToQuery(claim.where.mock.calls[0][0]).params).toEqual([7, 'pending']);
  });

  it('only the running execution that claimed the same startedAt may finish', async () => {
    const claim = chain([{ id: 7 }]);
    const completion = chain([{ id: 7 }]);
    mocks.update.mockReturnValueOnce(claim).mockReturnValueOnce(completion);
    await runBackupJob(7, '测试备份', async () => file);
    expect(completion.set.mock.calls[0][0]).toMatchObject({ status: 'success', fileId: null, fileSize: 1024 });
    const condition = dialect.sqlToQuery(completion.where.mock.calls[0][0]);
    expect(condition.params).toContain('running');
    expect(condition.params).toContain(claim.set.mock.calls[0][0].startedAt.toISOString());
    expect(mocks.info).toHaveBeenCalledOnce();
  });

  it('a failed late executor cannot overwrite an already finalized record', async () => {
    const claim = chain([{ id: 7 }]);
    const failure = chain([]);
    mocks.update.mockReturnValueOnce(claim).mockReturnValueOnce(failure);
    await expect(runBackupJob(7, '测试备份', async () => { throw new Error('迟到执行错误'); })).rejects.toThrow('迟到执行错误');
    const condition = dialect.sqlToQuery(failure.where.mock.calls[0][0]);
    expect(condition.params).toContain('running');
    expect(condition.params).toContain(claim.set.mock.calls[0][0].startedAt.toISOString());
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it('a successful late upload is released to GC when its record is already finalized', async () => {
    storage();
    const claim = chain([{ id: 7 }]);
    const completion = chain([]);
    const orphan = chain(undefined);
    mocks.update.mockReturnValueOnce(claim).mockReturnValueOnce(completion).mockReturnValueOnce(orphan);
    await runBackupJob(7, '测试备份', async () => file);
    expect(mocks.update.mock.calls[2][0]).toBe(managedFiles);
    expect(orphan.set.mock.calls[0][0]).toMatchObject({ gcState: 'orphan', orphanedAt: expect.any(Date) });
    expect(dialect.sqlToQuery(orphan.where.mock.calls[0][0]).params).toEqual([fileId]);
    expect(mocks.info).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it('an accepted upload stays restricted and live and links to the completed record', async () => {
    storage();
    const claim = chain([{ id: 7 }]);
    const completion = chain([{ id: 7 }]);
    mocks.update.mockReturnValueOnce(claim).mockReturnValueOnce(completion);
    await runBackupJob(7, '测试备份', async () => file);
    expect(mocks.insert.mock.results[0].value.values.mock.calls[0][0]).toMatchObject({ visibility: 'restricted', gcState: 'live' });
    expect(completion.set.mock.calls[0][0]).toMatchObject({ fileId, status: 'success' });
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });
});
