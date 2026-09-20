import type { QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { iotBatchContract, iotDeviceContract, type IotDeviceShadow } from '@zenith/shared/iot';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateEntityRelations } from './entity-relations';

export type IotDeviceListParams = NonNullable<QueryOf<typeof iotDeviceContract.list>>;

export const {
  keys: iotDeviceKeys,
  useList: useIotDeviceList,
  useDetail: useIotDeviceDetail,
  useSave: useSaveIotDevice,
  useDelete: useDeleteIotDevices,
} = createResourceQueries(iotDeviceContract, {
  onSaved: (qc) => { void invalidateEntityRelations(qc); },
  onDeleted: (qc) => { void invalidateEntityRelations(qc); },
});

/** 重置接入密钥：详情（凭证展示）与列表都要刷新 */
export function useResetIotDeviceSecret() {
  return useApiMutation(iotDeviceContract.resetSecret, {
    invalidate: (qc, saved) => {
      void qc.invalidateQueries({ queryKey: iotDeviceKeys.detail(saved.id) });
      void qc.invalidateQueries({ queryKey: iotDeviceKeys.lists });
    },
  });
}

// ─── 遥测（独立命名空间：高频只读，不与设备 CRUD 连坐）────────────────────────
export const iotTelemetryKeys = {
  all: contractKey(iotDeviceContract.telemetry),
  /** 某台设备全部时间窗的遥测查询前缀 */
  ofDevice: (deviceId: number) => contractKey(iotDeviceContract.telemetry, { params: { id: deviceId }, query: {} }),
};

export function useIotTelemetry(deviceId: number | null, days = 1) {
  return useApiQuery(iotDeviceContract.telemetry, { params: { id: deviceId ?? 0 }, query: { days } }, {
    enabled: deviceId !== null,
  });
}

/** 清空遥测：遥测点列与列表快照（reported 列）都失效 */
export function useClearIotTelemetry() {
  return useApiMutation(iotDeviceContract.clearTelemetry, {
    invalidate: (qc, _data, { params }) => {
      void qc.invalidateQueries({ queryKey: iotTelemetryKeys.ofDevice(params.id) });
      void qc.invalidateQueries({ queryKey: iotDeviceKeys.lists });
    },
  });
}

// ─── 遥测聚合（长窗口图表：min/max/avg 区间带）────────────────────────────────
export function useIotTelemetryAgg(deviceId: number | null, property: string | null, days: number) {
  return useApiQuery(iotDeviceContract.telemetryAgg, { params: { id: deviceId ?? 0 }, query: { property: property ?? '', days } }, {
    enabled: deviceId !== null && property !== null,
  });
}

// ─── 指令 ─────────────────────────────────────────────────────────────────────
export type IotCommandListParams = NonNullable<QueryOf<typeof iotDeviceContract.listCommands>>;

export const iotCommandKeys = {
  all: contractKey(iotDeviceContract.listCommands),
  ofDevice: (deviceId: number) => contractKey(iotDeviceContract.listCommands, { params: { id: deviceId }, query: {} }),
};

export function useIotCommands(deviceId: number | null, params: IotCommandListParams) {
  return useApiQuery(iotDeviceContract.listCommands, { params: { id: deviceId ?? 0 }, query: params }, {
    enabled: deviceId !== null,
  });
}

export function useSendIotCommand() {
  return useApiMutation(iotDeviceContract.sendCommand, {
    invalidate: (qc, _saved, { params }) => {
      void qc.invalidateQueries({ queryKey: iotCommandKeys.ofDevice(params.id) });
    },
  });
}

// ─── 设备影子 ─────────────────────────────────────────────────────────────────
export const iotShadowKeys = {
  all: contractKey(iotDeviceContract.shadow),
  of: (deviceId: number) => contractKey(iotDeviceContract.shadow, { params: { id: deviceId } }),
};

export function useIotDeviceShadow(deviceId: number | null) {
  return useApiQuery(iotDeviceContract.shadow, { params: { id: deviceId ?? 0 } }, {
    enabled: deviceId !== null,
    // 详情面板打开期间轮询：设备回报后 desired 收敛、reported 更新
    refetchInterval: 10_000,
  });
}

/** 设置/清空期望属性后：影子直接写入缓存，设备详情与列表快照（desired 列）失效 */
function applyShadow(qc: QueryClient, deviceId: number, shadow: IotDeviceShadow) {
  qc.setQueryData(iotShadowKeys.of(deviceId), shadow);
  void qc.invalidateQueries({ queryKey: iotDeviceKeys.detail(deviceId) });
  void qc.invalidateQueries({ queryKey: iotDeviceKeys.lists });
}

export function useSetIotDesired() {
  return useApiMutation(iotDeviceContract.setDesired, {
    invalidate: (qc, saved, { params }) => applyShadow(qc, params.id, saved),
  });
}

export function useClearIotDesired() {
  return useApiMutation(iotDeviceContract.clearDesired, {
    invalidate: (qc, saved, { params }) => applyShadow(qc, params.id, saved),
  });
}

// ─── 设备事件流 ───────────────────────────────────────────────────────────────
export type IotDeviceEventListParams = NonNullable<QueryOf<typeof iotDeviceContract.events>>;

export const iotDeviceEventKeys = {
  all: contractKey(iotDeviceContract.events),
};

export function useIotDeviceEvents(deviceId: number | null, params: IotDeviceEventListParams) {
  return useApiQuery(iotDeviceContract.events, { params: { id: deviceId ?? 0 }, query: params }, {
    enabled: deviceId !== null,
  });
}

// ─── 批量操作（任务中心执行，进度走全局 TaskTray，无缓存联动）──────────────────
export function useSubmitIotBatchCommand() {
  return useApiMutation(iotBatchContract.commands);
}

export function useSubmitIotBatchDesired() {
  return useApiMutation(iotBatchContract.desired);
}

// ─── 网关拓扑 / 设备日志 ──────────────────────────────────────────────────────
export const iotTopologyKeys = {
  of: (deviceId: number) => contractKey(iotDeviceContract.topology, { params: { id: deviceId } }),
};

export function useIotDeviceTopology(deviceId: number | null, enabled = true) {
  return useApiQuery(iotDeviceContract.topology, { params: { id: deviceId ?? 0 } }, {
    enabled: enabled && deviceId !== null,
  });
}

export type IotDeviceLogListParams = NonNullable<QueryOf<typeof iotDeviceContract.logs>>;

export function useIotDeviceLogs(deviceId: number | null, params: IotDeviceLogListParams, enabled = true) {
  return useApiQuery(iotDeviceContract.logs, { params: { id: deviceId ?? 0 }, query: params }, {
    enabled: enabled && deviceId !== null,
  });
}
