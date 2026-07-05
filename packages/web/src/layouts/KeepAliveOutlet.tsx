import { Activity, useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';

const MAX_CACHE = 10;

type CacheEntry = {
  element: ReactElement | null;
  /** 页签刷新版本，变化时强制重建子树 */
  version: number;
  /** 离开时的滚动位置（.admin-content 容器为共享滚动容器，需按页保存/恢复） */
  scrollTop: number;
};

type Props = Readonly<{
  /** 允许缓存的路由路径白名单（来自菜单 keepAlive 配置） */
  keepAlivePaths: ReadonlySet<string>;
  /** 当前打开的页签 key 集合；缓存生命周期与页签一致，关闭页签即释放 */
  openPaths: ReadonlySet<string>;
  /** 页签「刷新」版本号，变化时强制重建对应页面 */
  refreshVersion: Record<string, number>;
  /** 共享滚动容器选择器 */
  scrollContainerSelector?: string;
  /** 非缓存页的路由动画 class（缓存页不参与动画，避免 remount 丢缓存） */
  animationClass?: string;
}>;

/**
 * 基于 React 19 `<Activity>` 的路由级页面缓存（对标 Vue keep-alive）。
 *
 * - 白名单制：仅菜单配置 keepAlive 的页面参与缓存
 * - hidden 时 React 保留 state/DOM（display:none）并销毁 Effects（轮询/订阅自动暂停），
 *   visible 时恢复状态并重建 Effects
 * - 缓存生命周期与页签一致：关闭页签即释放；LRU 上限 10 页
 * - 页签「刷新」通过 key 变化强制重建
 * - 共享滚动容器（.admin-content）的滚动位置按页保存/恢复
 */
export default function KeepAliveOutlet({
  keepAlivePaths,
  openPaths,
  refreshVersion,
  scrollContainerSelector = '.admin-content',
  animationClass,
}: Props) {
  const outlet = useOutlet();
  const { pathname } = useLocation();
  const cacheRef = useRef(new Map<string, CacheEntry>());
  const prevPathRef = useRef<string | null>(null);
  const cache = cacheRef.current;

  const isCacheable = keepAlivePaths.has(pathname);
  const currentVersion = refreshVersion[pathname] ?? 0;

  // ── 渲染期维护缓存（幂等，StrictMode 安全）──────────────────────────────
  if (isCacheable) {
    const existing = cache.get(pathname);
    if (!existing || existing.version !== currentVersion) {
      // 新入缓存 / 刷新重建：记录当前 outlet 与版本
      cache.delete(pathname);
      cache.set(pathname, { element: outlet, version: currentVersion, scrollTop: existing?.scrollTop ?? 0 });
    } else {
      // LRU：访问移到末尾
      cache.delete(pathname);
      cache.set(pathname, existing);
    }
  }
  // 页签已关闭的缓存立即释放（缓存生命周期 = 页签生命周期）
  for (const key of [...cache.keys()]) {
    if (key !== pathname && !openPaths.has(key)) cache.delete(key);
  }
  // LRU 上限：淘汰最久未访问（跳过当前页）
  while (cache.size > MAX_CACHE) {
    const oldest = [...cache.keys()].find((k) => k !== pathname);
    if (!oldest) break;
    cache.delete(oldest);
  }

  // ── 共享滚动容器：离开时保存、切回时恢复 ─────────────────────────────────
  useEffect(() => {
    const container = document.querySelector<HTMLElement>(scrollContainerSelector);
    const prev = prevPathRef.current;
    if (container && prev && prev !== pathname) {
      const prevEntry = cache.get(prev);
      if (prevEntry) prevEntry.scrollTop = container.scrollTop;
    }
    if (container) {
      container.scrollTop = cache.get(pathname)?.scrollTop ?? 0;
    }
    prevPathRef.current = pathname;
  }, [pathname, scrollContainerSelector, cache]);

  return (
    <>
      {[...cache.entries()].map(([path, entry]) => (
        <Activity key={`${path}:${entry.version}`} mode={path === pathname ? 'visible' : 'hidden'}>
          <div style={{ height: '100%' }}>{entry.element}</div>
        </Activity>
      ))}
      {!isCacheable && (
        <div key={`${pathname}:${currentVersion}`} style={{ height: '100%' }} className={animationClass}>
          {outlet}
        </div>
      )}
    </>
  );
}
