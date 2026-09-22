import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

/**
 * 消费列表页的一次性深链筛选参数（如 `?memberKeyword=`）：
 * - URL 中出现目标参数时回调 `apply`（通常调 useListSearch 的 applySearch 触发查询），
 *   随后立即从 URL 移除已消费的参数——「消费即焚」，与全站列表筛选不入 URL 的行为保持一致；
 * - 依赖 searchParams 而非仅挂载：页签系统复用已挂载页面时，再次携参导航同样生效；
 * - 消费后参数即被清除，重置/刷新回到页面默认条件，深链不残留。
 * - getNextParams 可返回额外的 URL 参数（如目标 tab），与消费参数在同一次导航中写入，
 *   避免调用方另写 URL / setTab 与清参导航互相覆盖。
 */
export function useListDeepLink(
  keys: readonly string[],
  apply: (picked: Record<string, string>) => void,
  options?: { getNextParams?: (picked: Record<string, string>) => Record<string, string> | undefined },
): void {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const picked: Record<string, string> = {};
    for (const key of keys) {
      const value = searchParams.get(key);
      if (value) picked[key] = value;
    }
    if (Object.keys(picked).length === 0) return;
    applyRef.current(picked);
    const additions = optionsRef.current?.getNextParams?.(picked);
    const next = new URLSearchParams(searchParams);
    for (const key of Object.keys(picked)) next.delete(key);
    for (const [key, value] of Object.entries(additions ?? {})) next.set(key, value);
    // setSearchParams builds a search-only URL and clears the source object's hash.
    navigate({ search: next.toString(), hash: location.hash }, { replace: true, state: location.state });
    // keys 为页面字面量数组，按值快照做依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, navigate, location.hash, location.state, JSON.stringify(keys)]);
}
