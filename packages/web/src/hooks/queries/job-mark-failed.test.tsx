import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiRecorder, createRequestMock, createTestQueryClient, createWrapper, observeFetches } from '@/test-utils/query-harness';
import { mockDirectorySyncRuns } from '@/mocks/data/directory-sync';
import { mockBackups } from '@/mocks/data/db-admin-backups';

const recorder = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));

import { directorySyncRunKeys, directorySyncSourceKeys, useDirectorySyncRunDetail, useDirectorySyncRunList, useDirectorySyncSourceDetail, useDirectorySyncSourceList, useMarkDirectorySyncRunFailed } from './directory-sync';
import { dbAdminKeys, useDbAdminTables, useDbBackups, useMarkDbBackupFailed } from './db-admin';
import { jobMonitorKeys, useJobMonitorOverview, useJobMonitorStuck } from './job-monitor';

const page = { page: 1, pageSize: 10 };
const resultPage = <T,>(row: T) => ({ list: [row], total: 1, ...page });
beforeEach(() => recorder.reset());

describe('mark failed cache updates', () => {
  it('updates the sync detail and reloads its source and job monitor without refetching an unrelated source', async () => {
    let run = structuredClone(mockDirectorySyncRuns.find((item) => item.id === 3)!);
    recorder.on('GET', '/api/directory-sync/runs', () => resultPage(run));
    recorder.on('GET', '/api/directory-sync/runs/3', () => run);
    recorder.on('GET', '/api/directory-sync/sources', () => resultPage({ id: run.sourceId, lastRunStatus: run.status }));
    recorder.on('GET', `/api/directory-sync/sources/${run.sourceId}`, () => ({ id: run.sourceId, lastRunStatus: run.status }));
    recorder.on('GET', '/api/directory-sync/sources/99', { id: 99, lastRunStatus: 'success' });
    recorder.on('GET', '/api/job-monitor/overview', { totals: { stuck: 1 } });
    recorder.on('GET', '/api/job-monitor/sources/directory-sync/stuck', []);
    recorder.on('POST', '/api/directory-sync/runs/3/mark-failed', () => (run = { ...run, status: 'failed', message: '已人工结案' }));
    const client = createTestQueryClient();
    const hook = renderHook(() => ({
      list: useDirectorySyncRunList(page), detail: useDirectorySyncRunDetail(3),
      sources: useDirectorySyncSourceList(page), source: useDirectorySyncSourceDetail(run.sourceId), other: useDirectorySyncSourceDetail(99),
      overview: useJobMonitorOverview({ refetchInterval: false }), stuck: useJobMonitorStuck('directory-sync', true), mark: useMarkDirectorySyncRunFailed(),
    }), { wrapper: createWrapper(client) });
    await waitFor(() => expect([hook.result.current.list, hook.result.current.detail, hook.result.current.sources, hook.result.current.source, hook.result.current.other, hook.result.current.overview, hook.result.current.stuck].every((query) => query.isSuccess)).toBe(true));
    const fetches = observeFetches(client);
    recorder.resetCalls();
    await act(async () => { await hook.result.current.mark.mutateAsync({ params: { id: 3 } }); });
    await waitFor(() => expect(hook.result.current.list.data?.list[0].status).toBe('failed'));
    expect(hook.result.current.detail.data?.message).toBe('已人工结案');
    expect(recorder.countOf('GET', '/api/directory-sync/runs/3')).toBe(0);
    expect(fetches.countOf(directorySyncRunKeys.lists)).toBe(1);
    expect(fetches.countOf(directorySyncSourceKeys.lists)).toBe(1);
    expect(fetches.countOf(directorySyncSourceKeys.detail(run.sourceId))).toBe(1);
    expect(fetches.countOf(directorySyncSourceKeys.detail(99))).toBe(0);
    expect(fetches.countOf(jobMonitorKeys.overview)).toBe(1);
    expect(fetches.countOf(jobMonitorKeys.stuck('directory-sync'))).toBe(1);
    fetches.stop();
  });

  it('retains fresh sync-source data when closing a dry-run record', async () => {
    const run = { ...mockDirectorySyncRuns[0], dryRun: true, status: 'failed' as const };
    recorder.on('GET', '/api/directory-sync/sources', resultPage({ id: run.sourceId }));
    recorder.on('POST', `/api/directory-sync/runs/${run.id}/mark-failed`, run);
    const hook = renderHook(() => ({ sources: useDirectorySyncSourceList(page), mark: useMarkDirectorySyncRunFailed() }), { wrapper: createWrapper(createTestQueryClient()) });
    await waitFor(() => expect(hook.result.current.sources.isSuccess).toBe(true));
    recorder.resetCalls();
    await act(async () => { await hook.result.current.mark.mutateAsync({ params: { id: run.id } }); });
    expect(recorder.countOf('GET', '/api/directory-sync/sources')).toBe(0);
  });

  it('reloads backup rows and monitoring while preserving the unrelated database table lookup', async () => {
    let backup = structuredClone(mockBackups.find((item) => item.id === 4)!);
    recorder.on('GET', '/api/db-admin/backups', () => resultPage(backup));
    recorder.on('GET', '/api/db-admin/tables', []);
    recorder.on('GET', '/api/job-monitor/overview', { totals: { stuck: 1 } });
    recorder.on('GET', '/api/job-monitor/sources/db-backup/stuck', []);
    recorder.on('POST', '/api/db-admin/backups/4/mark-failed', () => (backup = { ...backup, status: 'failed' }));
    const client = createTestQueryClient();
    const hook = renderHook(() => ({ list: useDbBackups(page), tables: useDbAdminTables(), overview: useJobMonitorOverview({ refetchInterval: false }), stuck: useJobMonitorStuck('db-backup', true), mark: useMarkDbBackupFailed() }), { wrapper: createWrapper(client) });
    await waitFor(() => expect([hook.result.current.list, hook.result.current.tables, hook.result.current.overview, hook.result.current.stuck].every((query) => query.isSuccess)).toBe(true));
    const fetches = observeFetches(client);
    recorder.resetCalls();
    await act(async () => { await hook.result.current.mark.mutateAsync({ params: { id: 4 } }); });
    await waitFor(() => expect(hook.result.current.list.data?.list[0].status).toBe('failed'));
    expect(fetches.countOf(dbAdminKeys.backupLists)).toBe(1);
    expect(fetches.countOf(jobMonitorKeys.overview)).toBe(1);
    expect(fetches.countOf(jobMonitorKeys.stuck('db-backup'))).toBe(1);
    expect(recorder.countOf('GET', '/api/db-admin/tables')).toBe(0);
    fetches.stop();
  });
});
