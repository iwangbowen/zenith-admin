import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { monitorAlertContract, type MonitorAlertOverviewRange } from '@zenith/shared/platform';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type MonitorAlertListParams = NonNullable<QueryOf<typeof monitorAlertContract.list>>;

export type MonitorAlertEventListParams = NonNullable<QueryOf<typeof monitorAlertContract.events>>;

/** 告警事件由规则触发产生，规则增删改后一并失效 */
const EVENT_LISTS_KEY = contractKey(monitorAlertContract.events);

/** 概览是跨规则与事件的聚合派生，任一侧变更都可能改变它，故独立成键单独失效 */
const OVERVIEW_KEY = contractKey(monitorAlertContract.overview);

function invalidateEventViews(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: EVENT_LISTS_KEY });
  void qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
}

const resource = createResourceQueries(monitorAlertContract, {
  onSaved: invalidateEventViews,
  onDeleted: invalidateEventViews,
});

export const monitorAlertKeys = {
  ...resource.keys,
  eventLists: EVENT_LISTS_KEY,
  eventList: (params: MonitorAlertEventListParams) => contractKey(monitorAlertContract.events, { query: params }),
  overviews: OVERVIEW_KEY,
  overview: (range: MonitorAlertOverviewRange) => contractKey(monitorAlertContract.overview, { query: { range } }),
};

export const useMonitorAlertList = resource.useList;
export const useSaveMonitorAlert = resource.useSave;
/** 单条与批量删除 */
export const useDeleteMonitorAlerts = resource.useDelete;

/** 启停会改变规则运行态，也可能关闭规则未恢复的告警事件，整域失效 */
export function useToggleMonitorAlert() {
  return useApiMutation(monitorAlertContract.setEnabled, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: monitorAlertKeys.all }),
  });
}

/** 批量启停：停用会关闭规则未恢复的告警事件，故事件列表与概览一并失效 */
export function useBatchToggleMonitorAlerts() {
  return useApiMutation(monitorAlertContract.setEnabledBatch, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: monitorAlertKeys.lists });
      invalidateEventViews(qc);
    },
  });
}

/**
 * 试发通知：只验证渠道配置，不产生事件、不改规则运行态，
 * 因此不失效任何列表；返回派发结果供调用方精确提示哪个渠道失败。
 */
export function useTestMonitorAlert() {
  return useApiMutation(monitorAlertContract.test);
}

/** 处理告警：改变的是事件的人工状态，规则列表不含该状态，故不失效规则列表 */
export function useHandleMonitorAlertEvent() {
  return useApiMutation(monitorAlertContract.handleEvent, { invalidate: invalidateEventViews });
}

export function useBatchHandleMonitorAlertEvents() {
  return useApiMutation(monitorAlertContract.handleEventsBatch, { invalidate: invalidateEventViews });
}

export function useMonitorAlertOverview(range: MonitorAlertOverviewRange, enabled = true) {
  return useApiQuery(monitorAlertContract.overview, { query: { range } }, { placeholderData: keepPreviousData, enabled });
}

export function useMonitorAlertEventList(params: MonitorAlertEventListParams) {
  return useApiQuery(monitorAlertContract.events, { query: params }, { placeholderData: keepPreviousData });
}
