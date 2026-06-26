import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '@/utils/request';
import type { ReportDataResult, ReportWidget } from '@zenith/shared';

export interface DatasetDataState {
  data: ReportDataResult | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: DatasetDataState = { data: null, loading: false, error: null };

/** 计算单个组件的运行时参数（全局筛选器值 → 数据集参数）*/
export function computeWidgetParams(widget: ReportWidget, filterValues: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const b of widget.paramBindings ?? []) {
    if (b.filterId && b.param) params[b.param] = filterValues[b.filterId];
  }
  return params;
}

/**
 * 参数感知取数：按 (datasetId + params) 维度缓存。
 * 供设计器 / 预览页 / 嵌入组件复用，支持全局筛选器联动刷新。
 */
export function useWidgetData(widgets: ReportWidget[], filterValues: Record<string, unknown>, limit = 500) {
  const [map, setMap] = useState<Record<string, DatasetDataState>>({});
  const mapRef = useRef(map);
  mapRef.current = map;
  const inflight = useRef<Set<string>>(new Set());

  // 计算每个组件的缓存键
  const entries = (widgets ?? [])
    .filter((w) => w.datasetId)
    .map((w) => {
      const params = computeWidgetParams(w, filterValues);
      const key = `${w.datasetId}:${JSON.stringify(params)}`;
      return { key, datasetId: w.datasetId as number, params };
    });
  const sig = entries.map((e) => e.key).sort().join('|');

  const fetchKey = useCallback((key: string, datasetId: number, params: Record<string, unknown>, force = false) => {
    if (inflight.current.has(key)) return;
    if (!force && mapRef.current[key]?.data) return;
    inflight.current.add(key);
    setMap((m) => ({ ...m, [key]: { data: m[key]?.data ?? null, loading: true, error: null } }));
    request.post<ReportDataResult>(`/api/report/datasets/${datasetId}/data`, { params, limit }, { silent: true })
      .then((res) => {
        if (res.code === 0) setMap((m) => ({ ...m, [key]: { data: res.data, loading: false, error: null } }));
        else setMap((m) => ({ ...m, [key]: { data: null, loading: false, error: res.message || '加载失败' } }));
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : '加载失败';
        setMap((m) => ({ ...m, [key]: { data: null, loading: false, error: msg } }));
      })
      .finally(() => inflight.current.delete(key));
  }, [limit]);

  useEffect(() => {
    for (const e of entries) fetchKey(e.key, e.datasetId, e.params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, fetchKey]);

  const refresh = useCallback(() => {
    for (const e of entries) fetchKey(e.key, e.datasetId, e.params, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, fetchKey]);

  const get = useCallback((widget: ReportWidget): DatasetDataState => {
    if (!widget.datasetId) return EMPTY;
    const key = `${widget.datasetId}:${JSON.stringify(computeWidgetParams(widget, filterValues))}`;
    return map[key] ?? EMPTY;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sig]);

  return { get, refresh };
}
