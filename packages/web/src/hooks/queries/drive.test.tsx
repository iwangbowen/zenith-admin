/**
 * drive 域缓存一致性契约
 *
 * 网盘的目录键按 `(spaceId, parentId)` 分层，写操作只应打到受影响的目录，
 * 不能连坐整站目录缓存（大目录树下会引发风暴式重拉）：
 *  1. 重命名 / 收藏：详情 + 所在目录 + 个人视图；**兄弟目录**保持 fresh
 *  2. 移动：源目录与目标目录都失效；无关目录不动
 *  3. 删除到回收站：源目录失效、详情缓存直接移除（避免 404 重拉）、回收站视图失效
 *  4. 新建文件夹：只打父目录
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { DriveNode, DriveNodeDetail, DriveNodeListResult } from '@zenith/shared/drive';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  hasCacheEntry,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  driveKeys,
  useCreateDriveFolder,
  useDeleteDriveNodes,
  useDriveDir,
  useDriveNode,
  useDriveRecycle,
  useMoveDriveNodes,
  useRenameDriveNode,
} from './drive';

function node(partial: Partial<DriveNode> & Pick<DriveNode, 'id' | 'name' | 'parentId'>): DriveNode {
  return {
    spaceId: 1, ancestorIds: partial.parentId ? [partial.parentId] : [], depth: partial.parentId ? 1 : 0, type: 'file',
    extension: 'txt', mimeType: 'text/plain', fileId: 'f', size: 10, contentHash: null, currentVersion: 1, inheritPermissions: true,
    lockedBy: null, lockedByName: null, lockedAt: null, lockExpiresAt: null, thumbnailUrl: null, url: `/api/drive/nodes/${partial.id}/content`,
    deletedAt: null, deletedBy: null, deletedByName: null, isStarred: false, myRole: 'manager', tags: [],
    createdBy: 1, createdByName: 'admin', updatedBy: 1, updatedByName: 'admin', createdAt: '2026-01-01 00:00:00', updatedAt: '2026-01-01 00:00:00',
    ...partial,
  };
}

const FOLDER_A = node({ id: 10, name: 'A', parentId: null, type: 'folder' });
const FOLDER_B = node({ id: 20, name: 'B', parentId: null, type: 'folder' });
const FILE_IN_A = node({ id: 11, name: 'a.txt', parentId: 10 });
const FILE_IN_B = node({ id: 21, name: 'b.txt', parentId: 20 });

function dirResult(list: DriveNode[], parent: DriveNode | null): DriveNodeListResult {
  return {
    list, total: list.length, page: 1, pageSize: 50,
    space: { id: 1, name: '我的网盘', type: 'personal', quotaBytes: 0, usedBytes: 0, allowExternalShare: true },
    parent, breadcrumbs: parent ? [{ id: parent.id, name: parent.name }] : [], myRole: 'manager',
  };
}

const DETAIL: DriveNodeDetail = { ...FILE_IN_A, spaceName: '我的网盘', spaceType: 'personal', breadcrumbs: [{ id: 10, name: 'A' }], versionCount: 1, shareLinkCount: 0, childCount: 0 };

const DIR_A = { spaceId: 1, parentId: 10, page: 1, pageSize: 50 };
const DIR_B = { spaceId: 1, parentId: 20, page: 1, pageSize: 50 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', /\/api\/drive\/nodes\?.*parentId=10/, dirResult([FILE_IN_A], FOLDER_A))
    .on('GET', /\/api\/drive\/nodes\?.*parentId=20/, dirResult([FILE_IN_B], FOLDER_B))
    .on('GET', '/api/drive/nodes/11', DETAIL)
    .on('GET', '/api/drive/nodes/recycle', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('PUT', '/api/drive/nodes/11/rename', { ...FILE_IN_A, name: 'renamed.txt' })
    .on('POST', '/api/drive/nodes/move', null)
    .on('POST', '/api/drive/nodes/folder', node({ id: 12, name: 'New', parentId: 10, type: 'folder' }))
    .on('DELETE', '/api/drive/nodes/batch', null);
});

async function mountDirs(qc: ReturnType<typeof createTestQueryClient>) {
  const rendered = renderHook(
    () => ({
      dirA: useDriveDir(DIR_A),
      dirB: useDriveDir(DIR_B),
      detail: useDriveNode(11),
      recycle: useDriveRecycle({ page: 1, pageSize: 10 }),
      rename: useRenameDriveNode(),
      move: useMoveDriveNodes(),
      remove: useDeleteDriveNodes(),
      createFolder: useCreateDriveFolder(),
    }),
    { wrapper: createWrapper(qc) },
  );
  await waitFor(() => {
    expect(rendered.result.current.dirA.isSuccess).toBe(true);
    expect(rendered.result.current.dirB.isSuccess).toBe(true);
    expect(rendered.result.current.detail.isSuccess).toBe(true);
    expect(rendered.result.current.recycle.isSuccess).toBe(true);
  });
  return rendered;
}

describe('useRenameDriveNode', () => {
  it('refreshes the detail and the containing directory but leaves sibling directories fresh', async () => {
    const qc = createTestQueryClient();
    const { result } = await mountDirs(qc);
    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.rename.mutateAsync({ params: { id: 11 }, body: { name: 'renamed.txt' } });
    await waitFor(() => expect(fetches.countOf(driveKeys.dir(1, 10))).toBe(1));
    await waitFor(() => expect(result.current.detail.isFetching).toBe(false));

    expect(fetches.countOf(driveKeys.node(11))).toBe(1);
    expect(fetches.countOf(driveKeys.dir(1, 20))).toBe(0);
    expect(isFresh(qc, driveKeys.dirList(1, 20, { page: 1, pageSize: 50 }))).toBe(true);
    fetches.stop();
  });
});

describe('useMoveDriveNodes', () => {
  it('refreshes both the source and the target directory and drops nothing else', async () => {
    const qc = createTestQueryClient();
    const { result } = await mountDirs(qc);
    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.move.mutateAsync({ body: { ids: [11], targetSpaceId: 1, targetParentId: 20 }, sources: [FILE_IN_A] });
    await waitFor(() => {
      expect(fetches.countOf(driveKeys.dir(1, 10))).toBe(1);
      expect(fetches.countOf(driveKeys.dir(1, 20))).toBe(1);
    });
    // 节点的 parentId / ancestorIds 变化 → 详情需回源
    await waitFor(() => expect(fetches.countOf(driveKeys.node(11))).toBe(1));
    fetches.stop();
  });
});

describe('useDeleteDriveNodes', () => {
  it('drops the deleted node detail, refreshes the source directory and the recycle view', async () => {
    const qc = createTestQueryClient();
    // 抽屉已关闭（无 detail observer），但缓存仍在：删除时最容易被误失效成 404 重拉的对象
    const { result } = renderHook(
      () => ({ dirA: useDriveDir(DIR_A), dirB: useDriveDir(DIR_B), recycle: useDriveRecycle({ page: 1, pageSize: 10 }), remove: useDeleteDriveNodes() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.dirA.isSuccess).toBe(true);
      expect(result.current.dirB.isSuccess).toBe(true);
      expect(result.current.recycle.isSuccess).toBe(true);
    });
    qc.setQueryData(driveKeys.node(11), DETAIL);
    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.remove.mutateAsync({ nodes: [FILE_IN_A] });
    await waitFor(() => expect(fetches.countOf(driveKeys.dir(1, 10))).toBe(1));
    await waitFor(() => expect(fetches.countOf(driveKeys.viewOf('recycle'))).toBe(1));

    // 详情被移除而不是失效：失效会带来一次必然 404 的重拉
    expect(hasCacheEntry(qc, driveKeys.node(11))).toBe(false);
    expect(api.countOf('GET', '/api/drive/nodes/11')).toBe(0);
    expect(fetches.countOf(driveKeys.dir(1, 20))).toBe(0);
    fetches.stop();
  });

  it('refetches the directory but not sibling directories when the drawer is still open', async () => {
    const qc = createTestQueryClient();
    const { result } = await mountDirs(qc);
    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.remove.mutateAsync({ nodes: [FILE_IN_A] });
    await waitFor(() => expect(fetches.countOf(driveKeys.dir(1, 10))).toBe(1));

    expect(fetches.countOf(driveKeys.dir(1, 20))).toBe(0);
    fetches.stop();
  });

  it('removes a stale detail cache left behind by a closed drawer', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ dirA: useDriveDir(DIR_A), remove: useDeleteDriveNodes() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => expect(result.current.dirA.isSuccess).toBe(true));
    qc.setQueryData(driveKeys.node(11), DETAIL);

    await result.current.remove.mutateAsync({ nodes: [FILE_IN_A] });
    await waitFor(() => expect(result.current.dirA.isFetching).toBe(false));

    expect(hasCacheEntry(qc, driveKeys.node(11))).toBe(false);
    expect(api.countOf('GET', '/api/drive/nodes/11')).toBe(0);
  });
});

describe('useCreateDriveFolder', () => {
  it('only refreshes the parent directory returned by the server', async () => {
    const qc = createTestQueryClient();
    const { result } = await mountDirs(qc);
    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.createFolder.mutateAsync({ body: { spaceId: 1, parentId: 10, name: 'New' } });
    await waitFor(() => expect(fetches.countOf(driveKeys.dir(1, 10))).toBe(1));

    expect(fetches.countOf(driveKeys.dir(1, 20))).toBe(0);
    expect(fetches.countOf(driveKeys.node(11))).toBe(0);
    expect(isFresh(qc, driveKeys.node(11))).toBe(true);
    fetches.stop();
  });
});
