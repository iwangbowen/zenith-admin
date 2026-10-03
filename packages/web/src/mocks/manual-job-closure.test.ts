import { afterEach, describe, expect, it } from 'vitest';
import { fillPath, type AnyOperation, type ApiResponse, type InputOf, type OutputOf } from '@zenith/shared/core';
import { directorySyncContract, directorySyncRunSchema } from '@zenith/shared/identity';
import { dbAdminContract, dbBackupSchema } from '@zenith/shared/ops';
import { mockDirectorySyncRuns, mockDirectorySyncSources } from './data/directory-sync';
import { mockBackups } from './data/db-admin-backups';
import { directorySyncHandlers } from './handlers/directory-sync';
import { dbAdminBackupsHandlers } from './handlers/db-admin-backups';
import { mockDateTime } from './utils/date';

const originalRuns = structuredClone(mockDirectorySyncRuns);
const originalSources = structuredClone(mockDirectorySyncSources);
const originalBackups = structuredClone(mockBackups);
afterEach(() => {
  mockDirectorySyncRuns.splice(0, mockDirectorySyncRuns.length, ...structuredClone(originalRuns));
  mockDirectorySyncSources.splice(0, mockDirectorySyncSources.length, ...structuredClone(originalSources));
  mockBackups.splice(0, mockBackups.length, ...structuredClone(originalBackups));
});

async function call<Op extends AnyOperation>(operation: Op, input: InputOf<Op>) {
  const { params } = input as { params: Record<string, unknown> };
  const request = new Request(new URL(fillPath(operation.fullPath, params), window.location.origin), { method: operation.method.toUpperCase() });
  for (const handler of [...directorySyncHandlers, ...dbAdminBackupsHandlers]) {
    const result = await (handler as unknown as { run: (args: unknown) => Promise<{ response?: Response } | null> }).run({ request, requestId: 'manual-closure-test' });
    if (result?.response) return { status: result.response.status, body: await result.response.json() as ApiResponse<OutputOf<Op>> };
  }
  throw new Error('No matching mark-failed handler');
}

describe('manual job closure mock contracts', () => {
  it('marks a stuck sync and its source as failed and rejects a repeated closure', async () => {
    const result = await call(directorySyncContract.markRunFailed, { params: { id: 3 } });
    expect(result.status).toBe(200);
    expect(directorySyncRunSchema.safeParse(result.body.data).success).toBe(true);
    expect(result.body.data).toMatchObject({ status: 'failed', message: '管理员手动标记卡死同步为失败' });
    expect(mockDirectorySyncSources.find((source) => source.id === result.body.data.sourceId)?.lastRunStatus).toBe('failed');
    expect((await call(directorySyncContract.markRunFailed, { params: { id: 3 } })).status).toBe(409);
  });

  it('rejects sync records that are still within the execution window or already complete', async () => {
    mockDirectorySyncRuns.push({ ...originalRuns[0], id: 77, startedAt: mockDateTime() });
    expect((await call(directorySyncContract.markRunFailed, { params: { id: 77 } })).status).toBe(409);
    expect((await call(directorySyncContract.markRunFailed, { params: { id: 2 } })).status).toBe(409);
  });

  it('closes stuck running and pending backups but protects recent and completed backups', async () => {
    for (const id of [4, 5]) {
      const result = await call(dbAdminContract.markBackupFailed, { params: { id } });
      expect(result.status).toBe(200);
      expect(dbBackupSchema.safeParse(result.body.data).success).toBe(true);
      expect(result.body.data).toMatchObject({ status: 'failed', errorMessage: '管理员手动标记卡死备份为失败' });
      expect((await call(dbAdminContract.markBackupFailed, { params: { id } })).status).toBe(409);
    }
    mockBackups.push({ ...originalBackups[0], id: 77, startedAt: mockDateTime(), createdAt: mockDateTime() });
    expect((await call(dbAdminContract.markBackupFailed, { params: { id: 77 } })).status).toBe(409);
    expect((await call(dbAdminContract.markBackupFailed, { params: { id: 1 } })).status).toBe(409);
  });
});
