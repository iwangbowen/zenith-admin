import { useState, useEffect } from 'react';
import type { DictItem } from '@zenith/shared';
import { request } from '@/utils/request';

// 简单内存缓存，避免同一 code 重复请求
const cache = new Map<string, DictItem[]>();

export function useDictItems(code: string) {
  const [items, setItems] = useState<DictItem[]>(() => cache.get(code) ?? []);
  const [loading, setLoading] = useState(!cache.has(code));

  useEffect(() => {
    if (!code) return;
    if (cache.has(code)) {
      setItems(cache.get(code)!);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    request.get<DictItem[]>(`/api/dicts/code/${code}/items`).then((res) => {
      if (cancelled) return;
      if (res.code === 0) {
        cache.set(code, res.data);
        setItems(res.data);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [code]);

  /** 根据 value 查找 label */
  const getLabel = (value: string) => items.find((i) => i.value === value)?.label ?? value;

  /** 根据 value 查找 color */
  const getColor = (value: string) => items.find((i) => i.value === value)?.color;

  return { items, loading, getLabel, getColor };
}
