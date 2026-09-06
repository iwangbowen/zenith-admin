import { useMemo } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { dataMaskContract } from '@zenith/shared/platform';
import type { QueryOf } from '@zenith/shared/core';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

/**
 * 数据脱敏域 hooks。
 *
 * 敏感字段由契约 `sensitive()` 声明并在服务端注册表汇总，这里没有「新增 / 删除规则」：
 * `fields` 是注册表 + 生效策略的只读视图，`savePolicy` / `resetPolicy` 只改某个字段的策略覆盖；
 * `effective` 是当前登录者视角（哪些字段被打码、能否按需查看明文），表单锁定与明文查看入口都读它。
 */

export type DataMaskFieldsQuery = NonNullable<QueryOf<typeof dataMaskContract.fields>>;

export const dataMaskKeys = {
  all: ['data-mask'] as const,
  fields: contractKey(dataMaskContract.fields),
  effective: contractKey(dataMaskContract.effective),
};

export function useDataMaskFields(query: DataMaskFieldsQuery = {}) {
  return useApiQuery(dataMaskContract.fields, { query });
}

/** 当前登录者视角的脱敏字段；策略变更后由本域失效，登录切换由 AuthProvider 整体清缓存 */
export function useEffectiveMask() {
  return useApiQuery(dataMaskContract.effective, { staleTime: LOOKUP_STALE_TIME });
}

/** 策略变更同时改变列表视图与所有人的生效视图 */
export function invalidateDataMask(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: dataMaskKeys.fields });
  void qc.invalidateQueries({ queryKey: dataMaskKeys.effective });
}

export function useSaveDataMaskPolicy() {
  return useApiMutation(dataMaskContract.savePolicy, { invalidate: invalidateDataMask });
}

export function useResetDataMaskPolicy() {
  return useApiMutation(dataMaskContract.resetPolicy, { invalidate: invalidateDataMask });
}

/** 按需查看明文：服务端逐次审计，不进入查询缓存 */
export function useRevealSensitive() {
  return useApiMutation(dataMaskContract.reveal);
}

export interface SensitiveFieldView {
  /** 该字段对当前用户是否被打码 */
  readonly isMasked: (entity: string, field: string) => boolean;
  readonly canReveal: boolean;
  readonly isLoading: boolean;
}

/** `useEffectiveMask` 的判定视图，供表格列 / 表单字段直接使用 */
export function useSensitiveFieldView(): SensitiveFieldView {
  const query = useEffectiveMask();
  const maskedKeys = query.data?.masked;
  const canReveal = query.data?.canReveal ?? false;
  const isLoading = query.isLoading;
  return useMemo(() => {
    const masked = new Set(maskedKeys ?? []);
    return {
      isMasked: (entity: string, field: string) => masked.has(`${entity}.${field}`),
      canReveal,
      isLoading,
    };
  }, [maskedKeys, canReveal, isLoading]);
}