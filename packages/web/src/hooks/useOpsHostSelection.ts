import { useCallback, useState } from 'react';

const OPS_HOST_SELECTION_KEY = 'zenith_ops_selected_host';

/**
 * 由深链查询参数推导运维页的初始主机选择：
 * - 显式 `?hostId=`：按其值（非正整数视为本机）；
 * - 无 hostId 但带站内深链参数（`?path=` / `?pid=`）：语义是本机，返回 null，不得被上次持久化的远端主机污染；
 * - 两者皆无：返回 undefined，交给 `useOpsHostSelection` 读取持久化选择。
 */
export function deriveInitialHostSelection(searchParams: URLSearchParams, deepLinkKey: string): number | null | undefined {
  if (searchParams.has('hostId')) {
    const value = Number(searchParams.get('hostId'));
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  return searchParams.has(deepLinkKey) ? null : undefined;
}

/** 跨运维页面持久化当前主机；null 表示本机。 */
export function useOpsHostSelection(initial?: number | null) {
  const [hostId, setHostIdState] = useState<number | null>(() => {
    if (initial !== undefined) return initial;
    if (typeof window === 'undefined') return null;
    const value = Number(localStorage.getItem(OPS_HOST_SELECTION_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const setHostId = useCallback((next: number | null) => {
    setHostIdState(next);
    if (next == null) localStorage.removeItem(OPS_HOST_SELECTION_KEY);
    else localStorage.setItem(OPS_HOST_SELECTION_KEY, String(next));
  }, []);
  return [hostId, setHostId] as const;
}
