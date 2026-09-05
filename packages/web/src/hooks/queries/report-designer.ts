import { useCallback, useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiResponse } from '@zenith/shared/core';
import { dictContract } from '@zenith/shared/platform';
import type { ReportDashboard, ReportDataResult, ReportDataset, ReportFilter, ReportLookupOption, ReportMetricEvaluation, ReportWidget } from '@zenith/shared/report';
import { request } from '@/utils/request';
import { api } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME, unwrap } from '@/lib/query';
import { reportDashboardKeys } from './report-dashboards';
import { mergeReportLookupOptions } from './report-lookups';

export interface DatasetDataState {
  data: ReportDataResult | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_DATASET_STATE: DatasetDataState = { data: null, loading: false, error: null };

export const reportDesignerKeys = {
  all: ['report', 'designer'] as const,
  datasets: ['report', 'designer', 'datasets'] as const,
  dashboards: (excludeId: number | undefined) => ['report', 'designer', 'dashboards', excludeId] as const,
  datasetDataPrefix: ['report', 'designer', 'dataset-data'] as const,
  datasetData: (datasetId: number, params: Record<string, unknown>, limit: number) =>
    ['report', 'designer', 'dataset-data', datasetId, params, limit] as const,
  metricDataPrefix: ['report', 'designer', 'metric-data'] as const,
  metricData: (metricId: number, params: Record<string, unknown>) =>
    ['report', 'designer', 'metric-data', metricId, params] as const,
  dictItems: (code: string) => ['report', 'designer', 'dict-items', code] as const,
};

export function useReportDesignerDatasets(
  currentDataset?: Pick<ReportDataset, 'id' | 'name' | 'status'> | null,
  keyword?: string,
) {
  return useQuery({
    queryKey: [...reportDesignerKeys.datasets, currentDataset?.id ?? null, keyword ?? ''],
    queryFn: async () => {
      const data = await request.get<ReportLookupOption[]>(
        `/api/report/datasets/lookup?status=enabled&limit=50${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}`,
        { silent: true },
      ).then(unwrap);
      return mergeReportLookupOptions(data, currentDataset ? [currentDataset] : []);
    },
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useReportDesignerDashboardLookup(excludeId: number | undefined, keyword?: string) {
  return useQuery({
    queryKey: [...reportDesignerKeys.dashboards(excludeId), keyword ?? ''],
    queryFn: async () => {
      const data = await request.get<ReportLookupOption[]>(
        `/api/report/dashboards/lookup?status=enabled&limit=50${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}`,
        { silent: true },
      ).then(unwrap);
      return data.filter((dashboard) => dashboard.id !== excludeId);
    },
    staleTime: LOOKUP_STALE_TIME,
  });
}

export function useSaveReportDashboardDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Record<string, unknown> }) =>
      request.put<ReportDashboard>(`/api/report/dashboards/${id}`, values, { silent: true }) as Promise<ApiResponse<ReportDashboard>>,
    onSuccess: (_data, vars) => {
      // 设计器保存即改写看板内容：详情（各模式）、列表与该看板的取数结果都要回源
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.detailOf(vars.id) });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.lists });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.dataOf(vars.id) });
      // 设计器自身的取数缓存（datasetData / metricData）随组件配置变化
      void qc.invalidateQueries({ queryKey: reportDesignerKeys.datasetDataPrefix });
      void qc.invalidateQueries({ queryKey: reportDesignerKeys.metricDataPrefix });
      // datasets / dashboards / dictItems 是设计器的下拉源，与本次保存无关
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

export function useReportDatasetDataMap(datasetIds: number[], limit = 500) {
  const queryClient = useQueryClient();
  const ids = useMemo(() => Array.from(new Set(datasetIds.filter((id) => id > 0))).sort((a, b) => a - b), [datasetIds]);
  // combine：返回值引用稳定（仅底层查询结果变化时重算），可安全用于下游依赖
  const stateMap = useQueries({
    queries: ids.map((id) => ({
      queryKey: reportDesignerKeys.datasetData(id, {}, limit),
      queryFn: ({ signal }) =>
        request.post<ReportDataResult>(`/api/report/datasets/${id}/data`, { limit }, { silent: true, signal }).then(unwrap),
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
    void queryClient.refetchQueries({ queryKey: [...reportDesignerKeys.all, 'dataset-data'], type: 'active' });
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
      queryFn: async ({ signal }) => {
        if (entry.source === 'dataset') {
          return request.post<ReportDataResult>(`/api/report/datasets/${entry.id}/data`, { params: entry.params, limit }, { silent: true, signal }).then(unwrap);
        }
        const result = await request.post<ReportMetricEvaluation>(
          `/api/report/metrics/${entry.id}/evaluate`,
          { params: entry.params },
          { silent: true, signal },
        ).then(unwrap);
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
    void queryClient.refetchQueries({ queryKey: reportDesignerKeys.all, type: 'active' });
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
      queryFn: ({ signal }) =>
        request.post<ReportDataResult>(`/api/report/datasets/${entry.datasetId}/data`, { limit: 500 }, { silent: true, signal }).then(unwrap),
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
