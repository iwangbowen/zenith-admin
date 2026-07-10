import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReportLookupOption } from '@zenith/shared';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export type ReportLookupEntity = 'datasources' | 'datasets' | 'dashboards' | 'categories' | 'print';

export interface ReportLookupParams {
  keyword?: string;
  status?: 'enabled' | 'disabled';
  limit?: number;
}

function getLookupPath(entity: ReportLookupEntity) {
  switch (entity) {
    case 'datasources': return '/api/report/datasources/lookup';
    case 'datasets': return '/api/report/datasets/lookup';
    case 'dashboards': return '/api/report/dashboards/lookup';
    case 'categories': return '/api/report/categories/lookup';
    case 'print': return '/api/report/print/lookup';
    default: return '/api/report/datasets/lookup';
  }
}

export const reportLookupKeys = {
  all: ['report', 'lookups'] as const,
  entity: (entity: ReportLookupEntity, params: ReportLookupParams) => ['report', 'lookups', entity, params] as const,
};

export function useReportLookup(entity: ReportLookupEntity, params: ReportLookupParams = {}, enabled = true) {
  return useQuery({
    queryKey: reportLookupKeys.entity(entity, params),
    queryFn: () => request.get<ReportLookupOption[]>(`${getLookupPath(entity)}${toQueryString(params)}`, { silent: true }).then(unwrap),
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
  const [debouncedKeyword, setDebouncedKeyword] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword.trim()), 300);
    return () => clearTimeout(timer);
  }, [keyword]);

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
