import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { maintenanceContract } from '@zenith/shared/ops';
import { apiQueryOptions, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type MaintenanceLogListParams = NonNullable<QueryOf<typeof maintenanceContract.logs>>;

export const maintenanceKeys = {
  /** 管理详情：查看或管理权限。 */
  status: contractKey(maintenanceContract.detail),
  /** 公开探测 —— 未登录 / 无权限用户也可访问 */
  publicStatus: contractKey(maintenanceContract.status),
  logs: contractKey(maintenanceContract.logs),
  logList: (params: MaintenanceLogListParams) => contractKey(maintenanceContract.logs, { query: params }),
};

const PUBLIC_STATUS_OPTIONS = {
  requestOptions: { silent: true },
  staleTime: 30_000,
  retry: false,
} as const;

export function publicMaintenanceStatusQueryOptions() {
  return apiQueryOptions(maintenanceContract.status, PUBLIC_STATUS_OPTIONS);
}

/** 公开维护状态：全站维护遮罩与超管横幅共用缓存。 */
export function usePublicMaintenanceStatus(options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useApiQuery(maintenanceContract.status, {
    ...PUBLIC_STATUS_OPTIONS,
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function useMaintenanceStatus(enabled = true) {
  return useApiQuery(maintenanceContract.detail, { enabled });
}
export function useMaintenanceAccess(enabled = true) {
  return useApiQuery(maintenanceContract.access, { enabled, refetchInterval: enabled ? 30_000 : false, requestOptions: { silent: true } });
}
export function useMaintenancePlan() { return useApiMutation(maintenanceContract.plan, { invalidate: invalidateMaintenanceAfterToggle }); }
export function useMaintenanceRecipients(enabled: boolean) { return useApiQuery(maintenanceContract.recipients, { enabled }); }
export function useMaintenanceStart() { return useApiMutation(maintenanceContract.start, { invalidate: invalidateMaintenanceAfterToggle }); }
export function useMaintenanceCancel() { return useApiMutation(maintenanceContract.cancel, { invalidate: invalidateMaintenanceAfterToggle }); }
export function useMaintenanceDiagnosis() { return useApiMutation(maintenanceContract.diagnose); }
export function useMaintenanceLog(id: number, enabled = true) { return useApiQuery(maintenanceContract.log, { params: { id } }, { enabled }); }

export function useMaintenanceLogs(params: MaintenanceLogListParams) {
  return useApiQuery(maintenanceContract.logs, { query: params }, { placeholderData: keepPreviousData });
}

/** 生命周期写入影响公开摘要、管理详情、维护时段和当前维护能力。 */
export function invalidateMaintenanceAfterToggle(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: maintenanceKeys.publicStatus });
  void qc.invalidateQueries({ queryKey: maintenanceKeys.status });
  void qc.invalidateQueries({ queryKey: maintenanceKeys.logs });
  void qc.invalidateQueries({ queryKey: contractKey(maintenanceContract.access) });
}

export function useUpdateMaintenanceStatus() {
  return useApiMutation(maintenanceContract.update, { invalidate: invalidateMaintenanceAfterToggle });
}
