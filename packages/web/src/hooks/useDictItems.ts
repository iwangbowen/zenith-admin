import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dictContract } from '@zenith/shared/platform';
import { dictKeys } from '@/hooks/queries/dicts';
import { api } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

/**
 * 按字典编码获取字典项。
 * 基于 TanStack Query：同一 code 全局共享缓存、自动去重并发请求。
 */
export function useDictItems(code: string) {
  const { data, isPending } = useQuery({
    queryKey: dictKeys.itemsByCode(code),
    queryFn: () => api(dictContract.itemsByCode, { params: { code } }),
    enabled: !!code,
    staleTime: LOOKUP_STALE_TIME,
  });

  const items = useMemo(() => data ?? [], [data]);

  /** `{ value, label }` 选项数组：直接交给 `Form.Select` / `Select` 的 `optionList`，页面不再逐个 `.map` 转换 */
  const options = useMemo(() => items.map((item) => ({ value: item.value, label: item.label })), [items]);

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

  return { items, options, loading: !!code && isPending, getLabel, getColor };
}
