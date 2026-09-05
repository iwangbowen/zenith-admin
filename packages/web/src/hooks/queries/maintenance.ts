import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { maintenanceContract } from '@zenith/shared/ops';
import { apiQueryOptions, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type MaintenanceLogListParams = NonNullable<QueryOf<typeof maintenanceContract.logs>>;

export const maintenanceKeys = {
  all: ['maintenance'] as const,
  /** 管理端详情 —— 需 system:maintenance:manage 权限 */
  status: contractKey(maintenanceContract.detail),
  /** 公开探测 —— 未登录 / 无权限用户也可访问 */
  publicStatus: contractKey(maintenanceContract.status),
  logs: contractKey(maintenanceContract.logs),
  logList: (params: MaintenanceLogListParams) => contractKey(maintenanceContract.logs, { query: params }),
};

export function publicMaintenanceStatusQueryOptions() {
  return apiQueryOptions(maintenanceContract.status, {
    requestOptions: { silent: true },
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * 公开维护状态。全站维护遮罩、超管横幅共用这一份缓存——此前 App.tsx、
 * MaintenanceOverlay、useMaintenanceBanner 各自裸取一次，再靠 CustomEvent
 * 手工广播失效，等于手写了一遍 invalidateQueries。
 */
export function usePublicMaintenanceStatus(options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery({
    ...publicMaintenanceStatusQueryOptions(),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function useMaintenanceStatus() {
  return useApiQuery(maintenanceContract.detail);
}

export function useMaintenanceLogs(params: MaintenanceLogListParams) {
  return useApiQuery(maintenanceContract.logs, { query: params }, { placeholderData: keepPreviousData });
}

/** 开关维护模式：公开状态、管理详情与维护记录（开启 / 关闭各落一条）全部随之变化 */
export function useUpdateMaintenanceStatus() {
  return useApiMutation(maintenanceContract.update, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: maintenanceKeys.all });
    },
  });
}
