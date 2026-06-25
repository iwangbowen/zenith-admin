import { useEffect, useState } from 'react';
import { mediaDown } from '@/lib/breakpoints';

function getMatches(query: string): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia(query).matches;
}

/**
 * 订阅一个 CSS media query，返回当前是否匹配。
 *
 * - SSR / 无 `matchMedia` 环境安全（返回 false）
 * - 首次渲染即同步读取真实值，避免桌面↔移动布局闪烁
 * - 仅在 query 变化时重新订阅，使用 `change` 事件而非 `resize`
 *
 * 组件级响应式的统一入口；断点请从 `@/lib/breakpoints` 取，避免硬编码。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => getMatches(query));

  useEffect(() => {
    if (typeof globalThis.matchMedia !== 'function') return;
    const mql = globalThis.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    // render 与 effect 之间断点可能已变化，挂载时再同步一次
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** 是否为移动端宽度（< 768px）。组件级响应式的统一入口。 */
export function useIsMobile(): boolean {
  return useMediaQuery(mediaDown('md'));
}

/** 系统是否偏好深色模式（prefers-color-scheme: dark）。深色判断的统一入口。 */
export function usePrefersDark(): boolean {
  return useMediaQuery('(prefers-color-scheme: dark)');
}
