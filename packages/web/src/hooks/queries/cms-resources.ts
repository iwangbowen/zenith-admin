import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BodyOf, OutputOf, QueryOf } from '@zenith/shared/core';
import { cmsResourceContract, type CmsResourceFolder } from '@zenith/shared/cms';
import { api, apiQueryOptions, contractKey, urlOf, useApiMutation } from '@/lib/contract-query';
import { unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export type CmsResourceListParams = NonNullable<QueryOf<typeof cmsResourceContract.list>>;

/** 素材、文件夹与引用索引互相牵连（移动 / 删除改变文件夹计数），统一按域根失效 */
export const cmsResourceKeys = {
  all: [contractKey(cmsResourceContract.list)[0]] as const,
  lists: contractKey(cmsResourceContract.list),
  list: (params: CmsResourceListParams) => contractKey(cmsResourceContract.list, { query: params }),
  references: (id: number) => contractKey(cmsResourceContract.references, { params: { id } }),
  folders: (siteId: number | undefined) => contractKey(cmsResourceContract.folders, { query: { siteId: siteId ?? 0 } }),
};

export function useCmsResourceList(params: CmsResourceListParams, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsResourceContract.list, { query: params }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCmsResourceReferences(id: number | null) {
  return useQuery({
    ...apiQueryOptions(cmsResourceContract.references, { params: { id: id ?? 0 } }),
    enabled: id != null,
  });
}

export function useCmsResourceFolders(siteId: number | undefined) {
  return useQuery({
    ...apiQueryOptions(cmsResourceContract.folders, { query: { siteId: siteId ?? 0 } }),
    enabled: siteId !== undefined,
  });
}

export type CmsResourceFolderSaveValues = Partial<BodyOf<typeof cmsResourceContract.folderCreate>>;

export function useSaveCmsResourceFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: CmsResourceFolderSaveValues }): Promise<CmsResourceFolder> =>
      id === undefined
        ? api(cmsResourceContract.folderCreate, { body: values as BodyOf<typeof cmsResourceContract.folderCreate> })
        : api(cmsResourceContract.folderUpdate, { params: { id }, body: values }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: cmsResourceKeys.all }),
  });
}

export function useDeleteCmsResourceFolder() {
  return useApiMutation(cmsResourceContract.folderRemove, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsResourceKeys.all }),
  });
}

/** 上传素材：multipart 表单，siteId / folderId 随查询串 */
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: cmsResourceKeys.all }),
  });
}

export function useUpdateCmsResource() {
  return useApiMutation(cmsResourceContract.update, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsResourceKeys.all }),
  });
}

export function useCropCmsResource() {
  return useApiMutation(cmsResourceContract.crop, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsResourceKeys.all }),
  });
}

export function useDeleteCmsResources() {
  return useApiMutation(cmsResourceContract.batchDelete, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsResourceKeys.all }),
  });
}

export function useCmsResourceGovernance() {
  return useApiMutation(cmsResourceContract.governance);
}

/** 替换素材文件：保留素材 id，站内所有引用位置自动指向新文件 */
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: cmsResourceKeys.all }),
  });
}

/** 重建素材引用索引（存量回填 / 索引修复） */
export function useRebuildCmsResourceRefs() {
  return useApiMutation(cmsResourceContract.rebuildRefs);
}

export function useMoveCmsResources() {
  return useApiMutation(cmsResourceContract.move, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsResourceKeys.all }),
  });
}
