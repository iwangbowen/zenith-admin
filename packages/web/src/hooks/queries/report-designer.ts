import { useCallback, useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiResponse, BodyOf } from '@zenith/shared/core';
import { dictContract } from '@zenith/shared/platform';
import {
  reportDashboardContract,
  reportDatasetContract,
  reportMetricContract,
  type ReportDashboard,
  type ReportDataResult,
  type ReportDataset,
  type ReportFilter,
  type ReportWidget,
} from '@zenith/shared/report';
import { api, contractKey, urlOf } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { request } from '@/utils/request';
import { reportDashboardKeys } from './report-dashboards';
import { mergeReportLookupOptions } from './report-lookups';

export interface DatasetDataState {
  data: ReportDataResult | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_DATASET_STATE: DatasetDataState = { data: null, loading: false, error: null };

/** 设计器的数据集 / 指标取数与仪表盘正式取数分属不同操作，缓存互不干扰 */
export const reportDesignerKeys = {
  datasets: (currentDatasetId: number | null, keyword: string) =>
    [...contractKey(reportDatasetContract.lookup, { query: { status: 'enabled', limit: 50, keyword: keyword || undefined } }), currentDatasetId] as const,
  dashboards: (excludeId: number | undefined, keyword: string) =>
    contractKey(reportDashboardContract.lookup, { query: { status: 'enabled', limit: 50, keyword: keyword || undefined, excludeId } }),
  datasetDataPrefix: contractKey(reportDatasetContract.data),
  datasetData: (datasetId: number, params: Record<string, unknown>, limit: number) =>
    contractKey(reportDatasetContract.data, { params: { id: datasetId }, body: { params, limit } }),
  metricDataPrefix: contractKey(reportMetricContract.evaluate),
  metricData: (metricId: number, params: Record<string, unknown>) =>
    contractKey(reportMetricContract.evaluate, { params: { id: metricId }, body: { params } }),
  /** 字典项来自 platform 域，与 useDictItems 共用同一缓存 */
  dictItems: (code: string) => ['dicts', 'code-items', code] as const,
};

export function useReportDesignerDatasets(
  currentDataset?: Pick<ReportDataset, 'id' | 'name' | 'status'> | null,
  keyword?: string,
) {
  return useQuery({
    queryKey: reportDesignerKeys.datasets(currentDataset?.id ?? null, keyword ?? ''),
    queryFn: async () => {
      const data = await api(reportDatasetContract.lookup, { query: { status: 'enabled', limit: 50, keyword: keyword || undefined } }, { silent: true });
      return mergeReportLookupOptions(data, currentDataset ? [currentDataset] : []);
    },
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useReportDesignerDashboardLookup(excludeId: number | undefined, keyword?: string) {
  return useQuery({
    queryKey: reportDesignerKeys.dashboards(excludeId, keyword ?? ''),
    queryFn: () => api(reportDashboardContract.lookup, { query: { status: 'enabled', limit: 50, keyword: keyword || undefined, excludeId } }, { silent: true }),
    staleTime: LOOKUP_STALE_TIME,
  });
}

/**
 * 设计器保存即改写看板内容：详情（各模式）、列表与该看板的取数结果都要回源。
 * 保存冲突（409）的载荷携带服务端当前 revision，调用方需要读取原始响应体决定是否覆盖，故不经 unwrap。
 */
export function useSaveReportDashboardDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: BodyOf<typeof reportDashboardContract.update> }) =>
      request.put<ReportDashboard>(urlOf(reportDashboardContract.update, { params: { id } }), values, { silent: true }) as Promise<ApiResponse<ReportDashboard>>,
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.detailOf(vars.id) });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.lists });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.dataOf(vars.id) });
      // 设计器自身的取数缓存（datasetData / metricData）随组件配置变化；datasets / dashboards / dictItems 是下拉源，与本次保存无关
      void qc.invalidateQueries({ queryKey: reportDesignerKeys.datasetDataPrefix });
      void qc.invalidateQueries({ queryKey: reportDesignerKeys.metricDataPrefix });
    },
  });
}

export function computeWidgetParams(widget: ReportWidget, filterValues: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const binding of widget.paramBindings ?? []) {
    if (binding.filterId && binding.param) params[binding.param] = filterValues[binding.filterId];
  }
  return params;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '加载失败';
}

function fetchDatasetData(id: number, params: Record<string, unknown>, limit: number, signal?: AbortSignal) {
  return api(reportDatasetContract.data, { params: { id }, body: { params, limit } }, { silent: true, signal });
}

export function useReportDatasetDataMap(datasetIds: number[], limit = 500) {
  const queryClient = useQueryClient();
  const ids = useMemo(() => Array.from(new Set(datasetIds.filter((id) => id > 0))).sort((a, b) => a - b), [datasetIds]);
  // combine：返回值引用稳定（仅底层查询结果变化时重算），可安全用于下游依赖
  const stateMap = useQueries({
    queries: ids.map((id) => ({
      queryKey: reportDesignerKeys.datasetData(id, {}, limit),
      queryFn: ({ signal }: { signal?: AbortSignal }) => fetchDatasetData(id, {}, limit, signal),
    })),
    combine: (results) => {
      const map = new Map<number, DatasetDataState>();
      ids.forEach((id, index) => {
        const query = results[index];
        map.set(id, {
          data: query?.data ?? null,
          loading: query?.isFetching ?? false,
          error: query?.error ? errorMessage(query.error) : null,
        });
      });
      return map;
    },
  });

  const get = useCallback((id: number | null | undefined): DatasetDataState => {
    if (!id) return EMPTY_DATASET_STATE;
    return stateMap.get(id) ?? EMPTY_DATASET_STATE;
  }, [stateMap]);

  const refresh = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: reportDesignerKeys.datasetDataPrefix, type: 'active' });
  }, [queryClient]);

  return { get, refresh };
}

export function useReportWidgetData(widgets: ReportWidget[], filterValues: Record<string, unknown>, limit = 500) {
  const queryClient = useQueryClient();
  const entries = useMemo(() => {
    const map = new Map<string, { key: string; source: 'dataset' | 'metric'; id: number; params: Record<string, unknown> }>();
    for (const widget of widgets ?? []) {
      const source = widget.metricId ? 'metric' : widget.datasetId ? 'dataset' : null;
      const id = widget.metricId ?? widget.datasetId;
      if (!source || !id) continue;
      const params = computeWidgetParams(widget, filterValues);
      const key = `${source}:${id}:${JSON.stringify(params)}`;
      if (!map.has(key)) map.set(key, { key, source, id, params });
    }
    return Array.from(map.values());
  }, [widgets, filterValues]);

  const stateMap = useQueries({
    queries: entries.map((entry) => ({
      queryKey: entry.source === 'metric'
        ? reportDesignerKeys.metricData(entry.id, entry.params)
        : reportDesignerKeys.datasetData(entry.id, entry.params, limit),
      queryFn: async ({ signal }: { signal?: AbortSignal }): Promise<ReportDataResult> => {
        if (entry.source === 'dataset') {
          return fetchDatasetData(entry.id, entry.params, limit, signal);
        }
        const result = await api(reportMetricContract.evaluate, { params: { id: entry.id }, body: { params: entry.params } }, { silent: true, signal });
        return {
          columns: ['value'],
          fields: [{ name: 'value', label: result.code, type: 'number' as const, source: 'declared' as const }],
          rows: [{ value: result.value, formattedValue: result.formattedValue }],
          total: 1,
        } satisfies ReportDataResult;
      },
    })),
    combine: (results) => {
      const map = new Map<string, DatasetDataState>();
      entries.forEach((entry, index) => {
        const query = results[index];
        map.set(entry.key, {
          data: query?.data ?? null,
          loading: query?.isFetching ?? false,
          error: query?.error ? errorMessage(query.error) : null,
        });
      });
      return map;
    },
  });

  const get = useCallback((widget: ReportWidget): DatasetDataState => {
    const source = widget.metricId ? 'metric' : widget.datasetId ? 'dataset' : null;
    const id = widget.metricId ?? widget.datasetId;
    if (!source || !id) return EMPTY_DATASET_STATE;
    const key = `${source}:${id}:${JSON.stringify(computeWidgetParams(widget, filterValues))}`;
    return stateMap.get(key) ?? EMPTY_DATASET_STATE;
  }, [filterValues, stateMap]);

  const refresh = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: reportDesignerKeys.datasetDataPrefix, type: 'active' });
    void queryClient.refetchQueries({ queryKey: reportDesignerKeys.metricDataPrefix, type: 'active' });
  }, [queryClient]);

  return { get, refresh };
}

export function useReportFilterDynamicOptions(filters: ReportFilter[], disabled?: boolean) {
  const sources = useMemo(() => filters
    .filter((filter) => (filter.type === 'select' || filter.type === 'multiSelect') && filter.optionSource?.kind === 'dataset' && filter.optionSource.datasetId)
    .map((filter) => ({ filterId: filter.id, source: filter.optionSource!, datasetId: filter.optionSource!.datasetId! })),
  [filters]);

  const queries = useQueries({
    queries: sources.map((entry) => ({
      queryKey: reportDesignerKeys.datasetData(entry.datasetId, {}, 500),
      queryFn: ({ signal }: { signal?: AbortSignal }) => fetchDatasetData(entry.datasetId, {}, 500, signal),
      enabled: !disabled,
      staleTime: LOOKUP_STALE_TIME,
    })),
    combine: (results) => {
      const options: Record<string, { value: string; label: string }[]> = {};
      sources.forEach((entry, index) => {
        const result = results[index]?.data;
        if (!result) return;
        const valueField = entry.source.valueField || result.columns[0];
        const labelField = entry.source.labelField || valueField;
        options[entry.filterId] = result.rows
          .map((row) => ({ value: String(row[valueField] ?? ''), label: String(row[labelField] ?? row[valueField] ?? '') }))
          .filter((option) => option.value !== '');
      });
      return options;
    },
  });

  return queries;
}

export function useReportWidgetDictMaps(codes: string[]) {
  const normalizedCodes = useMemo(() => Array.from(new Set(codes.map((code) => code.trim()).filter(Boolean))).sort(), [codes]);
  return useQueries({
    queries: normalizedCodes.map((code) => ({
      queryKey: reportDesignerKeys.dictItems(code),
      queryFn: () => api(dictContract.itemsByCode, { params: { code } }, { silent: true }),
      staleTime: LOOKUP_STALE_TIME,
    })),
    combine: (results) => {
      const maps: Record<string, Record<string, string>> = {};
      normalizedCodes.forEach((code, index) => {
        const items = results[index]?.data ?? [];
        maps[code] = Object.fromEntries(items.map((item) => [item.value, item.label]));
      });
      return maps;
    },
  });
}
