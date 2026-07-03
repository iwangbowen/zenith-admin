import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DictItem } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap, LOOKUP_STALE_TIME } from '@/lib/query';

/**
 * 按字典编码获取字典项。
 * 基于 TanStack Query：同一 code 全局共享缓存、自动去重并发请求。
 */
export function useDictItems(code: string) {
  const { data, isPending } = useQuery({
    queryKey: ['dicts', 'code-items', code],
    queryFn: () => request.get<DictItem[]>(`/api/dicts/code/${code}/items`).then(unwrap),
    enabled: !!code,
    staleTime: LOOKUP_STALE_TIME,
  });

  const items = useMemo(() => data ?? [], [data]);

  /** 根据 value 查找 label */
  const getLabel = useCallback(
    (value: string) => items.find((i) => i.value === value)?.label ?? value,
    [items],
  );

  /** 根据 value 查找 color */
  const getColor = useCallback(
    (value: string) => items.find((i) => i.value === value)?.color,
    [items],
  );

  return { items, loading: !!code && isPending, getLabel, getColor };
}
