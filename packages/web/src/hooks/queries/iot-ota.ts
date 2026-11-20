// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { OutputOf, QueryOf } from '@zenith/shared/core';
import { iotFirmwareContract, iotOtaTaskContract, type InitIotFirmwareUploadInput, type IotFirmware, type IotOtaTask } from '@zenith/shared/iot';
import { fileContract } from '@zenith/shared/platform';
import { invalidateEntityRelations } from '@/lib/entity-relation-cache';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';
import { api, contractKey, createResourceQueries, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { uploadBusinessFile, type BusinessUploadEndpoints } from '@/utils/business-upload';
import { useChunkUploadThreshold } from './files';

// ─── 固件包 ───────────────────────────────────────────────────────────────────
export type IotFirmwareListParams = NonNullable<QueryOf<typeof iotFirmwareContract.list>>;

/** 固件只有列表 / 更新 / 删除走标准资源形态；上传为 multipart，见下方专用 hook */
export const {
  keys: iotFirmwareKeys,
  useList: useIotFirmwareList,
  useDetail: useIotFirmwareDetail,
  useSave: useSaveIotFirmware,
  useDelete: useDeleteIotFirmwares,
} = createResourceQueries(iotFirmwareContract, {
  onSaved: (qc) => { void invalidateEntityRelations(qc); },
  onDeleted: (qc) => { void invalidateEntityRelations(qc); },
});

/** 固件上传通道：init / 服务端分片 / 浏览器直传都由固件契约派生 */
const FIRMWARE_UPLOAD_ENDPOINTS: BusinessUploadEndpoints<IotFirmware> = {
  init: (body) => api(iotFirmwareContract.uploadInit, { body: body as InitIotFirmwareUploadInput }),
  proxy: {
    chunk: urlOf(iotFirmwareContract.uploadChunk),
    complete: urlOf(iotFirmwareContract.uploadComplete),
    status: (uploadId) => urlOf(iotFirmwareContract.uploadStatus, { params: { uploadId } }),
    abort: (uploadId) => urlOf(iotFirmwareContract.uploadAbort, { params: { uploadId } }),
  },
  direct: {
    partUrl: (uploadId, partNumber) => api(fileContract.businessUploadPartUrl, { params: { uploadId, partNumber } }),
    partAck: (uploadId, partNumber, body) => api(fileContract.businessUploadPartAck, { params: { uploadId, partNumber }, body }),
    status: (uploadId) => api(fileContract.businessUploadStatus, { params: { uploadId } }),
    complete: (uploadId) => api(iotFirmwareContract.uploadComplete, { body: { uploadId } }),
    abort: (uploadId) => api(fileContract.businessUploadAbort, { params: { uploadId } }),
  },
};

interface UploadIotFirmwareVariables {
  file: File;
  productId: number;
  version: string;
  releaseNotes?: string;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * H5 保留：上传固件不超过分片阈值走单请求 multipart（XHR 带进度回调），超过则分片 + 断点续传，
 * mutationFn 组合多步且带 onProgress，不是单次 api(op) 调用；两条路径都由服务端计算 sha256。
 */
export function useUploadIotFirmware() {
  const qc = useQueryClient();
  const chunkThreshold = useChunkUploadThreshold();
  return useMutation({
    mutationFn: ({ file, productId, version, releaseNotes, onProgress, signal }: UploadIotFirmwareVariables): Promise<IotFirmware> => {
      if (file.size > chunkThreshold) {
        return uploadBusinessFile<IotFirmware>({
          file,
          endpoints: FIRMWARE_UPLOAD_ENDPOINTS,
          initExtra: { productId, version, releaseNotes: releaseNotes || undefined },
          resumeScope: `iot-firmware:${productId}:${version}`,
          onProgress,
          signal,
        });
      }
      const formData = new FormData();
      formData.append('file', file);
      formData.append('productId', String(productId));
      formData.append('version', version);
      if (releaseNotes) formData.append('releaseNotes', releaseNotes);
      return request.postForm<OutputOf<typeof iotFirmwareContract.upload>>(urlOf(iotFirmwareContract.upload), formData, { onProgress, signal }).then(unwrap);
    },
    onSuccess: () => {
      void invalidateEntityRelations(qc);
      void qc.invalidateQueries({ queryKey: iotFirmwareKeys.lists });
    },
  });
}

// ─── 升级任务 ─────────────────────────────────────────────────────────────────
export type IotOtaTaskListParams = NonNullable<QueryOf<typeof iotOtaTaskContract.list>>;

export const {
  keys: iotOtaTaskKeys,
  useList: useIotOtaTaskList,
  useDetail: useIotOtaTaskDetail,
} = createResourceQueries(iotOtaTaskContract);

/** 任务设备明细（进行中任务 5s 轮询跟进进度） */
export type IotOtaTaskDeviceListParams = NonNullable<QueryOf<typeof iotOtaTaskContract.devices>>;

export const iotOtaTaskDeviceKeys = {
  all: contractKey(iotOtaTaskContract.devices),
  ofTask: (taskId: number) => contractKey(iotOtaTaskContract.devices, { params: { id: taskId }, query: {} }),
};

export function useIotOtaTaskDevices(taskId: number | null, params: IotOtaTaskDeviceListParams, polling = false) {
  return useApiQuery(iotOtaTaskContract.devices, { params: { id: taskId ?? 0 }, query: params }, {
    enabled: taskId !== null,
    refetchInterval: polling ? 5_000 : false,
    placeholderData: keepPreviousData,
  });
}

/** 创建升级任务：任务与固件（任务数列）都要刷新 */
export function useCreateIotOtaTask() {
  return useApiMutation(iotOtaTaskContract.create, {
    invalidate: (qc) => {
      void invalidateEntityRelations(qc);
      void qc.invalidateQueries({ queryKey: iotOtaTaskKeys.lists });
      void qc.invalidateQueries({ queryKey: iotFirmwareKeys.lists });
    },
  });
}

/** 任务状态变更后：详情直接写入缓存、列表失效；设备明细按需失效 */
function applyOtaTask(qc: QueryClient, saved: IotOtaTask, withDevices: boolean) {
  void invalidateEntityRelations(qc);
  void qc.invalidateQueries({ queryKey: contractKey(iotOtaTaskContract.deviceDetail) });
  qc.setQueryData(iotOtaTaskKeys.detail(saved.id), saved);
  void qc.invalidateQueries({ queryKey: iotOtaTaskKeys.lists });
  if (withDevices) void qc.invalidateQueries({ queryKey: iotOtaTaskDeviceKeys.ofTask(saved.id) });
}

export function useCancelIotOtaTask() {
  return useApiMutation(iotOtaTaskContract.cancel, {
    invalidate: (qc, saved) => applyOtaTask(qc, saved, true),
  });
}

/** 灰度放量下一批：任务详情/列表与设备明细都刷新 */
export function useReleaseNextIotOtaBatch() {
  return useApiMutation(iotOtaTaskContract.releaseNextBatch, {
    invalidate: (qc, saved) => applyOtaTask(qc, saved, true),
  });
}

/** 恢复被熔断暂停的任务 */
export function useResumeIotOtaTask() {
  return useApiMutation(iotOtaTaskContract.resume, {
    invalidate: (qc, saved) => applyOtaTask(qc, saved, false),
  });
}

export function useIotOtaDeviceDetail(id: number | null) {
  return useApiQuery(iotOtaTaskContract.deviceDetail, { params: { id: id ?? 0 } }, { enabled: id !== null });
}
