import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OutputOf, QueryOf } from '@zenith/shared/core';
import { mpMaterialContract } from '@zenith/shared/mp';
import { createResourceQueries, urlOf, useApiMutation } from '@/lib/contract-query';
import { unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export type MpMaterialListParams = QueryOf<typeof mpMaterialContract.list>;

export const {
  keys: mpMaterialKeys,
  useList: useMpMaterialList,
  useSave: useSaveMpMaterial,
  useDelete: useDeleteMpMaterials,
} = createResourceQueries(mpMaterialContract);

/** 同步只会改变素材列表，不会影响公众号配置或其他域缓存 */
export function useSyncMpMaterials() {
  return useApiMutation(mpMaterialContract.sync, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: mpMaterialKeys.lists }),
  });
}

interface UploadVariables {
  formData: FormData;
  onProgress?: (percent: number) => void;
}

/** 二进制素材上传：带上传进度，故走 XHR 表单通道而非 api()；成功后新增一条素材，刷新列表 */
export function useUploadMpMaterial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ formData, onProgress }: UploadVariables) =>
      request.postForm<OutputOf<typeof mpMaterialContract.upload>>(urlOf(mpMaterialContract.upload), formData, { onProgress }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: mpMaterialKeys.lists }),
  });
}
