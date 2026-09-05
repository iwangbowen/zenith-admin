import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { InputOf, OutputOf, QueryOf } from '@zenith/shared/core';
import {
  driveAdminContract,
  driveNodeContract,
  drivePublicShareContract,
  driveShareLinkContract,
  driveSpaceContract,
  driveTagContract,
  type DriveNode,
} from '@zenith/shared/drive';
import { api, contractKey, createResourceQueries, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME, unwrap } from '@/lib/query';
import { request } from '@/utils/request';

/**
 * 企业网盘域 hooks。
 *
 * key 分层（失效连坐面）：
 * - 空间走 `createResourceQueries(driveSpaceContract)`；`my` / `members` 子键由契约操作名派生
 * - 目录内容 `[…list, spaceId, parentId, params]`：增删改移只打对应目录，不打全站
 * - 节点详情与子资源（授权 / 版本 / 动态 / 评论 / 外链）按契约操作名 + `{ params: { id } }` 分组
 * - 跨空间个人视图（与我共享 / 收藏 / 最近 / 搜索 / 回收站）各自独立操作名，需要时整组失效
 * - 外链、标签、治理页与公开外链页同样按契约操作名分组
 */

export type DriveSpaceListParams = NonNullable<QueryOf<typeof driveSpaceContract.list>>;
/** 目录内容参数：parentId 为 null 表示空间根级（请求时省略） */
export type DriveDirParams = Omit<NonNullable<QueryOf<typeof driveNodeContract.list>>, 'parentId'> & { parentId?: number | null };
/** 个人视图（与我共享 / 收藏 / 最近）分页参数 */
export type DriveViewParams = NonNullable<QueryOf<typeof driveNodeContract.starred>>;
export type DriveRecycleParams = NonNullable<QueryOf<typeof driveNodeContract.recycle>>;
export type DriveSearchParams = NonNullable<QueryOf<typeof driveNodeContract.search>>;
/** 仅分页参数的子资源列表（节点动态 / 外链访问日志） */
export type DrivePageParams = NonNullable<QueryOf<typeof driveNodeContract.activities>>;
export type DriveShareLinkListParams = NonNullable<QueryOf<typeof driveShareLinkContract.list>>;
export type DriveAdminSpaceParams = NonNullable<QueryOf<typeof driveAdminContract.spaces>>;
export type DriveAdminShareLinkParams = NonNullable<QueryOf<typeof driveAdminContract.shareLinks>>;
export type DriveAdminActivityParams = NonNullable<QueryOf<typeof driveAdminContract.activities>>;

type NodeRef = Pick<DriveNode, 'id' | 'spaceId' | 'parentId'>;

// ─── 空间（标准资源） ─────────────────────────────────────────────────────────

export const {
  keys: driveSpaceKeys,
  useList: useDriveSpaceList,
  useDetail: useDriveSpaceDetail,
  useSave: useSaveDriveSpace,
  useDelete: useDeleteDriveSpaces,
} = createResourceQueries(driveSpaceContract, {
  // 新建 / 更新协作空间：侧栏「我的空间」与成员（新建时可带成员）一并刷新
  onSaved: (qc, saved) => {
    void qc.invalidateQueries({ queryKey: contractKey(driveSpaceContract.my) });
    void qc.invalidateQueries({ queryKey: contractKey(driveSpaceContract.members, { params: { id: saved.id } }) });
  },
  onDeleted: (qc) => {
    void qc.invalidateQueries({ queryKey: contractKey(driveSpaceContract.my) });
  },
});

// ─── query keys ──────────────────────────────────────────────────────────────

const nodeListPrefix = contractKey(driveNodeContract.list);
const nodeActivitiesPrefix = contractKey(driveNodeContract.activities);
const publicMetaPrefix = contractKey(drivePublicShareContract.meta);
const publicChildrenPrefix = contractKey(drivePublicShareContract.children);

/** 工作台各列表视图的 key 前缀（`links` 为我的外链） */
const VIEW_KEYS = {
  shared: contractKey(driveNodeContract.sharedWithMe),
  starred: contractKey(driveNodeContract.starred),
  recent: contractKey(driveNodeContract.recent),
  recycle: contractKey(driveNodeContract.recycle),
  search: contractKey(driveNodeContract.search),
  links: contractKey(driveShareLinkContract.list),
} as const;

export type DriveViewKey = keyof typeof VIEW_KEYS;

/** 节点自身变化会波及的个人视图（列表项形态含节点字段） */
const NODE_VIEW_KEYS = [VIEW_KEYS.shared, VIEW_KEYS.starred, VIEW_KEYS.recent, VIEW_KEYS.recycle, VIEW_KEYS.search];

export const driveKeys = {
  spaces: driveSpaceKeys.all,
  mySpaces: contractKey(driveSpaceContract.my),
  spaceLists: driveSpaceKeys.lists,
  /** 全部空间详情的公共前缀 */
  spaceDetails: [...driveSpaceKeys.all, 'detail'] as const,
  spaceDetail: driveSpaceKeys.detail,
  spaceMembers: (id: number | undefined) => contractKey(driveSpaceContract.members, { params: { id: id ?? 0 } }),
  dirs: nodeListPrefix,
  dir: (spaceId: number | undefined, parentId: number | null | undefined) => [...nodeListPrefix, spaceId ?? 0, parentId ?? 0] as const,
  dirList: (spaceId: number | undefined, parentId: number | null | undefined, params: object) => [...nodeListPrefix, spaceId ?? 0, parentId ?? 0, params] as const,
  node: (id: number | undefined) => contractKey(driveNodeContract.detail, { params: { id: id ?? 0 } }),
  permissions: (id: number | undefined) => contractKey(driveNodeContract.permissions, { params: { id: id ?? 0 } }),
  versions: (id: number | undefined) => contractKey(driveNodeContract.versions, { params: { id: id ?? 0 } }),
  activitiesOf: (id: number | undefined) => [...nodeActivitiesPrefix, id ?? 0] as const,
  activities: (id: number | undefined, params: object) => [...nodeActivitiesPrefix, id ?? 0, params] as const,
  comments: (id: number | undefined) => contractKey(driveNodeContract.comments, { params: { id: id ?? 0 } }),
  nodeShareLinks: (id: number | undefined) => contractKey(driveNodeContract.shareLinks, { params: { id: id ?? 0 } }),
  viewOf: (name: DriveViewKey) => VIEW_KEYS[name],
  shareLinks: VIEW_KEYS.links,
  tags: (spaceId: number | undefined) => contractKey(driveTagContract.list, { query: { spaceId: spaceId ?? 0 } }),
  adminSpacesPrefix: contractKey(driveAdminContract.spaces),
  adminShareLinksPrefix: contractKey(driveAdminContract.shareLinks),
  adminActivitiesPrefix: contractKey(driveAdminContract.activities),
  adminStats: contractKey(driveAdminContract.stats),
  settings: contractKey(driveAdminContract.settings),
  publicShare: (token: string, session: string | null) => [...publicMetaPrefix, token, session] as const,
  publicChildren: (token: string, session: string | null, parentId: number | undefined) => [...publicChildrenPrefix, token, session, parentId ?? 0] as const,
};

// ─── 失效工具 ─────────────────────────────────────────────────────────────────

/** 目录内容变化：该目录的全部分页 / 排序变体 */
export function invalidateDir(qc: QueryClient, spaceId: number, parentId: number | null) {
  void qc.invalidateQueries({ queryKey: driveKeys.dir(spaceId, parentId) });
}

function invalidateNodeViews(qc: QueryClient) {
  for (const queryKey of NODE_VIEW_KEYS) void qc.invalidateQueries({ queryKey });
}

/** 节点自身变化（重命名 / 锁 / 标签 / 版本）：详情 + 所在目录 + 个人视图（收藏 / 最近 / 搜索的列表项） */
function invalidateNodeSurface(qc: QueryClient, node: NodeRef) {
  void qc.invalidateQueries({ queryKey: driveKeys.node(node.id) });
  invalidateDir(qc, node.spaceId, node.parentId);
  invalidateNodeViews(qc);
}

/** 容量变化：我的空间侧栏与空间详情的 usedBytes */
function invalidateUsage(qc: QueryClient, spaceId: number) {
  void qc.invalidateQueries({ queryKey: driveKeys.mySpaces });
  void qc.invalidateQueries({ queryKey: driveKeys.spaceDetail(spaceId) });
  void qc.invalidateQueries({ queryKey: driveKeys.spaceLists });
}

/** 所有空间的用量 / 生效配额都可能变化（彻底删除、默认配额调整） */
function invalidateAllSpaces(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: driveKeys.mySpaces });
  void qc.invalidateQueries({ queryKey: driveKeys.spaceLists });
  void qc.invalidateQueries({ queryKey: driveKeys.spaceDetails });
}

// ─── 空间成员 / 转让 ──────────────────────────────────────────────────────────

export function useMyDriveSpaces() {
  return useApiQuery(driveSpaceContract.my, { staleTime: 60_000 });
}

export function useDriveSpaceMembers(spaceId: number | undefined, enabled = true) {
  return useApiQuery(driveSpaceContract.members, { params: { id: spaceId ?? 0 } }, { enabled: enabled && spaceId !== undefined });
}

/** 保存成员：成员子键 + 列表（memberCount）+ 我的空间（myRole 可能变化）+ 详情 */
export function useSaveDriveSpaceMembers() {
  return useApiMutation(driveSpaceContract.saveMembers, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: driveKeys.spaceMembers(params.id) });
      void qc.invalidateQueries({ queryKey: driveKeys.spaceLists });
      void qc.invalidateQueries({ queryKey: driveKeys.mySpaces });
      void qc.invalidateQueries({ queryKey: driveKeys.spaceDetail(params.id) });
    },
  });
}

export function useTransferDriveSpace() {
  return useApiMutation(driveSpaceContract.transfer, {
    invalidate: (qc, saved) => {
      void qc.invalidateQueries({ queryKey: driveKeys.spaceDetail(saved.id) });
      void qc.invalidateQueries({ queryKey: driveKeys.spaceLists });
      void qc.invalidateQueries({ queryKey: driveKeys.mySpaces });
    },
  });
}

// ─── 目录与节点 ───────────────────────────────────────────────────────────────

export function useDriveDir(params: DriveDirParams, enabled = true) {
  const { spaceId, parentId, ...rest } = params;
  return useQuery({
    queryKey: driveKeys.dirList(spaceId, parentId, rest),
    // 有 parentId 时服务端按父目录定位空间，不再需要 spaceId
    queryFn: () => api(driveNodeContract.list, { query: { ...rest, spaceId: parentId ? undefined : spaceId, parentId: parentId ?? undefined } }),
    placeholderData: keepPreviousData,
    enabled: enabled && (spaceId !== undefined || !!parentId),
  });
}

export function useDriveNode(id: number | undefined, enabled = true) {
  return useApiQuery(driveNodeContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/** 新建文件夹：只打服务端返回的父目录 */
export function useCreateDriveFolder() {
  return useApiMutation(driveNodeContract.createFolder, {
    invalidate: (qc, node) => invalidateDir(qc, node.spaceId, node.parentId),
  });
}

export function useRenameDriveNode() {
  return useApiMutation(driveNodeContract.rename, {
    invalidate: (qc, node) => invalidateNodeSurface(qc, node),
  });
}

/** 移动：源目录与目标目录都变化；节点详情的 ancestorIds / parentId 变化。源目录无法从响应反查，由调用方随变量带入 */
export function useMoveDriveNodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body }: InputOf<typeof driveNodeContract.move> & { sources: NodeRef[] }) => api(driveNodeContract.move, { body }),
    onSuccess: (_data, { body, sources }) => {
      for (const s of sources) {
        invalidateDir(qc, s.spaceId, s.parentId);
        void qc.invalidateQueries({ queryKey: driveKeys.node(s.id) });
      }
      invalidateDir(qc, body.targetSpaceId, body.targetParentId ?? null);
      invalidateNodeViews(qc);
    },
  });
}

export function useCopyDriveNodes() {
  return useApiMutation(driveNodeContract.copy, {
    invalidate: (qc, _result, { body }) => {
      invalidateDir(qc, body.targetSpaceId, body.targetParentId ?? null);
      invalidateUsage(qc, body.targetSpaceId);
    },
  });
}

/** 删除到回收站：源目录 + 回收站视图 + 个人视图；详情移除（失效会让已删除记录重拉 404） */
export function useDeleteDriveNodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ nodes }: { nodes: NodeRef[] }) => api(driveNodeContract.removeBatch, { body: { ids: nodes.map((n) => n.id) } }),
    onSuccess: (_data, { nodes }) => {
      for (const n of nodes) {
        qc.removeQueries({ queryKey: driveKeys.node(n.id) });
        invalidateDir(qc, n.spaceId, n.parentId);
      }
      invalidateNodeViews(qc);
    },
  });
}

export function useDriveRecycle(params: DriveRecycleParams, enabled = true) {
  return useApiQuery(driveNodeContract.recycle, { query: params }, { placeholderData: keepPreviousData, enabled });
}

/** 还原：回收站视图 + 目标目录（原目录或空间根，目录键无法逐一定位，故失效全部目录缓存） */
export function useRestoreDriveNodes() {
  return useApiMutation(driveNodeContract.restore, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: driveKeys.viewOf('recycle') });
      void qc.invalidateQueries({ queryKey: driveKeys.dirs });
    },
  });
}

/** 彻底删除所选；ids 为空时清空回收站（可按空间）。释放配额：所有空间用量都可能变化 */
export function usePurgeDriveNodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, spaceId }: { ids: number[]; spaceId?: number }) =>
      (ids.length ? api(driveNodeContract.purge, { body: { ids } }) : api(driveNodeContract.emptyRecycle, { query: { spaceId } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: driveKeys.viewOf('recycle') });
      invalidateAllSpaces(qc);
    },
  });
}

export function useDriveStarred(params: DriveViewParams, enabled = true) {
  return useApiQuery(driveNodeContract.starred, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useDriveRecent(params: DriveViewParams, enabled = true) {
  return useApiQuery(driveNodeContract.recent, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useDriveSharedWithMe(params: DriveViewParams, enabled = true) {
  return useApiQuery(driveNodeContract.sharedWithMe, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useDriveSearch(params: DriveSearchParams, enabled = true) {
  return useApiQuery(driveNodeContract.search, { query: params }, { placeholderData: keepPreviousData, enabled: enabled && !!params.keyword });
}

/** 收藏：详情 isStarred + 收藏视图 + 所在目录的 isStarred 列 */
export function useStarDriveNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ node, starred }: { node: NodeRef; starred: boolean }) =>
      (starred ? api(driveNodeContract.star, { params: { id: node.id } }) : api(driveNodeContract.unstar, { params: { id: node.id } })),
    onSuccess: (_data, { node }) => invalidateNodeSurface(qc, node),
  });
}

// ─── 授权 ─────────────────────────────────────────────────────────────────────

export function useDriveNodePermissions(id: number | undefined, enabled = true) {
  return useApiQuery(driveNodeContract.permissions, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/** 授权变化：授权面板直接写回响应 + 与我共享视图（对被授权者）；子节点授权继承由服务端实时计算，无缓存 */
export function useSaveDriveNodePermissions() {
  return useApiMutation(driveNodeContract.savePermissions, {
    invalidate: (qc, data) => {
      qc.setQueryData(driveKeys.permissions(data.nodeId), data);
      void qc.invalidateQueries({ queryKey: driveKeys.viewOf('shared') });
    },
  });
}

export function useSetDriveNodeInherit() {
  return useApiMutation(driveNodeContract.setInherit, {
    invalidate: (qc, data) => {
      qc.setQueryData(driveKeys.permissions(data.nodeId), data);
      void qc.invalidateQueries({ queryKey: driveKeys.node(data.nodeId) });
      void qc.invalidateQueries({ queryKey: driveKeys.dirs });
    },
  });
}

// ─── 版本 ─────────────────────────────────────────────────────────────────────

export function useDriveNodeVersions(id: number | undefined, enabled = true) {
  return useApiQuery(driveNodeContract.versions, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

function invalidateVersionSurface(qc: QueryClient, node: NodeRef) {
  void qc.invalidateQueries({ queryKey: driveKeys.versions(node.id) });
  invalidateNodeSurface(qc, node);
  invalidateUsage(qc, node.spaceId);
}

interface UploadVersionVariables {
  id: number;
  file: File;
  comment?: string;
  onProgress?: (percent: number) => void;
}

/** 上传新版本：带上传进度，故走 XHR 表单通道而非 api() */
export function useUploadDriveNodeVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file, comment, onProgress }: UploadVersionVariables) => {
      const fd = new FormData();
      fd.append('file', file);
      if (comment) fd.append('comment', comment);
      return request.postForm<OutputOf<typeof driveNodeContract.uploadVersion>>(urlOf(driveNodeContract.uploadVersion, { params: { id } }), fd, { onProgress }).then(unwrap);
    },
    onSuccess: (node) => invalidateVersionSurface(qc, node),
  });
}

export function useRestoreDriveNodeVersion() {
  return useApiMutation(driveNodeContract.restoreVersion, {
    invalidate: (qc, node) => invalidateVersionSurface(qc, node),
  });
}

/** 删除历史版本只返回提示文案，所在目录 / 空间由调用方随变量带入 */
export function useDeleteDriveNodeVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ node, version }: { node: NodeRef; version: number }) => api(driveNodeContract.removeVersion, { params: { id: node.id, version } }),
    onSuccess: (_data, { node }) => invalidateVersionSurface(qc, node),
  });
}

// ─── 动态 / 评论 / 标签 / 锁 ──────────────────────────────────────────────────

export function useDriveNodeActivities(id: number | undefined, params: DrivePageParams, enabled = true) {
  return useQuery({
    queryKey: driveKeys.activities(id, params),
    queryFn: () => api(driveNodeContract.activities, { params: { id: id ?? 0 }, query: params }),
    placeholderData: keepPreviousData,
    enabled: enabled && id !== undefined,
  });
}

export function useDriveNodeComments(id: number | undefined, enabled = true) {
  return useApiQuery(driveNodeContract.comments, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/** 评论会同时进入节点动态时间线 */
export function useCreateDriveNodeComment() {
  return useApiMutation(driveNodeContract.createComment, {
    invalidate: (qc, _comment, { params }) => {
      void qc.invalidateQueries({ queryKey: driveKeys.comments(params.id) });
      void qc.invalidateQueries({ queryKey: driveKeys.activitiesOf(params.id) });
    },
  });
}

export function useDeleteDriveNodeComment() {
  return useApiMutation(driveNodeContract.removeComment, {
    invalidate: (qc, _data, { params }) => void qc.invalidateQueries({ queryKey: driveKeys.comments(params.id) }),
  });
}

export function useDriveTags(spaceId: number | undefined, enabled = true) {
  return useApiQuery(driveTagContract.list, { query: { spaceId: spaceId ?? 0 } }, { staleTime: LOOKUP_STALE_TIME, enabled: enabled && spaceId !== undefined });
}

/** 标签变化会影响已打标节点的展示（目录列表的标签列） */
function invalidateTagSurface(qc: QueryClient, spaceId: number) {
  void qc.invalidateQueries({ queryKey: driveKeys.tags(spaceId) });
  void qc.invalidateQueries({ queryKey: driveKeys.dirs });
}

export function useCreateDriveTag() {
  return useApiMutation(driveTagContract.create, {
    invalidate: (qc, tag) => invalidateTagSurface(qc, tag.spaceId),
  });
}

export function useUpdateDriveTag() {
  return useApiMutation(driveTagContract.update, {
    invalidate: (qc, tag) => invalidateTagSurface(qc, tag.spaceId),
  });
}

/** 删除标签只返回提示文案，所属空间由调用方随变量带入 */
export function useDeleteDriveTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number; spaceId: number }) => api(driveTagContract.remove, { params: { id } }),
    onSuccess: (_data, { spaceId }) => invalidateTagSurface(qc, spaceId),
  });
}

export function useSetDriveNodeTags() {
  return useApiMutation(driveNodeContract.setTags, {
    invalidate: (qc, node) => invalidateNodeSurface(qc, node),
  });
}

/** 签出锁定 / 解除锁定：两个操作共用一个 mutation，按 lock 分流 */
export function useLockDriveNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lock, minutes }: { id: number; lock: boolean; minutes?: number }) =>
      (lock ? api(driveNodeContract.lock, { params: { id }, body: { minutes } }) : api(driveNodeContract.unlock, { params: { id } })),
    onSuccess: (node) => invalidateNodeSurface(qc, node),
  });
}

// ─── 打包下载 ─────────────────────────────────────────────────────────────────

type BatchDownloadTask = OutputOf<typeof driveNodeContract.batchDownload>;

/** 同步 zip 直接触发浏览器下载；超阈值时服务端返回任务 JSON。混合响应无法走 api()，用原始 fetch 按 content-type 分流 */
export async function batchDownloadDriveNodes(ids: number[]): Promise<{ mode: 'sync' } | BatchDownloadTask | null> {
  const res = await request.fetchRaw(urlOf(driveNodeContract.batchDownload), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res) return null;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await res.json() as { code: number; message: string; data: BatchDownloadTask | null };
    if (body.code !== 0) throw new Error(body.message || '打包失败');
    return body.data ?? { mode: 'task', taskId: null };
  }
  if (!res.ok) throw new Error('打包失败');
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : `drive_${Date.now()}.zip`;
  const { downloadBlob } = await import('@/utils/download');
  downloadBlob(blob, filename);
  return { mode: 'sync' };
}

// ─── 外链 ─────────────────────────────────────────────────────────────────────

export function useDriveNodeShareLinks(id: number | undefined, enabled = true) {
  return useApiQuery(driveNodeContract.shareLinks, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useMyDriveShareLinks(params: DriveShareLinkListParams, enabled = true) {
  return useApiQuery(driveShareLinkContract.list, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useDriveShareAccessLogs(shareId: number | undefined, params: DrivePageParams, enabled = true) {
  return useApiQuery(driveShareLinkContract.accessLogs, { params: { id: shareId ?? 0 }, query: params }, {
    placeholderData: keepPreviousData,
    enabled: enabled && shareId !== undefined,
  });
}

/** 外链变化：节点外链面板 + 我的外链 + 节点详情（shareLinkCount）+ 治理页外链列表 */
function invalidateShareLinks(qc: QueryClient, nodeId: number) {
  void qc.invalidateQueries({ queryKey: driveKeys.nodeShareLinks(nodeId) });
  void qc.invalidateQueries({ queryKey: driveKeys.shareLinks });
  void qc.invalidateQueries({ queryKey: driveKeys.node(nodeId) });
  void qc.invalidateQueries({ queryKey: driveKeys.adminShareLinksPrefix });
}

export function useCreateDriveShareLink() {
  return useApiMutation(driveNodeContract.createShareLink, {
    invalidate: (qc, link) => invalidateShareLinks(qc, link.nodeId),
  });
}

export function useUpdateDriveShareLink() {
  return useApiMutation(driveShareLinkContract.update, {
    invalidate: (qc, link) => invalidateShareLinks(qc, link.nodeId),
  });
}

/** 撤销 / 删除只返回提示文案，nodeId 由调用方随变量带入以精确失效节点外链面板 */
export function useRevokeDriveShareLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number; nodeId: number }) => api(driveShareLinkContract.revoke, { params: { id } }),
    onSuccess: (_data, { nodeId }) => invalidateShareLinks(qc, nodeId),
  });
}

export function useDeleteDriveShareLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number; nodeId: number }) => api(driveShareLinkContract.remove, { params: { id } }),
    onSuccess: (_data, { nodeId }) => invalidateShareLinks(qc, nodeId),
  });
}

// ─── 公开外链（匿名） ─────────────────────────────────────────────────────────
// 公开端点的 401 表示「密码错误 / 会话失效」，必须 skipAuth 以免触发管理员 token 刷新与退出登录。

const PUBLIC_REQUEST = { skipAuth: true, silent: true } as const;

function sessionHeaders(session: string | null) {
  return session ? { session } : undefined;
}

export function useDrivePublicShare(token: string | undefined, session: string | null) {
  return useQuery({
    queryKey: driveKeys.publicShare(token ?? '', session),
    queryFn: () => api(drivePublicShareContract.meta, { params: { token: token ?? '' } }, { ...PUBLIC_REQUEST, headers: sessionHeaders(session) }),
    enabled: !!token,
    retry: false,
  });
}

export function accessDrivePublicShare(token: string, password?: string) {
  return api(drivePublicShareContract.access, { params: { token }, body: { password } }, PUBLIC_REQUEST);
}

export function useDrivePublicChildren(token: string | undefined, session: string | null, parentId: number | undefined) {
  return useQuery({
    queryKey: driveKeys.publicChildren(token ?? '', session, parentId),
    queryFn: () => api(drivePublicShareContract.children, { params: { token: token ?? '' }, query: { parentId } }, { ...PUBLIC_REQUEST, headers: sessionHeaders(session) }),
    enabled: !!token && !!session,
    retry: false,
  });
}

/** 公开内容地址（附带会话查询串，供 <a download> / 预览层直接访问） */
export function drivePublicContentUrl(token: string, nodeId: number, session: string, download = false): string {
  return urlOf(drivePublicShareContract.content, { params: { token, nodeId }, query: { session, download: download ? true : undefined } });
}

/** 转存到我的网盘：外链访问会话经 header 传递 */
export function useSaveFromDriveShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ params, body, session }: InputOf<typeof drivePublicShareContract.save> & { session: string }) =>
      api(drivePublicShareContract.save, { params, body }, { headers: { session } }),
    onSuccess: (_data, { body }) => {
      invalidateDir(qc, body.targetSpaceId, body.targetParentId ?? null);
      invalidateUsage(qc, body.targetSpaceId);
    },
  });
}

// ─── 管理 ─────────────────────────────────────────────────────────────────────

export function useDriveAdminSpaces(params: DriveAdminSpaceParams, enabled = true) {
  return useApiQuery(driveAdminContract.spaces, { query: params }, { placeholderData: keepPreviousData, enabled });
}

/** 治理空间会改变生效配额 / 状态 / 所有者：治理列表、该空间详情、共享空间列表、我的空间与统计一并刷新 */
function invalidateAdminSpaceSurface(qc: QueryClient, spaceId?: number) {
  void qc.invalidateQueries({ queryKey: driveKeys.adminSpacesPrefix });
  if (spaceId !== undefined) void qc.invalidateQueries({ queryKey: driveKeys.spaceDetail(spaceId) });
  void qc.invalidateQueries({ queryKey: driveKeys.spaceLists });
  void qc.invalidateQueries({ queryKey: driveKeys.mySpaces });
  void qc.invalidateQueries({ queryKey: driveKeys.adminStats });
}

export function useAdminUpdateDriveSpace() {
  return useApiMutation(driveAdminContract.updateSpace, {
    invalidate: (qc, saved) => invalidateAdminSpaceSurface(qc, saved.id),
  });
}

export function useCreateDepartmentDriveSpace() {
  return useApiMutation(driveAdminContract.createDepartmentSpace, {
    invalidate: (qc) => invalidateAdminSpaceSurface(qc),
  });
}

export function useAdminDeleteDriveSpace() {
  return useApiMutation(driveAdminContract.removeSpace, {
    invalidate: (qc, _data, { params }) => {
      qc.removeQueries({ queryKey: driveKeys.spaceDetail(params.id) });
      invalidateAdminSpaceSurface(qc);
    },
  });
}

/** 容量重算 / 索引补建走任务中心：结果由任务托盘反馈，完成后用量需刷新 */
export function useSubmitDriveAdminTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, spaceId }: { kind: 'recalc' | 'reindex'; spaceId?: number }) =>
      (kind === 'recalc' ? api(driveAdminContract.recalcUsage, { body: { spaceId } }) : api(driveAdminContract.reindex, { body: { spaceId } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: driveKeys.adminSpacesPrefix }),
  });
}

export function useDriveAdminShareLinks(params: DriveAdminShareLinkParams, enabled = true) {
  return useApiQuery(driveAdminContract.shareLinks, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useAdminRevokeDriveShareLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number; nodeId: number }) => api(driveAdminContract.revokeShareLink, { params: { id } }),
    onSuccess: (_data, { nodeId }) => {
      invalidateShareLinks(qc, nodeId);
      void qc.invalidateQueries({ queryKey: driveKeys.adminStats });
    },
  });
}

export function useDriveAdminActivities(params: DriveAdminActivityParams, enabled = true) {
  return useApiQuery(driveAdminContract.activities, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useDriveAdminStats(enabled = true) {
  return useApiQuery(driveAdminContract.stats, { enabled });
}

export function useDriveSettings(enabled = true) {
  return useApiQuery(driveAdminContract.settings, { enabled });
}

/** 保存设置直接写回响应；默认配额变化影响空间生效配额展示 */
export function useSaveDriveSettings() {
  return useApiMutation(driveAdminContract.saveSettings, {
    invalidate: (qc, settings) => {
      qc.setQueryData(driveKeys.settings, settings);
      invalidateAllSpaces(qc);
      void qc.invalidateQueries({ queryKey: driveKeys.adminSpacesPrefix });
    },
  });
}
