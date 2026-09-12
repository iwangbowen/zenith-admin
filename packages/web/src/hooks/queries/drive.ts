import { useEffect } from 'react';
// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { InputOf, OutputOf, QueryOf } from '@zenith/shared/core';
import {
  DRIVE_PRESENCE_HEARTBEAT_SECONDS,
  driveAccessRequestContract,
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
import { chunkedUpload, type ChunkedUploadEndpoints } from '@/utils/chunked-upload';
import { useMySettings, useSaveSettings, useSettings } from './settings';

/** 网盘自有的分片上传接口（init / chunk / complete / status / abort），由契约派生；目录上传队列与新版本面板共用 */
export const DRIVE_UPLOAD_ENDPOINTS: ChunkedUploadEndpoints = {
  init: urlOf(driveNodeContract.uploadInit),
  chunk: urlOf(driveNodeContract.uploadChunk),
  complete: urlOf(driveNodeContract.uploadComplete),
  status: (uploadId) => urlOf(driveNodeContract.uploadStatus, { params: { uploadId } }),
  abort: (uploadId) => urlOf(driveNodeContract.uploadAbort, { params: { uploadId } }),
};

/**
 * 企业网盘域 hooks。
 *
 * key 分层（失效连坐面）——全部由 `contractKey(op, input)` 派生，子资源各自独立命名空间：
 * - 空间走 `createResourceQueries(driveSpaceContract)`；`my` / `members` 子键由契约操作名派生
 * - 目录内容是 `list` 操作的 `{ query }` 变体：`invalidateQueries` 对 key 里的对象段按子集匹配
 *   （TanStack `partialMatchKey`），因此 `{ query: { parentId } }` 即「该目录的全部分页 / 排序变体」，
 *   `{ query: { spaceId } }` 即「该空间的全部目录」——增删改移只打对应目录，不打全站
 * - 节点详情与子资源（授权 / 版本 / 动态 / 评论 / 外链 / 在线）按契约操作名 + `{ params: { id } }` 分组
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
export type DriveAccessRequestParams = NonNullable<QueryOf<typeof driveAccessRequestContract.list>>;

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

/**
 * 目录内容请求的 query 段。有 parentId 时服务端按父目录定位空间、忽略 spaceId，
 * 但 spaceId 仍随请求带上：目录键因此携带空间维度，标签等空间级变化可用 `dirsOf(spaceId)` 精确失效。
 */
function dirQuery({ spaceId, parentId, ...rest }: DriveDirParams) {
  return { ...rest, spaceId, parentId: parentId ?? undefined };
}

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
  /** 全部目录列表 */
  dirs: contractKey(driveNodeContract.list),
  /** 某空间的全部目录列表（根级与子目录的请求都带 spaceId） */
  dirsOf: (spaceId: number) => contractKey(driveNodeContract.list, { query: { spaceId } }),
  /**
   * 某目录的全部分页 / 排序变体。子目录由 parentId 唯一确定；
   * 根级显式写 `parentId: undefined`，子集匹配时只命中没有 parentId 的请求，不会连坐同空间子目录
   */
  dir: (spaceId: number | undefined, parentId: number | null | undefined) =>
    contractKey(driveNodeContract.list, { query: parentId ? { parentId } : { spaceId, parentId: undefined } }),
  /** `useDriveDir(params)` 的精确 key */
  dirList: (params: DriveDirParams) => contractKey(driveNodeContract.list, { query: dirQuery(params) }),
  node: (id: number | undefined) => contractKey(driveNodeContract.detail, { params: { id: id ?? 0 } }),
  permissions: (id: number | undefined) => contractKey(driveNodeContract.permissions, { params: { id: id ?? 0 } }),
  versions: (id: number | undefined) => contractKey(driveNodeContract.versions, { params: { id: id ?? 0 } }),
  /** 某节点动态的全部分页（`query: {}` 对任何分页参数都子集匹配） */
  activitiesOf: (id: number | undefined) => contractKey(driveNodeContract.activities, { params: { id: id ?? 0 }, query: {} }),
  activities: (id: number | undefined, params: DrivePageParams) => contractKey(driveNodeContract.activities, { params: { id: id ?? 0 }, query: params }),
  comments: (id: number | undefined) => contractKey(driveNodeContract.comments, { params: { id: id ?? 0 } }),
  nodeShareLinks: (id: number | undefined) => contractKey(driveNodeContract.shareLinks, { params: { id: id ?? 0 } }),
  viewOf: (name: DriveViewKey) => VIEW_KEYS[name],
  shareLinks: VIEW_KEYS.links,
  tags: (spaceId: number | undefined) => contractKey(driveTagContract.list, { query: { spaceId: spaceId ?? 0 } }),
  adminSpacesPrefix: contractKey(driveAdminContract.spaces),
  adminShareLinksPrefix: contractKey(driveAdminContract.shareLinks),
  adminActivitiesPrefix: contractKey(driveAdminContract.activities),
  adminStats: contractKey(driveAdminContract.stats),
  adminShareAccessLogsPrefix: contractKey(driveAdminContract.shareAccessLogs),
  adminLegalHoldsPrefix: contractKey(driveAdminContract.legalHolds),
  adminQuotaRequestsPrefix: contractKey(driveAdminContract.quotaRequests),
  adminOpenGrantsPrefix: contractKey(driveAdminContract.openGrants),
  /** 公开外链元信息 / 子目录：响应随访问会话（请求头，非契约输入）变化，契约 key 后追加会话段 */
  publicShare: (token: string, session: string | null) => [...contractKey(drivePublicShareContract.meta, { params: { token } }), session] as const,
  publicChildren: (token: string, session: string | null, parentId: number | undefined) =>
    [...contractKey(drivePublicShareContract.children, { params: { token }, query: { parentId } }), session] as const,
  accessRequestsPrefix: contractKey(driveAccessRequestContract.list),
  accessRequestPending: contractKey(driveAccessRequestContract.pendingCount),
  accessTarget: (id: number | undefined) => contractKey(driveAccessRequestContract.target, { params: { id: id ?? 0 } }),
  /** 在线用户列表由心跳接口返回（上报并回读），key 取心跳操作 */
  presence: (id: number | undefined) => contractKey(driveNodeContract.heartbeat, { params: { id: id ?? 0 } }),
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

// ─── 归档 / 扩容申请（阶段 4 治理）───────────────────────────────────────────

/** 归档 / 恢复：侧栏（归档不进侧栏）、列表、详情与治理列表一并刷新 */
function invalidateArchiveSurface(qc: QueryClient, spaceId: number) {
  void qc.invalidateQueries({ queryKey: driveKeys.spaceDetail(spaceId) });
  void qc.invalidateQueries({ queryKey: driveKeys.spaceLists });
  void qc.invalidateQueries({ queryKey: driveKeys.mySpaces });
  void qc.invalidateQueries({ queryKey: driveKeys.adminSpacesPrefix });
  void qc.invalidateQueries({ queryKey: driveKeys.dirs });
}

export function useArchiveDriveSpace() {
  return useApiMutation(driveSpaceContract.archive, { invalidate: (qc, saved) => invalidateArchiveSurface(qc, saved.id) });
}

export function useUnarchiveDriveSpace() {
  return useApiMutation(driveSpaceContract.unarchive, { invalidate: (qc, saved) => invalidateArchiveSurface(qc, saved.id) });
}

export function useSpaceQuotaRequests(spaceId: number | undefined, enabled = true) {
  return useApiQuery(driveSpaceContract.quotaRequests, { params: { id: spaceId ?? 0 } }, { enabled: enabled && spaceId !== undefined });
}

export function useRequestDriveQuota() {
  return useApiMutation(driveSpaceContract.requestQuota, {
    invalidate: (qc, saved) => {
      void qc.invalidateQueries({ queryKey: contractKey(driveSpaceContract.quotaRequests, { params: { id: saved.spaceId } }) });
      void qc.invalidateQueries({ queryKey: driveKeys.adminQuotaRequestsPrefix });
    },
  });
}

// ─── 站内互通 ─────────────────────────────────────────────────────────────────

/** 以卡片消息把节点链接发到聊天会话；仅写入链接，不改变节点，无需失效缓存 */
export function useSendDriveNodeToChat() {
  return useApiMutation(driveNodeContract.sendToChat);
}

// ─── 目录与节点 ───────────────────────────────────────────────────────────────

export function useDriveDir(params: DriveDirParams, enabled = true) {
  return useApiQuery(driveNodeContract.list, { query: dirQuery(params) }, {
    placeholderData: keepPreviousData,
    enabled: enabled && (params.spaceId !== undefined || !!params.parentId),
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

/** 移动：源目录与目标目录都变化；节点详情的 ancestorIds / parentId 变化。响应为空，源目录无法反查，由调用方随变量带入 */
export type MoveDriveNodesVariables = InputOf<typeof driveNodeContract.move> & { sources: NodeRef[] };

export function useMoveDriveNodes() {
  return useApiMutation<typeof driveNodeContract.move, MoveDriveNodesVariables>(driveNodeContract.move, {
    invalidate: (qc, _data, { body, sources }) => {
      for (const s of sources) {
        invalidateDir(qc, s.spaceId, s.parentId);
        void qc.invalidateQueries({ queryKey: driveKeys.node(s.id) });
        invalidateUsage(qc, s.spaceId);
      }
      invalidateUsage(qc, body.targetSpaceId);
      if (sources.some((source) => source.spaceId !== body.targetSpaceId)) {
        // 跨空间移动会改写全部后代的 ACL 与位置，不止所选根节点
        void qc.invalidateQueries({ queryKey: contractKey(driveNodeContract.detail) });
        void qc.invalidateQueries({ queryKey: contractKey(driveNodeContract.permissions) });
        void qc.invalidateQueries({ queryKey: driveKeys.shareLinks });
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

/** 删除到回收站：源目录 + 回收站视图 + 个人视图；详情移除（失效会让已删除记录重拉 404）。响应为空，所在目录由调用方随变量带入 */
export type DeleteDriveNodesVariables = InputOf<typeof driveNodeContract.removeBatch> & { sources: NodeRef[] };

/** 由待删除节点构造变量：ids 进请求体，节点引用留给失效 */
export function deleteDriveNodesVariables(nodes: NodeRef[]): DeleteDriveNodesVariables {
  return { body: { ids: nodes.map((n) => n.id) }, sources: nodes };
}

export function useDeleteDriveNodes() {
  return useApiMutation<typeof driveNodeContract.removeBatch, DeleteDriveNodesVariables>(driveNodeContract.removeBatch, {
    invalidate: (qc, _data, { sources }) => {
      for (const n of sources) {
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

/** 彻底删除所选与清空回收站都释放配额：回收站视图 + 所有空间的用量 */
function invalidatePurgeSurface(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: driveKeys.viewOf('recycle') });
  invalidateAllSpaces(qc);
}

/** 彻底删除所选 */
export function usePurgeDriveNodes() {
  return useApiMutation(driveNodeContract.purge, { invalidate: invalidatePurgeSurface });
}

/** 清空回收站（可按空间） */
export function useEmptyDriveRecycle() {
  return useApiMutation(driveNodeContract.emptyRecycle, { invalidate: invalidatePurgeSurface });
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

/** 收藏 / 取消收藏：详情 isStarred + 收藏视图 + 所在目录的 isStarred 列。响应为空，节点引用由调用方随变量带入 */
export type StarDriveNodeVariables = InputOf<typeof driveNodeContract.star> & { node: NodeRef };

export function useStarDriveNode() {
  return useApiMutation<typeof driveNodeContract.star, StarDriveNodeVariables>(driveNodeContract.star, {
    invalidate: (qc, _data, { node }) => invalidateNodeSurface(qc, node),
  });
}

export function useUnstarDriveNode() {
  return useApiMutation<typeof driveNodeContract.unstar, StarDriveNodeVariables>(driveNodeContract.unstar, {
    invalidate: (qc, _data, { node }) => invalidateNodeSurface(qc, node),
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

/** 上传新版本：带上传进度，故走 XHR 表单通道而非 api()（H5：带进度回调的上传） */
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

interface UploadVersionChunkedVariables {
  node: Pick<DriveNode, 'id' | 'spaceId'>;
  file: File;
  /** 客户端预先算好的 SHA-256；服务端 complete 时按实际内容核验 */
  contentHash?: string;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

/** 超过分片阈值的新版本：分片 init 带 nodeId，服务端落为该节点的新版本（H5：init / chunk / complete 多步上传，带进度） */
export function useUploadDriveNodeVersionChunked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ node, file, contentHash, signal, onProgress }: UploadVersionChunkedVariables) => chunkedUpload<DriveNode>(file, {
      endpoints: DRIVE_UPLOAD_ENDPOINTS,
      initExtra: { spaceId: node.spaceId, nodeId: node.id, contentHash },
      resumeScope: `drive-version:${node.id}`,
      signal,
      onProgress,
    }),
    onSuccess: (node) => invalidateVersionSurface(qc, node),
  });
}

export function useRestoreDriveNodeVersion() {
  return useApiMutation(driveNodeContract.restoreVersion, {
    invalidate: (qc, node) => invalidateVersionSurface(qc, node),
  });
}

/** 删除历史版本只返回提示文案，所在目录 / 空间由调用方随变量带入 */
export type DeleteDriveNodeVersionVariables = InputOf<typeof driveNodeContract.removeVersion> & { node: NodeRef };

export function useDeleteDriveNodeVersion() {
  return useApiMutation<typeof driveNodeContract.removeVersion, DeleteDriveNodeVersionVariables>(driveNodeContract.removeVersion, {
    invalidate: (qc, _data, { node }) => invalidateVersionSurface(qc, node),
  });
}

// ─── 动态 / 评论 / 标签 / 锁 ──────────────────────────────────────────────────

export function useDriveNodeActivities(id: number | undefined, params: DrivePageParams, enabled = true) {
  return useApiQuery(driveNodeContract.activities, { params: { id: id ?? 0 }, query: params }, {
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

/**
 * 标签变化会影响已打标节点的展示：该空间的标签下拉源、该空间全部目录列表的标签列、
 * 该空间已缓存的节点详情（按数据里的 spaceId 甄别）与个人视图的列表项。合并标签（drive-collaboration）同样复用
 */
export function invalidateDriveTagSurface(qc: QueryClient, spaceId: number) {
  void qc.invalidateQueries({ queryKey: driveKeys.tags(spaceId) });
  void qc.invalidateQueries({ queryKey: driveKeys.dirsOf(spaceId) });
  void qc.invalidateQueries({ queryKey: contractKey(driveNodeContract.detail), predicate: (query) => {
    const data = query.state.data;
    return !!data && typeof data === 'object' && 'spaceId' in data && data.spaceId === spaceId;
  } });
  invalidateNodeViews(qc);
}

export function useCreateDriveTag() {
  return useApiMutation(driveTagContract.create, {
    invalidate: (qc, tag) => invalidateDriveTagSurface(qc, tag.spaceId),
  });
}

export function useUpdateDriveTag() {
  return useApiMutation(driveTagContract.update, {
    invalidate: (qc, tag) => invalidateDriveTagSurface(qc, tag.spaceId),
  });
}

/** 删除标签只返回提示文案，所属空间由调用方随变量带入 */
export type DeleteDriveTagVariables = InputOf<typeof driveTagContract.remove> & { spaceId: number };

export function useDeleteDriveTag() {
  return useApiMutation<typeof driveTagContract.remove, DeleteDriveTagVariables>(driveTagContract.remove, {
    invalidate: (qc, _data, { spaceId }) => invalidateDriveTagSurface(qc, spaceId),
  });
}

export function useSetDriveNodeTags() {
  return useApiMutation(driveNodeContract.setTags, {
    invalidate: (qc, node) => invalidateNodeSurface(qc, node),
  });
}

/** 签出锁定 / 解除锁定都返回节点实体，按响应失效节点面（详情 lockedBy + 所在目录锁列 + 个人视图） */
export function useLockDriveNode() {
  return useApiMutation(driveNodeContract.lock, {
    invalidate: (qc, node) => invalidateNodeSurface(qc, node),
  });
}

export function useUnlockDriveNode() {
  return useApiMutation(driveNodeContract.unlock, {
    invalidate: (qc, node) => invalidateNodeSurface(qc, node),
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

/** 撤销 / 删除 / 生成短链只返回提示文案或短链 DTO，nodeId 由调用方随变量带入以精确失效节点外链面板 */
export interface DriveShareLinkVariables {
  params: { id: number };
  nodeId: number;
}

export function useRevokeDriveShareLink() {
  return useApiMutation<typeof driveShareLinkContract.revoke, DriveShareLinkVariables>(driveShareLinkContract.revoke, {
    invalidate: (qc, _data, { nodeId }) => invalidateShareLinks(qc, nodeId),
  });
}

export function useDeleteDriveShareLink() {
  return useApiMutation<typeof driveShareLinkContract.remove, DriveShareLinkVariables>(driveShareLinkContract.remove, {
    invalidate: (qc, _data, { nodeId }) => invalidateShareLinks(qc, nodeId),
  });
}

export function useDriveCollectSubmissions(shareId: number | undefined, params: DrivePageParams, enabled = true) {
  return useApiQuery(driveShareLinkContract.submissions, { params: { id: shareId ?? 0 }, query: params }, {
    placeholderData: keepPreviousData,
    enabled: enabled && shareId !== undefined,
  });
}

/** 生成短链后外链 DTO 的 shortUrl 变化：刷新节点外链面板与我的外链 */
export function useEnsureDriveShareShortLink() {
  return useApiMutation<typeof driveShareLinkContract.shortLink, DriveShareLinkVariables>(driveShareLinkContract.shortLink, {
    invalidate: (qc, _data, { nodeId }) => invalidateShareLinks(qc, nodeId),
  });
}

// ─── 在线状态 ─────────────────────────────────────────────────────────────────

/**
 * 正在查看该节点的用户：挂载即心跳并按固定间隔续约，卸载时立即离开。
 * 走 HTTP 心跳而非 WebSocket，多实例部署下由 Redis 汇聚。
 */
export function useDriveNodePresence(nodeId: number | undefined, enabled = true) {
  const active = enabled && nodeId !== undefined;
  const query = useApiQuery(driveNodeContract.heartbeat, { params: { id: nodeId ?? 0 } }, {
    enabled: active,
    refetchInterval: DRIVE_PRESENCE_HEARTBEAT_SECONDS * 1000,
    refetchIntervalInBackground: false,
    staleTime: DRIVE_PRESENCE_HEARTBEAT_SECONDS * 1000,
    retry: false,
    requestOptions: { silent: true },
  });
  useEffect(() => {
    if (!active) return;
    return () => {
      void api(driveNodeContract.leavePresence, { params: { id: nodeId } }, { silent: true }).catch(() => undefined);
    };
  }, [active, nodeId]);
  return query;
}

// ─── 访问申请 ─────────────────────────────────────────────────────────────────

export function useDriveAccessRequests(params: DriveAccessRequestParams, enabled = true) {
  return useApiQuery(driveAccessRequestContract.list, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useDrivePendingAccessCount(enabled = true) {
  return useApiQuery(driveAccessRequestContract.pendingCount, undefined, { enabled, staleTime: 60_000, refetchInterval: 120_000, requestOptions: { silent: true } });
}

/** 无权访问节点时读取申请所需的最小信息；404 / 403 由调用方处理 */
export function useDriveAccessTarget(nodeId: number | undefined, enabled = true) {
  return useApiQuery(driveAccessRequestContract.target, { params: { id: nodeId ?? 0 } }, { enabled: enabled && nodeId !== undefined, retry: false, requestOptions: { silent: true } });
}

function invalidateAccessRequests(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: driveKeys.accessRequestsPrefix });
  void qc.invalidateQueries({ queryKey: driveKeys.accessRequestPending });
}

export function useCreateDriveAccessRequest() {
  return useApiMutation(driveAccessRequestContract.create, {
    invalidate: (qc, req) => {
      invalidateAccessRequests(qc);
      void qc.invalidateQueries({ queryKey: driveKeys.accessTarget(req.nodeId) });
    },
  });
}

export function useDecideDriveAccessRequest() {
  return useApiMutation(driveAccessRequestContract.decide, {
    invalidate: (qc, req) => {
      invalidateAccessRequests(qc);
      void qc.invalidateQueries({ queryKey: driveKeys.permissions(req.nodeId) });
    },
  });
}

export function useCancelDriveAccessRequest() {
  return useApiMutation(driveAccessRequestContract.cancel, {
    invalidate: (qc, req) => {
      invalidateAccessRequests(qc);
      void qc.invalidateQueries({ queryKey: driveKeys.accessTarget(req.nodeId) });
    },
  });
}

/** 站内预览水印文本：管理员开启后对所有登录用户生效（姓名 · 账号 · 日期） */
export function useDrivePreviewWatermark(user: { nickname?: string | null; username?: string } | null | undefined): string[] | null {
  const mySettings = useMySettings().data;
  if (!mySettings?.drive?.previewWatermarkEnabled || !user) return null;
  return [[user.nickname, user.username].filter(Boolean).join(' · '), new Date().toISOString().slice(0, 10)];
}

// ─── 公开外链（匿名） ─────────────────────────────────────────────────────────
// 公开端点的 401 表示「密码错误 / 会话失效」，必须 skipAuth 以免触发管理员 token 刷新与退出登录。
// 访问会话经 `session` 请求头传递而契约未声明该头（非契约通道），响应又随会话变化，
// 故元信息 / 子目录保留手写 useQuery（H5），key 取契约 key 追加会话段。

const PUBLIC_REQUEST = { skipAuth: true, silent: true } as const;

function sessionHeaders(session: string | null) {
  return session ? { session } : undefined;
}

export function useDrivePublicShare(token: string | undefined, session: string | null) {
  // H5：会话请求头为非契约通道且决定响应内容，需进入 key
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
  // H5：同上，会话请求头进入 key
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

/** 文件收集：匿名提交（multipart，带进度；会话经查询串传递以复用 XHR 通道） */
export function uploadToDriveCollect(
  token: string,
  session: string,
  file: File,
  fields: { submitterName?: string; submitterNote?: string },
  onProgress?: (percent: number) => void,
) {
  const fd = new FormData();
  fd.append('file', file);
  if (fields.submitterName) fd.append('submitterName', fields.submitterName);
  if (fields.submitterNote) fd.append('submitterNote', fields.submitterNote);
  const url = `${urlOf(drivePublicShareContract.upload, { params: { token } })}?session=${encodeURIComponent(session)}`;
  return request.postForm<OutputOf<typeof drivePublicShareContract.upload>>(url, fd, { ...PUBLIC_REQUEST, onProgress }).then(unwrap);
}

/** 转存到我的网盘：外链访问会话经请求头传递（契约未声明该头），随 hook 参数注入请求选项 */
export function useSaveFromDriveShare(session: string | null) {
  return useApiMutation(drivePublicShareContract.save, {
    requestOptions: { headers: sessionHeaders(session) },
    invalidate: (qc, _data, { body }) => {
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

/** 容量重算 / 索引补建走任务中心：结果由任务托盘反馈，提交后治理列表回源以显示最新用量 / 任务态 */
export function useRecalcDriveUsage() {
  return useApiMutation(driveAdminContract.recalcUsage, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: driveKeys.adminSpacesPrefix }),
  });
}

export function useReindexDrive() {
  return useApiMutation(driveAdminContract.reindex, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: driveKeys.adminSpacesPrefix }),
  });
}

export function useDriveAdminShareLinks(params: DriveAdminShareLinkParams, enabled = true) {
  return useApiQuery(driveAdminContract.shareLinks, { query: params }, { placeholderData: keepPreviousData, enabled });
}

/** 治理页撤销外链：除外链面外，统计卡的活跃外链数也变化 */
export function useAdminRevokeDriveShareLink() {
  return useApiMutation<typeof driveAdminContract.revokeShareLink, DriveShareLinkVariables>(driveAdminContract.revokeShareLink, {
    invalidate: (qc, _data, { nodeId }) => {
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

// ─── 合规治理：外链访问日志 / 法律保留 / 扩容审批 / 开放应用授权 ─────────────────

export type DriveAdminShareLogParams = NonNullable<QueryOf<typeof driveAdminContract.shareAccessLogs>>;
export type DriveLegalHoldParams = NonNullable<QueryOf<typeof driveAdminContract.legalHolds>>;
export type DriveQuotaRequestParams = NonNullable<QueryOf<typeof driveAdminContract.quotaRequests>>;

export function useDriveAdminShareAccessLogs(params: DriveAdminShareLogParams, enabled = true) {
  return useApiQuery(driveAdminContract.shareAccessLogs, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useDriveLegalHolds(params: DriveLegalHoldParams, enabled = true) {
  return useApiQuery(driveAdminContract.legalHolds, { query: params }, { placeholderData: keepPreviousData, enabled });
}

/** 法律保留变化影响节点详情的 legalHold 标记与治理列表 */
function invalidateLegalHolds(qc: QueryClient, nodeId: number) {
  void qc.invalidateQueries({ queryKey: driveKeys.adminLegalHoldsPrefix });
  void qc.invalidateQueries({ queryKey: driveKeys.node(nodeId) });
}

export function useCreateDriveLegalHold() {
  return useApiMutation(driveAdminContract.createLegalHold, { invalidate: (qc, saved) => invalidateLegalHolds(qc, saved.nodeId) });
}

export function useReleaseDriveLegalHold() {
  return useApiMutation(driveAdminContract.releaseLegalHold, { invalidate: (qc, saved) => invalidateLegalHolds(qc, saved.nodeId) });
}

export function useDriveAdminQuotaRequests(params: DriveQuotaRequestParams, enabled = true) {
  return useApiQuery(driveAdminContract.quotaRequests, { query: params }, { placeholderData: keepPreviousData, enabled });
}

/** 审批通过会改写空间显式配额：治理列表、空间详情与共享空间列表一并刷新 */
export function useDecideDriveQuotaRequest() {
  return useApiMutation(driveAdminContract.decideQuotaRequest, {
    invalidate: (qc, saved) => {
      void qc.invalidateQueries({ queryKey: driveKeys.adminQuotaRequestsPrefix });
      void qc.invalidateQueries({ queryKey: contractKey(driveSpaceContract.quotaRequests, { params: { id: saved.spaceId } }) });
      invalidateAdminSpaceSurface(qc, saved.spaceId);
    },
  });
}

export function useDriveOpenAppGrants(params: NonNullable<QueryOf<typeof driveAdminContract.openGrants>>, enabled = true) {
  return useApiQuery(driveAdminContract.openGrants, { query: params }, { enabled });
}

export function useCreateDriveOpenAppGrant() {
  return useApiMutation(driveAdminContract.createOpenGrant, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: driveKeys.adminOpenGrantsPrefix }),
  });
}

export function useRemoveDriveOpenAppGrant() {
  return useApiMutation(driveAdminContract.removeOpenGrant, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: driveKeys.adminOpenGrantsPrefix }),
  });
}

/** 网盘全局设置由运行时设置 drive 模块承载（/api/settings/drive）；返回读取信封（effective / inherited / version） */
export function useDriveSettings(enabled = true) {
  return useSettings('drive', enabled);
}

/** 保存设置：默认配额变化影响空间生效配额展示，额外失效空间列表 */
export function useSaveDriveSettings() {
  return useSaveSettings('drive', (qc) => {
    invalidateAllSpaces(qc);
    void qc.invalidateQueries({ queryKey: driveKeys.adminSpacesPrefix });
  });
}
