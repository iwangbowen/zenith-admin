/**
 * db-admin 备份子域缓存一致性契约
 *
 * 备份记录挂在 db-admin 域下的独立前缀（`backupLists`），与表清单 / 总览 / 维护统计等
 * 数据库元数据互不相干：创建 / 删除备份只应刷新备份列表；列表在仍有未完成任务时轮询，
 * 全部结束后停表，面板不可见时不取数也不轮询。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import type { DbBackup } from '@zenith/shared/ops';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  dbAdminKeys,
  useCreateDbBackup,
  useDbAdminTables,
  useDbBackups,
  useDeleteDbBackup,
  type DbBackupListParams,
} from './db-admin';

const LIST_PARAMS: DbBackupListParams = { page: 1, pageSize: 10 };

const DONE: DbBackup = {
  id: 1,
  name: 'pg_dump-20260901_030000',
  type: 'pg_dump',
  fileId: '018f6f8a-0001-7000-8000-000000000001',
  fileSize: 1048576,
  status: 'success',
  tables: null,
  startedAt: '2026-09-01 03:00:00',
  completedAt: '2026-09-01 03:00:05',
  durationMs: 5000,
  errorMessage: null,
  createdBy: 1,
  createdByName: '管理员',
  createdAt: '2026-09-01 03:00:00',
  updatedAt: '2026-09-01 03:00:05',
};

const RUNNING: DbBackup = { ...DONE, id: 2, name: 'pg_dump-20260909_200000', status: 'running', fileId: null, fileSize: null, completedAt: null, durationMs: null };

function stubList(list: DbBackup[]) {
  api.on('GET', '/api/db-admin/backups', { list, total: list.length, page: 1, pageSize: 10 });
}

beforeEach(() => {
  api.reset();
  stubList([DONE]);
  api
    .on('GET', '/api/db-admin/tables', [])
    .on('POST', '/api/db-admin/backups', { id: 3, name: 'pg_dump-new', status: 'pending' })
    .on('DELETE', '/api/db-admin/backups/1', null);
});

function mountPanel(enabled = true) {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      backups: useDbBackups(LIST_PARAMS, enabled),
      tables: useDbAdminTables(),
      create: useCreateDbBackup(),
      remove: useDeleteDbBackup(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountPanel>['hook']) {
  await waitFor(() => {
    expect(hook.result.current.backups.isSuccess).toBe(true);
    expect(hook.result.current.tables.isSuccess).toBe(true);
  });
}

/** 读取列表查询当前生效的轮询间隔（契约里以函数按数据决定） */
function resolvedRefetchInterval(qc: QueryClient) {
  const query = qc.getQueryCache().find({ queryKey: dbAdminKeys.backupList(LIST_PARAMS) });
  expect(query).toBeDefined();
  const interval = query!.options.refetchInterval;
  return typeof interval === 'function' ? interval(query!) : interval;
}

describe('useDbBackups —— 轮询只在有未完成任务且面板可见时进行', () => {
  it('stops polling once every record has settled', async () => {
    const { qc, hook } = mountPanel();
    await settle(hook);

    expect(resolvedRefetchInterval(qc)).toBe(false);
  });

  it('polls every 3 seconds while a backup is still pending or running', async () => {
    stubList([RUNNING, DONE]);
    const { qc, hook } = mountPanel();
    await settle(hook);

    expect(resolvedRefetchInterval(qc)).toBe(3000);
  });

  it('does not fetch at all while the panel is inactive', async () => {
    const { hook } = mountPanel(false);
    await waitFor(() => expect(hook.result.current.tables.isSuccess).toBe(true));

    expect(hook.result.current.backups.fetchStatus).toBe('idle');
    expect(api.countOf('GET', '/api/db-admin/backups')).toBe(0);
  });
});

describe('useCreateDbBackup / useDeleteDbBackup —— 只刷新备份列表', () => {
  it('refreshes the backup list after creating, leaving database metadata fresh', async () => {
    const { qc, hook } = mountPanel();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.create.mutateAsync({ body: { type: 'pg_dump' } });
    await waitFor(() => expect(hook.result.current.backups.isFetching).toBe(false));

    expect(api.countOf('POST', '/api/db-admin/backups')).toBe(1);
    expect(fetches.countOf(dbAdminKeys.backupLists)).toBe(1);
    expect(fetches.countOf(dbAdminKeys.tables)).toBe(0);
    expect(isFresh(qc, dbAdminKeys.tables)).toBe(true);

    fetches.stop();
  });

  it('refreshes the backup list after deleting a record', async () => {
    const { qc, hook } = mountPanel();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.remove.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(hook.result.current.backups.isFetching).toBe(false));

    expect(api.countOf('DELETE', '/api/db-admin/backups/1')).toBe(1);
    expect(fetches.countOf(dbAdminKeys.backupLists)).toBe(1);
    expect(fetches.countOf(dbAdminKeys.tables)).toBe(0);

    fetches.stop();
  });
});
