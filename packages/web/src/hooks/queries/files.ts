import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OutputOf, QueryOf } from '@zenith/shared/core';
import { fileContract, UPLOAD_CHUNK_MIN_BYTES, type FileAccessPurpose, type FileAccessUrl } from '@zenith/shared/platform';
import { api, contractKey, createResourceQueries, urlOf, useApiQuery } from '@/lib/contract-query';
import { unwrap } from '@/lib/query';
import { request } from '@/utils/request';
import { useMySettings } from './settings';

export type FileListParams = QueryOf<typeof fileContract.list>;

/**
 * 分片上传阈值（字节）：来自运行时设置 files.chunkThresholdMb，超过即走分片 + 断点续传。
 * 服务端对简单上传按同一设置校验，两端不会漂移；设置尚未加载时暂按最小分片大小判定（与设置默认值一致）。
 */
export function useChunkUploadThreshold(): number {
  const files = useMySettings().data?.files;
  return files ? files.chunkThresholdMb * 1024 * 1024 : UPLOAD_CHUNK_MIN_BYTES;
}

/** 托管文件只有列表 / 详情 / 删除走标准资源形态；上传为 multipart，见下方专用 hooks */
export const {
  keys: fileKeys,
  useList: useFileList,
  useDetail: useFileDetail,
  useDelete: useDeleteFiles,
} = createResourceQueries(fileContract, {
  // 统计面板与目录浏览都按文件表汇总，删除后一并失效
  onDeleted: (qc) => {
    void qc.invalidateQueries({ queryKey: contractKey(fileContract.stats) });
    void qc.invalidateQueries({ queryKey: contractKey(fileContract.browse) });
  },
});

export function useFileStats() {
  return useApiQuery(fileContract.stats);
}

/**
 * 解析文件访问直链（presigned 每次签发新鲜 URL，故为普通函数而非 useQuery，禁止进缓存）。
 * purpose=download 时云直链会附带 attachment disposition。
 * silent：失败由调用方降级处理（fetchManagedFileBlob 回退代理），不弹全局错误 toast。
 */
export function getFileAccessUrl(id: string, purpose?: FileAccessPurpose): Promise<FileAccessUrl> {
  return api(fileContract.accessUrl, { params: { id }, query: { purpose } }, { silent: true });
}

interface UploadVariables {
  formData: FormData;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/** 多文件上传（进入文件管理列表）；带上传进度，故走 XHR 表单通道而非 api() */
export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ formData, onProgress, signal }: UploadVariables) =>
      request.postForm<OutputOf<typeof fileContract.upload>>(urlOf(fileContract.upload), formData, { onProgress, signal }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: fileKeys.all }),
  });
}

/**
 * 单文件直传——聊天附件、工作流补偿附件、头像等共用。
 * 与 useUploadFile 的区别：不进文件管理列表，故不失效 fileKeys。
 */
export function useUploadOneFile() {
  return useMutation({
    mutationFn: ({ formData, onProgress }: UploadVariables) =>
      request.postForm<OutputOf<typeof fileContract.uploadOne>>(urlOf(fileContract.uploadOne), formData, { onProgress, silent: true }).then(unwrap),
  });
}
