/**
 * 应用版本管理域 hooks（应用 / 版本 / 制品 / 看板统计 / 设备中心）。
 *
 * key 结构：五组子资源契约各自派生独立命名空间（app-releases/apps、app-releases/releases、
 * app-releases/artifacts、app-releases/devices、app-releases）；看板统计读事件流水（另一份数据源），
 * 不随版本 CRUD 失效（发布 / 下载事件由客户端行为产生，刷新按钮手动回源）。
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { OutputOf, QueryOf } from '@zenith/shared/core';
import {
  appArtifactContract,
  appReleaseContract,
  appReleaseStatsContract,
  clientAppContract,
  clientDeviceContract,
} from '@zenith/shared/ops';
import { api, contractKey, createResourceQueries, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { unwrap } from '@/lib/query';
import { request } from '@/utils/request';

// ─── 应用 ────────────────────────────────────────────────────────────────────

export type ClientAppListParams = NonNullable<QueryOf<typeof clientAppContract.list>>;

export const {
  keys: clientAppKeys,
  useList: useClientAppList,
  useSave: useSaveClientApp,
  useDelete: useDeleteClientApps,
  useLookup: useAllClientApps,
} = createResourceQueries(clientAppContract);

// ─── 版本 ────────────────────────────────────────────────────────────────────

export type AppReleaseListParams = NonNullable<QueryOf<typeof appReleaseContract.list>>;

/** 应用列表的 releaseCount / latestVersion 冗余列随版本增删与发布状态变化 */
function invalidateClientAppLists(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: clientAppKeys.lists });
}

export const {
  keys: appReleaseKeys,
  useList: useAppReleaseList,
  useDetail: useAppReleaseDetail,
  useSave: useSaveAppRelease,
  useDelete: useDeleteAppReleases,
} = createResourceQueries(appReleaseContract, {
  onSaved: invalidateClientAppLists,
  onDeleted: invalidateClientAppLists,
});

/** 发布 / 撤回 / 灰度共用的失效：详情 + 列表 + 应用冗余列（latestVersion 随发布态变化） */
function invalidateReleaseLifecycle(qc: QueryClient, id: number) {
  void qc.invalidateQueries({ queryKey: appReleaseKeys.detail(id) });
  void qc.invalidateQueries({ queryKey: appReleaseKeys.lists });
  invalidateClientAppLists(qc);
}

export function usePublishAppRelease() {
  return useApiMutation(appReleaseContract.publish, {
    invalidate: (qc, _saved, { params }) => invalidateReleaseLifecycle(qc, params.id),
  });
}

export function useRevokeAppRelease() {
  return useApiMutation(appReleaseContract.revoke, {
    invalidate: (qc, _saved, { params }) => invalidateReleaseLifecycle(qc, params.id),
  });
}

export function useSetAppReleaseRollout() {
  return useApiMutation(appReleaseContract.rollout, {
    invalidate: (qc, _saved, { params }) => invalidateReleaseLifecycle(qc, params.id),
  });
}

// ─── 制品（版本详情的子资源，写后失效所属版本详情与列表的制品计数）──────────

/** 制品变更不触及应用冗余列（版本数 / 最新版本号都与制品无关），不失效 client-apps */
function invalidateReleaseArtifacts(qc: QueryClient, releaseId: number) {
  void qc.invalidateQueries({ queryKey: appReleaseKeys.detail(releaseId) });
  void qc.invalidateQueries({ queryKey: appReleaseKeys.lists });
}

/** 制品文件上传带进度，走 XHR 表单通道而非 api() */
export function useUploadAppArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ releaseId, formData, onProgress }: {
      releaseId: number;
      formData: FormData;
      onProgress?: (percent: number) => void;
    }) => request.postForm<OutputOf<typeof appReleaseContract.uploadArtifact>>(
      urlOf(appReleaseContract.uploadArtifact, { params: { id: releaseId } }),
      formData,
      { onProgress },
    ).then(unwrap),
    onSuccess: (_data, { releaseId }) => invalidateReleaseArtifacts(qc, releaseId),
  });
}

export function useAddExternalArtifact() {
  return useApiMutation(appReleaseContract.addExternalArtifact, {
    invalidate: (qc, _data, { params }) => invalidateReleaseArtifacts(qc, params.id),
  });
}

/** 删除制品：制品 ID 走制品契约，所属版本 ID 只用于失效 */
export function useDeleteAppArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ artifactId }: { artifactId: number; releaseId: number }) =>
      api(appArtifactContract.remove, { params: { id: artifactId } }),
    onSuccess: (_data, { releaseId }) => invalidateReleaseArtifacts(qc, releaseId),
  });
}

// ─── 看板统计 ────────────────────────────────────────────────────────────────

export const appReleaseStatsKeys = {
  all: contractKey(appReleaseStatsContract.stats),
  of: (appId: number | undefined, days: number) => contractKey(appReleaseStatsContract.stats, { query: { appId: appId ?? 0, days } }),
};

export function useAppReleaseStats(appId: number | undefined, days: number) {
  return useApiQuery(appReleaseStatsContract.stats, { query: { appId: appId ?? 0, days } }, { enabled: appId !== undefined });
}

// ─── 统一设备中心（升级心跳 / 推送绑定共用的设备档案）───────────────────────

export type ClientDeviceListParams = NonNullable<QueryOf<typeof clientDeviceContract.list>>;

export const {
  keys: clientDeviceKeys,
  useList: useClientDeviceList,
} = createResourceQueries(clientDeviceContract);

/** 解绑推送：设备行的绑定人与推送标识变化，失效设备列表 */
export function useUnbindDevicePush() {
  return useApiMutation(clientDeviceContract.unbind, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: clientDeviceKeys.lists });
    },
  });
}

/** 删除设备档案：失效设备列表；在网统计随下次查询自然刷新，不强制失效 stats */
export function useDeleteClientDevice() {
  return useApiMutation(clientDeviceContract.remove, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: clientDeviceKeys.lists });
    },
  });
}
