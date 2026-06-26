import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '@/utils/request';
import type { ReportDataResult } from '@zenith/shared';

export interface DatasetDataState {
  data: ReportDataResult | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: DatasetDataState = { data: null, loading: false, error: null };

/**
 * 按 datasetId 批量拉取并缓存数据（同一 id 只拉一次）。
 * 供仪表盘设计器 / 预览页的多组件复用。
 */
export function useDatasetDataMap(datasetIds: number[], limit = 500) {
  const [map, setMap] = useState<Record<number, DatasetDataState>>({});
  const mapRef = useRef(map);
  mapRef.current = map;
  const inflight = useRef<Set<number>>(new Set());

  const fetchOne = useCallback((id: number, force = false) => {
    if (id <= 0) return;
    if (inflight.current.has(id)) return;
    if (!force && mapRef.current[id]?.data) return;
    inflight.current.add(id);
    setMap((m) => ({ ...m, [id]: { data: m[id]?.data ?? null, loading: true, error: null } }));
    request.get<ReportDataResult>(`/api/report/datasets/${id}/data?limit=${limit}`, { silent: true })
      .then((res) => {
        if (res.code === 0) setMap((m) => ({ ...m, [id]: { data: res.data, loading: false, error: null } }));
        else setMap((m) => ({ ...m, [id]: { data: null, loading: false, error: res.message || '加载失败' } }));
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : '加载失败';
        setMap((m) => ({ ...m, [id]: { data: null, loading: false, error: msg } }));
      })
      .finally(() => inflight.current.delete(id));
  }, [limit]);

  const key = Array.from(new Set(datasetIds.filter((id) => id > 0))).sort((a, b) => a - b).join(',');
  useEffect(() => {
    for (const id of key ? key.split(',').map(Number) : []) fetchOne(id);
  }, [key, fetchOne]);

  const refresh = useCallback(() => {
    for (const id of key ? key.split(',').map(Number) : []) fetchOne(id, true);
  }, [key, fetchOne]);

  const get = useCallback((id: number | null | undefined): DatasetDataState => {
    if (!id) return EMPTY;
    return map[id] ?? EMPTY;
  }, [map]);

  return { get, refresh };
}
