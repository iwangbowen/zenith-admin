import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { iotWhitelistContract } from '@zenith/shared/iot';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { iotProductKeys } from './iot-products';

// ─── 注册白名单 ───────────────────────────────────────────────────────────────
export type IotWhitelistListParams = NonNullable<QueryOf<typeof iotWhitelistContract.list>>;

export const iotWhitelistKeys = {
  all: [resourceKeyOf(iotWhitelistContract.basePath)] as const,
  lists: contractKey(iotWhitelistContract.list),
  list: (params: IotWhitelistListParams) => contractKey(iotWhitelistContract.list, { query: params }),
  /** 全部统计变体（不带 / 带 productId 筛选） */
  statsAll: contractKey(iotWhitelistContract.stats),
  stats: (productId?: number) => contractKey(iotWhitelistContract.stats, { query: { productId } }),
};

/** 白名单条目增删同时改变列表与「总数 / 已核销」统计卡（统计卡随列表筛选的 productId 变化，按操作前缀整组回源） */
function invalidateWhitelist(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: iotWhitelistKeys.lists });
  void qc.invalidateQueries({ queryKey: iotWhitelistKeys.statsAll });
}

export function useIotWhitelistList(params: IotWhitelistListParams) {
  return useApiQuery(iotWhitelistContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export function useIotWhitelistStats(productId?: number) {
  return useApiQuery(iotWhitelistContract.stats, { query: { productId } });
}

export function useImportIotWhitelist() {
  return useApiMutation(iotWhitelistContract.import, { invalidate: invalidateWhitelist });
}

export function useDeleteIotWhitelistEntry() {
  return useApiMutation(iotWhitelistContract.remove, { invalidate: invalidateWhitelist });
}

// ─── 产品注册密钥 ─────────────────────────────────────────────────────────────

/**
 * 开启 / 重置 / 关闭动态注册改写产品的 registrationEnabled：注册页从产品下拉源读取该开关，
 * 产品列表与详情也渲染它；物模型（独立命名空间）与白名单不受影响。
 */
function invalidateProductRegistration(qc: QueryClient, productId: number) {
  void qc.invalidateQueries({ queryKey: iotProductKeys.lookup });
  void qc.invalidateQueries({ queryKey: iotProductKeys.lists });
  void qc.invalidateQueries({ queryKey: iotProductKeys.detail(productId) });
}

/** 开启/重置注册密钥：明文仅本次返回 */
export function useResetIotRegistrationSecret() {
  return useApiMutation(iotWhitelistContract.resetRegistrationSecret, {
    invalidate: (qc, _output, { params }) => invalidateProductRegistration(qc, params.id),
  });
}

export function useDisableIotRegistration() {
  return useApiMutation(iotWhitelistContract.disableRegistration, {
    invalidate: (qc, _output, { params }) => invalidateProductRegistration(qc, params.id),
  });
}
