import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '@tanstack/react-pacer';
import type { AnyOperation, QueryOf } from '@zenith/shared/core';
import {
  reportCategoryContract,
  reportDashboardContract,
  reportDatasetContract,
  reportDatasourceContract,
  reportPrintContract,
  type ReportLookupOption,
} from '@zenith/shared/report';
import { api, contractKey } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type ReportLookupEntity = 'datasources' | 'datasets' | 'dashboards' | 'categories' | 'print';

export type ReportLookupParams = NonNullable<QueryOf<typeof reportDatasourceContract.lookup>>;

/** 各资源的轻量下拉操作；分类下拉不接受 status，多余参数由契约解析忽略 */
const LOOKUP_OPS: Record<ReportLookupEntity, AnyOperation> = {
  datasources: reportDatasourceContract.lookup,
  datasets: reportDatasetContract.lookup,
  dashboards: reportDashboardContract.lookup,
  categories: reportCategoryContract.lookup,
  print: reportPrintContract.lookup,
};

export const reportLookupKeys = {
  entity: (entity: ReportLookupEntity, params: ReportLookupParams) => contractKey(LOOKUP_OPS[entity], { query: params }),
};

export function useReportLookup(entity: ReportLookupEntity, params: ReportLookupParams = {}, enabled = true) {
  return useQuery({
    queryKey: reportLookupKeys.entity(entity, params),
    queryFn: () => api(LOOKUP_OPS[entity], { query: params }, { silent: true }) as Promise<ReportLookupOption[]>,
    staleTime: LOOKUP_STALE_TIME,
    enabled,
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
