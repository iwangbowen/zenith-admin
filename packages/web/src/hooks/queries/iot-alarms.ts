import { keepPreviousData } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { iotAlarmContract, iotAlarmRuleContract, iotMaintenanceWindowContract } from '@zenith/shared/iot';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateEntityRelations } from './entity-relations';

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
};

export function useIotAlarmList(params: IotAlarmListParams) {
  return useApiQuery(iotAlarmContract.list, { query: params }, { placeholderData: keepPreviousData });
}

/** 认领告警：状态翻转，仅失效告警列表 */
export function useAcknowledgeIotAlarm() {
  return useApiMutation(iotAlarmContract.acknowledge, {
    invalidate: (qc) => { void invalidateEntityRelations(qc); void qc.invalidateQueries({ queryKey: iotAlarmKeys.lists }); },
  });
}

/** 手动处理告警（可附处理备注）：记录状态翻转，仅失效告警列表 */
export function useResolveIotAlarm() {
  return useApiMutation(iotAlarmContract.resolve, {
    invalidate: (qc) => { void invalidateEntityRelations(qc); void qc.invalidateQueries({ queryKey: iotAlarmKeys.lists }); },
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
