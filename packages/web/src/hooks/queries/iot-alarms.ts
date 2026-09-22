import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { iotAlarmContract, iotAlarmRuleContract, iotMaintenanceWindowContract } from '@zenith/shared/iot';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateEntityRelations } from '@/lib/entity-relation-cache';

// ─── 告警规则 ─────────────────────────────────────────────────────────────────
export type IotAlarmRuleListParams = NonNullable<QueryOf<typeof iotAlarmRuleContract.list>>;

export const {
  keys: iotAlarmRuleKeys,
  useList: useIotAlarmRuleList,
  useSave: useSaveIotAlarmRule,
  useDelete: useDeleteIotAlarmRules,
} = createResourceQueries(iotAlarmRuleContract);

// ─── 告警记录 ─────────────────────────────────────────────────────────────────
export type IotAlarmListParams = NonNullable<QueryOf<typeof iotAlarmContract.list>>;

export const iotAlarmKeys = {
  all: [resourceKeyOf(iotAlarmContract.basePath)] as const,
  lists: contractKey(iotAlarmContract.list),
  list: (params: IotAlarmListParams) => contractKey(iotAlarmContract.list, { query: params }),
  detail: (id: number) => contractKey(iotAlarmContract.detail, { params: { id } }),
};

/** 精确详情：关联对象深链不依赖告警列表当前筛选和分页。 */
export function useIotAlarmDetail(id: number | undefined, enabled = true) {
  return useApiQuery(iotAlarmContract.detail, { params: { id: id ?? 0 } }, {
    enabled: enabled && id !== undefined,
    requestOptions: { silent: true },
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
}

export function useIotAlarmList(params: IotAlarmListParams) {
  return useApiQuery(iotAlarmContract.list, { query: params }, { placeholderData: keepPreviousData });
}

function invalidateAlarmState(qc: QueryClient, id: number) {
  void invalidateEntityRelations(qc);
  void qc.invalidateQueries({ queryKey: iotAlarmKeys.lists });
  void qc.invalidateQueries({ queryKey: iotAlarmKeys.detail(id) });
}

/** 认领告警：列表、精确详情和关系摘要同时更新。 */
export function useAcknowledgeIotAlarm() {
  return useApiMutation(iotAlarmContract.acknowledge, {
    invalidate: (qc, _data, { params }) => invalidateAlarmState(qc, params.id),
  });
}

/** 手动处理告警（可附处理备注）：详情重新获取设备与处理人信息。 */
export function useResolveIotAlarm() {
  return useApiMutation(iotAlarmContract.resolve, {
    invalidate: (qc, _data, { params }) => invalidateAlarmState(qc, params.id),
  });
}

// ─── 维护窗口 ─────────────────────────────────────────────────────────────────
export type IotMaintenanceWindowListParams = NonNullable<QueryOf<typeof iotMaintenanceWindowContract.list>>;

export const {
  keys: iotMaintenanceWindowKeys,
  useList: useIotMaintenanceWindowList,
  useSave: useSaveIotMaintenanceWindow,
  useDelete: useDeleteIotMaintenanceWindows,
} = createResourceQueries(iotMaintenanceWindowContract);
