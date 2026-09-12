import { useCallback, useMemo } from 'react';
// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import type { BodyOf } from '@zenith/shared/core';
import { dictContract } from '@zenith/shared/platform';
import {
  reportDashboardContract,
  reportDatasetContract,
  reportMetricContract,
  computeWidgetParams,
  type ReportDataResult,
  type ReportDataset,
  type ReportFilter,
  type ReportLookupOption,
  type ReportWidget,
} from '@zenith/shared/report';
import { api, apiQueryOptions, apiRaw, contractKey, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { dictKeys } from './dicts';
import { reportDashboardKeys } from './report-dashboards';
import { mergeReportLookupOptions } from './report-lookups';

export interface DatasetDataState {
  data: ReportDataResult | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_DATASET_STATE: DatasetDataState = { data: null, loading: false, error: null };

const silent = { silent: true } as const;

/** 设计器数据集下拉：只取启用中的前 50 条 */
const designerDatasetLookupQuery = (keyword: string) => ({ status: 'enabled' as const, limit: 50, keyword: keyword || undefined });
/** 设计器看板跳转下拉：排除当前看板自身 */
const designerDashboardLookupQuery = (excludeId: number | undefined, keyword: string) =>
  ({ status: 'enabled' as const, limit: 50, keyword: keyword || undefined, excludeId });

/** 设计器的数据集 / 指标取数与仪表盘正式取数分属不同操作，缓存互不干扰 */
export const reportDesignerKeys = {
  /** 与 useReportLookup('datasets', …) 同 key：当前数据集的合并在 select 里完成，不进入缓存身份 */
  datasets: (keyword: string) => contractKey(reportDatasetContract.lookup, { query: designerDatasetLookupQuery(keyword) }),
  dashboards: (excludeId: number | undefined, keyword: string) =>
    contractKey(reportDashboardContract.lookup, { query: designerDashboardLookupQuery(excludeId, keyword) }),
  datasetDataPrefix: contractKey(reportDatasetContract.data),
  datasetData: (datasetId: number, params: Record<string, unknown>, limit: number) =>
    contractKey(reportDatasetContract.data, { params: { id: datasetId }, body: { params, limit } }),
  metricDataPrefix: contractKey(reportMetricContract.evaluate),
  metricData: (metricId: number, params: Record<string, unknown>) =>
    contractKey(reportMetricContract.evaluate, { params: { id: metricId }, body: { params } }),
  /** 字典项来自 platform 域，与 useDictItems 共用同一缓存，随字典项增删改一并失效 */
  dictItems: dictKeys.itemsByCode,
};

/**
 * 数据集下拉（启用中）并把当前已选数据集合并进选项：已停用 / 超出前 50 条的当前项仍要能在下拉里显示。
 * 合并放在 select 里，缓存与 useReportLookup('datasets') 共享。
 */
export function useReportDesignerDatasets(
  currentDataset?: Pick<ReportDataset, 'id' | 'name' | 'status'> | null,
  keyword?: string,
) {
  const currentId = currentDataset?.id;
  const currentName = currentDataset?.name;
  const currentStatus = currentDataset?.status;
  const select = useCallback(
    (options: ReportLookupOption[]) =>
      mergeReportLookupOptions(options, currentId ? [{ id: currentId, name: currentName ?? '', status: currentStatus }] : []),
    [currentId, currentName, currentStatus],
  );
  return useApiQuery(reportDatasetContract.lookup, { query: designerDatasetLookupQuery(keyword ?? '') }, {
    staleTime: LOOKUP_STALE_TIME,
    requestOptions: silent,
    select,
  });
}

export function useReportDesignerDashboardLookup(excludeId: number | undefined, keyword?: string) {
  return useApiQuery(reportDashboardContract.lookup, { query: designerDashboardLookupQuery(excludeId, keyword ?? '') }, {
    staleTime: LOOKUP_STALE_TIME,
    requestOptions: silent,
  });
}

/**
 * 设计器保存即改写看板内容：详情（各模式）、列表与该看板的取数结果都要回源。
 * H5 保留：保存冲突（409）的载荷携带服务端当前 revision，调用方需要读取原始响应信封决定是否覆盖，
 * 故经 apiRaw 而不经 unwrap，无法用 useApiMutation。
 */
export function useSaveReportDashboardDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: BodyOf<typeof reportDashboardContract.update> }) =>
      apiRaw(reportDashboardContract.update, { params: { id }, body: values }, { silent: true }),
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '加载失败';
}

type DatasetDataInput = { params: { id: number }; body: { params: Record<string, unknown>; limit: number } };

/**
 * 数据集取数的 queryOptions：key / 类型由契约派生。
 * H5 保留 queryFn：设计器里组件增删、筛选切换会让在途取数立刻作废，必须按次透传 AbortSignal 中止
 * （apiQueryOptions 的 requestOptions 是静态选项，不接收 signal）。
 */
function datasetDataQueryOptions(id: number, params: Record<string, unknown>, limit: number) {
  const input: DatasetDataInput = { params: { id }, body: { params, limit } };
  return {
    ...apiQueryOptions(reportDatasetContract.data, input),
    queryFn: ({ signal }: { signal?: AbortSignal }) => api(reportDatasetContract.data, input, { ...silent, signal }),
  };
}

export function useReportDatasetDataMap(datasetIds: number[], limit = 500) {
  const queryClient = useQueryClient();
  const ids = useMemo(() => Array.from(new Set(datasetIds.filter((id) => id > 0))).sort((a, b) => a - b), [datasetIds]);
  // combine 必须是记忆化函数且返回普通对象：TanStack 只在 combine 引用或底层结果变化时重跑它，
  // 并用 replaceEqualDeep 对普通对象 / 数组做结构共享——内联函数每次渲染都重跑，Map 也不会被共享，
  // 下游拿到的引用就每次都变，任何基于它的 memo 都会失效
  const combine = useCallback((results: { data?: ReportDataResult; isFetching: boolean; error: unknown }[]) => {
    const map: Record<number, DatasetDataState> = {};
    ids.forEach((id, index) => {
      const query = results[index];
      map[id] = {
        data: query?.data ?? null,
        loading: query?.isFetching ?? false,
        error: query?.error ? errorMessage(query.error) : null,
      };
    });
    return map;
  }, [ids]);
  const stateMap = useQueries({
    queries: ids.map((id) => datasetDataQueryOptions(id, {}, limit)),
    combine,
  });

  const get = useCallback((id: number | null | undefined): DatasetDataState => {
    if (!id) return EMPTY_DATASET_STATE;
    return stateMap[id] ?? EMPTY_DATASET_STATE;
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

  // 见 useReportDatasetDataMap：记忆化 + 普通对象，让结果引用只在底层查询变化时改变
  const combine = useCallback((results: { data?: ReportDataResult; isFetching: boolean; error: unknown }[]) => {
    const map: Record<string, DatasetDataState> = {};
    entries.forEach((entry, index) => {
      const query = results[index];
      map[entry.key] = {
        data: query?.data ?? null,
        loading: query?.isFetching ?? false,
        error: query?.error ? errorMessage(query.error) : null,
      };
    });
    return map;
  }, [entries]);
  const stateMap = useQueries({
    queries: entries.map((entry) => (entry.source === 'dataset'
      ? datasetDataQueryOptions(entry.id, entry.params, limit)
      : {
        // H5 保留：指标取数是纯客户端派生——把指标值包装成与数据集同形的 ReportDataResult 供组件统一消费，并同样需要 signal
        queryKey: reportDesignerKeys.metricData(entry.id, entry.params),
        queryFn: async ({ signal }: { signal?: AbortSignal }): Promise<ReportDataResult> => {
          const result = await api(reportMetricContract.evaluate, { params: { id: entry.id }, body: { params: entry.params } }, { ...silent, signal });
          return {
            columns: ['value'],
            fields: [{ name: 'value', label: result.code, type: 'number' as const, source: 'declared' as const }],
            rows: [{ value: result.value, formattedValue: result.formattedValue }],
            total: 1,
          } satisfies ReportDataResult;
        },
      })),
    combine,
  });

  const get = useCallback((widget: ReportWidget): DatasetDataState => {
    const source = widget.metricId ? 'metric' : widget.datasetId ? 'dataset' : null;
    const id = widget.metricId ?? widget.datasetId;
    if (!source || !id) return EMPTY_DATASET_STATE;
    const key = `${source}:${id}:${JSON.stringify(computeWidgetParams(widget, filterValues))}`;
    return stateMap[key] ?? EMPTY_DATASET_STATE;
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
      ...datasetDataQueryOptions(entry.datasetId, {}, 500),
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
  const combine = useCallback((results: { data?: { value: string; label: string }[] }[]) => {
    const maps: Record<string, Record<string, string>> = {};
    normalizedCodes.forEach((code, index) => {
      const items = results[index]?.data ?? [];
      maps[code] = Object.fromEntries(items.map((item) => [item.value, item.label]));
    });
    return maps;
  }, [normalizedCodes]);
  return useQueries({
    queries: normalizedCodes.map((code) =>
      apiQueryOptions(dictContract.itemsByCode, { params: { code } }, { staleTime: LOOKUP_STALE_TIME, requestOptions: silent })),
    combine,
  });
}
