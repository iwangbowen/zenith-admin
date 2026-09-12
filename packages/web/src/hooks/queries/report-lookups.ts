import { useMemo, useState } from 'react';
import { useDebouncedValue } from '@tanstack/react-pacer';
import type { QueryOf } from '@zenith/shared/core';
import {
  reportCategoryContract,
  reportDashboardContract,
  reportDatasetContract,
  reportDatasourceContract,
  reportPrintContract,
  type ReportLookupOption,
} from '@zenith/shared/report';
import { contractKey, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type ReportLookupEntity = 'datasources' | 'datasets' | 'dashboards' | 'categories' | 'print';

export type ReportLookupParams = NonNullable<QueryOf<typeof reportDatasourceContract.lookup>>;

/**
 * 五个轻量下拉操作响应同形（ReportLookupOption[]），查询参数以数据源下拉为准：
 * 分类下拉不接受 status（多余参数由契约解析忽略）、看板下拉另有 excludeId（本 hook 不暴露），
 * 因此按同一操作形状登记，调用方拿到统一的输入 / 输出类型。
 */
type ReportLookupOperation = typeof reportDatasourceContract.lookup;

const LOOKUP_OPS: Record<ReportLookupEntity, ReportLookupOperation> = {
  datasources: reportDatasourceContract.lookup,
  datasets: reportDatasetContract.lookup,
  dashboards: reportDashboardContract.lookup as unknown as ReportLookupOperation,
  categories: reportCategoryContract.lookup as unknown as ReportLookupOperation,
  print: reportPrintContract.lookup,
};

export const reportLookupKeys = {
  entity: (entity: ReportLookupEntity, params: ReportLookupParams) => contractKey(LOOKUP_OPS[entity], { query: params }),
};

export function useReportLookup(entity: ReportLookupEntity, params: ReportLookupParams = {}, enabled = true) {
  return useApiQuery(LOOKUP_OPS[entity], { query: params }, {
    staleTime: LOOKUP_STALE_TIME,
    enabled,
    requestOptions: { silent: true },
  });
}

export function mergeReportLookupOptions(
  remoteOptions: ReportLookupOption[] | undefined,
  preservedOptions?: Array<ReportLookupOption | null | undefined>,
) {
  const map = new Map<number, ReportLookupOption>();
  (preservedOptions ?? []).forEach((option) => {
    if (option?.id) map.set(option.id, option);
  });
  (remoteOptions ?? []).forEach((option) => {
    map.set(option.id, option);
  });
  return Array.from(map.values());
}

export function useDebouncedReportLookup(
  entity: ReportLookupEntity,
  options?: {
    status?: 'enabled' | 'disabled';
    limit?: number;
    preservedOptions?: Array<ReportLookupOption | null | undefined>;
    enabled?: boolean;
  },
) {
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword] = useDebouncedValue(keyword.trim(), { wait: 300 });

  const query = useReportLookup(entity, {
    keyword: debouncedKeyword || undefined,
    status: options?.status,
    limit: options?.limit ?? 20,
  }, options?.enabled ?? true);

  const mergedOptions = useMemo(
    () => mergeReportLookupOptions(query.data, options?.preservedOptions),
    [options?.preservedOptions, query.data],
  );

  return {
    keyword,
    setKeyword,
    debouncedKeyword,
    options: mergedOptions,
    query,
  };
}
