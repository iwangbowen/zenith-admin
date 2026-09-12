import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, OutputOf, QueryOf } from '@zenith/shared/core';
import { cmsResourceContract } from '@zenith/shared/cms';
import { useSaveMutation, contractKey, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export type CmsResourceListParams = NonNullable<QueryOf<typeof cmsResourceContract.list>>;

export const cmsResourceKeys = {
  lists: contractKey(cmsResourceContract.list),
  list: (params: CmsResourceListParams) => contractKey(cmsResourceContract.list, { query: params }),
  references: (id: number) => contractKey(cmsResourceContract.references, { params: { id } }),
  /** 全部站点文件夹树的公共前缀 */
  foldersAll: contractKey(cmsResourceContract.folders),
  folders: (siteId: number | undefined) => contractKey(cmsResourceContract.folders, { query: { siteId: siteId ?? 0 } }),
};

/**
 * 素材 / 文件夹写操作（上传、编辑、裁剪、替换、移动、删除、文件夹增删改）后的失效面：
 * - 素材列表：列表项带 folderName / refCount / 缩略图，任何一项写操作都会改变某个列表页
 * - 文件夹树：节点带 resourceCount，上传 / 移动 / 删除素材与文件夹增删改都会改变计数或结构
 * 引用索引 `references(id)` 记录素材被哪些内容引用，不随素材自身字段变化，只在素材删除时移除。
 */
export function invalidateAfterCmsResourceChange(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: cmsResourceKeys.lists });
  void qc.invalidateQueries({ queryKey: cmsResourceKeys.foldersAll });
}

export function useCmsResourceList(params: CmsResourceListParams, enabled = true) {
  return useApiQuery(cmsResourceContract.list, { query: params }, {
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCmsResourceReferences(id: number | null) {
  return useApiQuery(cmsResourceContract.references, { params: { id: id ?? 0 } }, {
    enabled: id != null,
  });
}

export function useCmsResourceFolders(siteId: number | undefined) {
  return useApiQuery(cmsResourceContract.folders, { query: { siteId: siteId ?? 0 } }, {
    enabled: siteId !== undefined,
  });
}

export type CmsResourceFolderSaveValues = Partial<BodyOf<typeof cmsResourceContract.folderCreate>>;

export function useSaveCmsResourceFolder() {
  return useSaveMutation(cmsResourceContract.folderCreate, cmsResourceContract.folderUpdate, {
    invalidate: invalidateAfterCmsResourceChange,
  });
}

export function useDeleteCmsResourceFolder() {
  return useApiMutation(cmsResourceContract.folderRemove, { invalidate: invalidateAfterCmsResourceChange });
}

/**
 * 上传素材：multipart 表单，siteId / folderId 随查询串。
 * H5：mutationFn 走 `request.postForm` 表单通道而非单次 `api(op)`，故保留手写 useMutation。
 */
export function useUploadCmsResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, folderId, file }: { siteId: number; folderId?: number; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      return request
        .postForm<OutputOf<typeof cmsResourceContract.upload>>(urlOf(cmsResourceContract.upload, { query: { siteId, folderId } }), formData)
        .then(unwrap);
    },
    onSuccess: () => invalidateAfterCmsResourceChange(qc),
  });
}

export function useUpdateCmsResource() {
  return useApiMutation(cmsResourceContract.update, { invalidate: invalidateAfterCmsResourceChange });
}

/** 裁剪另存为新素材：列表新增一条、所在文件夹计数 +1 */
export function useCropCmsResource() {
  return useApiMutation(cmsResourceContract.crop, { invalidate: invalidateAfterCmsResourceChange });
}

/** 删除后引用索引不再有对应资源，移除而非失效 */
export function useDeleteCmsResources() {
  return useApiMutation(cmsResourceContract.batchDelete, {
    invalidate: (qc, _output, { body }) => {
      for (const id of body.ids) qc.removeQueries({ queryKey: cmsResourceKeys.references(id) });
      invalidateAfterCmsResourceChange(qc);
    },
  });
}

export function useCmsResourceGovernance() {
  return useApiMutation(cmsResourceContract.governance);
}

/**
 * 替换素材文件：保留素材 id，站内所有引用位置自动指向新文件（列表的 url / 大小 / 缩略图变化，引用索引不变）。
 * H5：mutationFn 走 `request.postForm` 表单通道而非单次 `api(op)`，故保留手写 useMutation。
 */
export function useReplaceCmsResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      return request
        .postForm<OutputOf<typeof cmsResourceContract.replace>>(urlOf(cmsResourceContract.replace, { params: { id } }), formData)
        .then(unwrap);
    },
    onSuccess: () => invalidateAfterCmsResourceChange(qc),
  });
}

/** 重建素材引用索引（存量回填 / 索引修复） */
export function useRebuildCmsResourceRefs() {
  return useApiMutation(cmsResourceContract.rebuildRefs);
}

/** 批量移动是异步任务，提交时先把列表与文件夹计数标脏 */
export function useMoveCmsResources() {
  return useApiMutation(cmsResourceContract.move, { invalidate: invalidateAfterCmsResourceChange });
}