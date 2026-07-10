import { useCallback, useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiResponse,
  DictItem,
  ReportDashboard,
  ReportDataResult,
  ReportDataset,
  ReportFilter,
  ReportLookupOption,
  ReportWidget,
} from '@zenith/shared';
import { request } from '@/utils/request';
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
  datasetData: (datasetId: number, params: Record<string, unknown>, limit: number) =>
    ['report', 'designer', 'dataset-data', datasetId, params, limit] as const,
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
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.all });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.detail(vars.id, 'draft') });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.detail(vars.id, 'auto') });
      void qc.invalidateQueries({ queryKey: reportDesignerKeys.all });
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
    const map = new Map<string, { key: string; datasetId: number; params: Record<string, unknown> }>();
    for (const widget of widgets ?? []) {
      if (!widget.datasetId) continue;
      const params = computeWidgetParams(widget, filterValues);
      const key = `${widget.datasetId}:${JSON.stringify(params)}`;
      if (!map.has(key)) map.set(key, { key, datasetId: widget.datasetId, params });
    }
    return Array.from(map.values());
  }, [widgets, filterValues]);

  const stateMap = useQueries({
    queries: entries.map((entry) => ({
      queryKey: reportDesignerKeys.datasetData(entry.datasetId, entry.params, limit),
      queryFn: ({ signal }) =>
        request.post<ReportDataResult>(`/api/report/datasets/${entry.datasetId}/data`, { params: entry.params, limit }, { silent: true, signal }).then(unwrap),
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
    if (!widget.datasetId) return EMPTY_DATASET_STATE;
    const key = `${widget.datasetId}:${JSON.stringify(computeWidgetParams(widget, filterValues))}`;
    return stateMap.get(key) ?? EMPTY_DATASET_STATE;
  }, [filterValues, stateMap]);

  const refresh = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: [...reportDesignerKeys.all, 'dataset-data'], type: 'active' });
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
      queryFn: () => request.get<DictItem[]>(`/api/dicts/code/${encodeURIComponent(code)}/items`, { silent: true }).then(unwrap),
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
