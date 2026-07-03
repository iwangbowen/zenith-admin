import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useMpAccountOptions } from '@/hooks/queries/mp-accounts';

const STORAGE_KEY = 'mp_current_account';

/**
 * 公众号管理模块共享 hook：加载公众号列表 + 维护「当前公众号」选择（localStorage 持久化，跨页面共享）。
 * 额外暴露 `currentIdRef`：供页面在异步请求返回后判断账号是否已切换，丢弃过期响应（防止账号 A 的数据渲染到账号 B）。
 */
export function useMpAccounts() {
  const [currentId, setCurrentIdState] = useState<number | null>(() => {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? Number(v) : null;
  });
  const accountsQuery = useMpAccountOptions();
  const accounts = useMemo(() => accountsQuery.data?.list ?? [], [accountsQuery.data?.list]);

  // 始终指向最新 currentId，供异步回调比对
  const currentIdRef = useRef<number | null>(currentId);
  currentIdRef.current = currentId;

  const setCurrentId = useCallback((id: number | null) => {
    setCurrentIdState(id);
    if (id == null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(id));
  }, []);

  useEffect(() => {
    if (!accountsQuery.isSuccess) return;
    const stored = localStorage.getItem(STORAGE_KEY);
    const storedId = stored ? Number(stored) : null;
    if (storedId && accounts.some((a) => a.id === storedId)) {
      if (currentId !== storedId) setCurrentIdState(storedId);
      return;
    }
    if (currentId && accounts.some((a) => a.id === currentId)) return;
    const pick = (accounts.find((a) => a.isDefault) ?? accounts[0])?.id ?? null;
    if (currentId !== pick) setCurrentId(pick);
  }, [accounts, accountsQuery.isSuccess, currentId, setCurrentId]);

  return { accounts, currentId, currentIdRef, setCurrentId, loading: accountsQuery.isFetching };
}
