/**
 * drive 域缓存一致性契约
 *
 * 网盘的目录键是 `list` 操作的 `{ query }` 变体，靠 key 里对象段的子集匹配分层：
 * `dir(spaceId, parentId)` 只命中一个目录的全部分页 / 排序变体，`dirsOf(spaceId)` 命中一个空间的全部目录。
 * 写操作只应打到受影响的目录，不能连坐整站目录缓存（大目录树下会引发风暴式重拉）：
 *  1. 重命名 / 收藏：详情 + 所在目录 + 个人视图；**兄弟目录**保持 fresh
 *  2. 移动：源目录与目标目录都失效；无关目录不动
 *  3. 删除到回收站：源目录失效、详情缓存直接移除（避免 404 重拉）、回收站视图失效
 *  4. 新建文件夹：只打父目录；根级目录键不会连坐同空间子目录
 *  5. 标签增删：该空间全部目录回源，其它空间的目录保持 fresh
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { partialMatchKey, type QueryKey } from '@tanstack/react-query';
import type { DriveNode, DriveNodeDetail, DriveNodeListResult, DriveTag } from '@zenith/shared/drive';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  hasCacheEntry,
  isFresh,
  observeFetches,
  type FetchObserver,
  type RecordedCall,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  deleteDriveNodesVariables,
  driveKeys,
  useCreateDriveFolder,
  useCreateDriveTag,
  useDeleteDriveNodes,
  useDriveDir,
  useDriveNode,
  useDriveRecycle,
  useDriveStarred,
  useDriveTags,
  useMoveDriveNodes,
  useRenameDriveNode,
  useStarDriveNode,
} from './drive';

/** 目录键的 input 段按对象子集匹配（与 `invalidateQueries` 同一算法）；harness 的 `countOf` 是逐段全等，不适用于对象段 */
function fetchesMatching(fetches: FetchObserver, key: QueryKey) {
  return fetches.events.filter((k) => partialMatchKey(k, key)).length;
}

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
const FILE_IN_SPACE2 = node({ id: 31, name: 'c.txt', parentId: null, spaceId: 2 });

function dirResult(list: DriveNode[], parent: DriveNode | null, spaceId = 1): DriveNodeListResult {
  return {
    list, total: list.length, page: 1, pageSize: 50,
    space: { id: spaceId, name: '我的网盘', type: 'personal', quotaBytes: 0, usedBytes: 0, allowExternalShare: true },
    parent, breadcrumbs: parent ? [{ id: parent.id, name: parent.name }] : [], myRole: 'manager',
  };
}

const DETAIL: DriveNodeDetail = { ...FILE_IN_A, spaceName: '我的网盘', spaceType: 'personal', breadcrumbs: [{ id: 10, name: 'A' }], versionCount: 1, shareLinkCount: 0, childCount: 0, legalHold: false, spaceArchived: false };

const TAG: DriveTag = { id: 5, spaceId: 1, name: '合同', color: '#f00', createdAt: '2026-01-01 00:00:00', updatedAt: '2026-01-01 00:00:00' };

const DIR_A = { spaceId: 1, parentId: 10, page: 1, pageSize: 50 };
const DIR_B = { spaceId: 1, parentId: 20, page: 1, pageSize: 50 };
/** 空间 1 根级：与子目录 A / B 同空间，用于验证根级键不连坐子目录 */
const DIR_ROOT = { spaceId: 1, parentId: null, page: 1, pageSize: 50 };
const DIR_SPACE2 = { spaceId: 2, parentId: null, page: 1, pageSize: 50 };

beforeEach(() => {
  api.reset();
  api
    .on('GET', /\/api\/drive\/nodes\?.*parentId=10/, dirResult([FILE_IN_A], FOLDER_A))
    .on('GET', /\/api\/drive\/nodes\?.*parentId=20/, dirResult([FILE_IN_B], FOLDER_B))
    .on('GET', /\/api\/drive\/nodes\?.*spaceId=1(&|$)(?!.*parentId)/, dirResult([FOLDER_A, FOLDER_B], null))
    .on('GET', /\/api\/drive\/nodes\?.*spaceId=2/, dirResult([FILE_IN_SPACE2], null, 2))
    .on('GET', '/api/drive/nodes/11', DETAIL)
    .on('GET', '/api/drive/nodes/recycle', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/drive/nodes/starred', { list: [], total: 0, page: 1, pageSize: 10 })
    .on('GET', '/api/drive/tags', [TAG])
    .on('PUT', '/api/drive/nodes/11/rename', { ...FILE_IN_A, name: 'renamed.txt' })
    .on('POST', '/api/drive/nodes/move', null)
    .on('POST', '/api/drive/nodes/folder', (call: RecordedCall) => node({ id: 12, name: 'New', parentId: (call.body as { parentId: number | null }).parentId, type: 'folder' }))
    .on('POST', '/api/drive/nodes/11/star', null)
    .on('POST', '/api/drive/tags', TAG)
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

describe('目录键：契约 list 操作的 query 子集', () => {
  it('sends spaceId alongside parentId so directory keys carry the space dimension', async () => {
    const qc = createTestQueryClient();
    await mountDirs(qc);
    const url = api.urls('GET').find((u) => u.includes('parentId=10'));
    expect(url).toContain('spaceId=1');
    // useDriveDir 的精确 key 与 dirList(params) 一致，dir / dirsOf 都是它的子集
    expect(hasCacheEntry(qc, driveKeys.dirList(DIR_A))).toBe(true);
    expect(partialMatchKey(driveKeys.dirList(DIR_A), driveKeys.dir(1, 10))).toBe(true);
    expect(partialMatchKey(driveKeys.dirList(DIR_A), driveKeys.dirsOf(1))).toBe(true);
    expect(partialMatchKey(driveKeys.dirList(DIR_A), driveKeys.dir(1, 20))).toBe(false);
    expect(partialMatchKey(driveKeys.dirList(DIR_A), driveKeys.dir(1, null))).toBe(false);
    expect(partialMatchKey(driveKeys.dirList(DIR_A), driveKeys.dirsOf(2))).toBe(false);
  });
});

describe('useRenameDriveNode', () => {
  it('refreshes the detail and the containing directory but leaves sibling directories fresh', async () => {
    const qc = createTestQueryClient();
    const { result } = await mountDirs(qc);
    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.rename.mutateAsync({ params: { id: 11 }, body: { name: 'renamed.txt' } });
    await waitFor(() => expect(fetchesMatching(fetches, driveKeys.dir(1, 10))).toBe(1));
    await waitFor(() => expect(result.current.detail.isFetching).toBe(false));

    expect(fetches.countOf(driveKeys.node(11))).toBe(1);
    expect(fetchesMatching(fetches, driveKeys.dir(1, 20))).toBe(0);
    expect(isFresh(qc, driveKeys.dirList(DIR_B))).toBe(true);
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
      expect(fetchesMatching(fetches, driveKeys.dir(1, 10))).toBe(1);
      expect(fetchesMatching(fetches, driveKeys.dir(1, 20))).toBe(1);
    });
    // 节点的 parentId / ancestorIds 变化 → 详情需回源
    await waitFor(() => expect(fetches.countOf(driveKeys.node(11))).toBe(1));
    // 额外的 sources 只用于失效，不进请求体
    expect(api.calls.find((c) => c.method === 'POST' && c.url === '/api/drive/nodes/move')?.body).toEqual({ ids: [11], targetSpaceId: 1, targetParentId: 20 });
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

    await result.current.remove.mutateAsync(deleteDriveNodesVariables([FILE_IN_A]));
    await waitFor(() => expect(fetchesMatching(fetches, driveKeys.dir(1, 10))).toBe(1));
    await waitFor(() => expect(fetches.countOf(driveKeys.viewOf('recycle'))).toBe(1));

    // 详情被移除而不是失效：失效会带来一次必然 404 的重拉
    expect(hasCacheEntry(qc, driveKeys.node(11))).toBe(false);
    expect(api.countOf('GET', '/api/drive/nodes/11')).toBe(0);
    expect(fetchesMatching(fetches, driveKeys.dir(1, 20))).toBe(0);
    expect(api.calls.find((c) => c.method === 'DELETE')?.body).toEqual({ ids: [11] });
    fetches.stop();
  });

  it('refetches the directory but not sibling directories when the drawer is still open', async () => {
    const qc = createTestQueryClient();
    const { result } = await mountDirs(qc);
    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.remove.mutateAsync(deleteDriveNodesVariables([FILE_IN_A]));
    await waitFor(() => expect(fetchesMatching(fetches, driveKeys.dir(1, 10))).toBe(1));

    expect(fetchesMatching(fetches, driveKeys.dir(1, 20))).toBe(0);
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

    await result.current.remove.mutateAsync(deleteDriveNodesVariables([FILE_IN_A]));
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
    await waitFor(() => expect(fetchesMatching(fetches, driveKeys.dir(1, 10))).toBe(1));

    expect(fetchesMatching(fetches, driveKeys.dir(1, 20))).toBe(0);
    expect(fetches.countOf(driveKeys.node(11))).toBe(0);
    expect(isFresh(qc, driveKeys.node(11))).toBe(true);
    fetches.stop();
  });

  it('refreshes the space root without touching sub-directories of the same space', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ root: useDriveDir(DIR_ROOT), dirA: useDriveDir(DIR_A), createFolder: useCreateDriveFolder() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.root.isSuccess).toBe(true);
      expect(result.current.dirA.isSuccess).toBe(true);
    });
    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.createFolder.mutateAsync({ body: { spaceId: 1, parentId: null, name: 'New' } });
    await waitFor(() => expect(fetchesMatching(fetches, driveKeys.dir(1, null))).toBe(1));

    // 根级键显式 parentId: undefined，子集匹配不会命中带 parentId 的子目录
    expect(fetchesMatching(fetches, driveKeys.dir(1, 10))).toBe(0);
    expect(isFresh(qc, driveKeys.dirList(DIR_A))).toBe(true);
    fetches.stop();
  });
});

describe('useStarDriveNode —— 响应为空，节点引用随变量带入', () => {
  it('refreshes the detail, the containing directory and the starred view; sibling directory stays fresh', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ dirA: useDriveDir(DIR_A), dirB: useDriveDir(DIR_B), detail: useDriveNode(11), starred: useDriveStarred({ page: 1, pageSize: 10 }), star: useStarDriveNode() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.dirA.isSuccess).toBe(true);
      expect(result.current.dirB.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.starred.isSuccess).toBe(true);
    });
    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.star.mutateAsync({ params: { id: 11 }, node: FILE_IN_A });
    await waitFor(() => {
      expect(fetchesMatching(fetches, driveKeys.dir(1, 10))).toBe(1);
      expect(fetches.countOf(driveKeys.node(11))).toBe(1);
      expect(fetches.countOf(driveKeys.viewOf('starred'))).toBe(1);
    });

    expect(fetchesMatching(fetches, driveKeys.dir(1, 20))).toBe(0);
    expect(isFresh(qc, driveKeys.dirList(DIR_B))).toBe(true);
    // node 只用于失效，请求体为空
    expect(api.calls.find((c) => c.method === 'POST' && c.url === '/api/drive/nodes/11/star')?.body).toBeUndefined();
    fetches.stop();
  });
});

describe('标签面 —— 空间级失效替代 [...dirs, spaceId] 字面量前缀', () => {
  it('refreshes every directory of the tag space and the tag lookup, but leaves other spaces fresh', async () => {
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({ root: useDriveDir(DIR_ROOT), dirA: useDriveDir(DIR_A), other: useDriveDir(DIR_SPACE2), tags: useDriveTags(1), createTag: useCreateDriveTag() }),
      { wrapper: createWrapper(qc) },
    );
    await waitFor(() => {
      expect(result.current.root.isSuccess).toBe(true);
      expect(result.current.dirA.isSuccess).toBe(true);
      expect(result.current.other.isSuccess).toBe(true);
      expect(result.current.tags.isSuccess).toBe(true);
    });
    const fetches = observeFetches(qc);
    api.resetCalls();

    await result.current.createTag.mutateAsync({ body: { spaceId: 1, name: '合同', color: '#f00' } });
    await waitFor(() => {
      // 根级与子目录都带 spaceId=1，dirsOf(1) 一次覆盖
      expect(fetchesMatching(fetches, driveKeys.dir(1, null))).toBe(1);
      expect(fetchesMatching(fetches, driveKeys.dir(1, 10))).toBe(1);
      expect(fetches.countOf(driveKeys.tags(1))).toBe(1);
    });

    expect(fetchesMatching(fetches, driveKeys.dirsOf(2))).toBe(0);
    expect(isFresh(qc, driveKeys.dirList(DIR_SPACE2))).toBe(true);
    fetches.stop();
  });
});
