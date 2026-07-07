import { useEffect, useRef, useState } from 'react';

/**
 * 轻量下拉刷新：滚动容器顶部下拉超过阈值触发 onRefresh。
 * 返回绑定到滚动容器的 ref 与当前下拉状态（供指示器渲染）。
 */
export function usePullRefresh(onRefresh: () => Promise<unknown> | void, threshold = 64) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pulling = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const begin = (clientY: number) => {
      if (el.scrollTop <= 0) {
        startY.current = clientY;
        pulling.current = true;
      }
    };
    const move = (clientY: number): boolean => {
      if (!pulling.current || startY.current == null) return false;
      const dy = clientY - startY.current;
      if (dy > 0 && el.scrollTop <= 0) {
        // 阻尼系数 0.4，最大 96px
        setPull(Math.min(96, dy * 0.4));
        return true;
      }
      setPull(0);
      return false;
    };
    const end = () => {
      if (!pulling.current) return;
      pulling.current = false;
      startY.current = null;
      setPull((current) => {
        if (current >= threshold * 0.4 * 2.5 || current >= 56) {
          setRefreshing(true);
          Promise.resolve(onRefresh()).finally(() => {
            setRefreshing(false);
            setPull(0);
          });
          return 40; // 刷新中保持一段回弹高度
        }
        return 0;
      });
    };

    const onTouchStart = (e: TouchEvent) => begin(e.touches[0].clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (move(e.touches[0].clientY) && e.cancelable) e.preventDefault();
    };
    // 桌面鼠标拖拽：move/up 绑到 window，拖出容器仍可松手
    const onMouseMove = (e: MouseEvent) => {
      if (move(e.clientY)) e.preventDefault();
    };
    const onMouseUp = () => {
      end();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      begin(e.clientY);
      if (pulling.current) {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('mousedown', onMouseDown);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', end);
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onRefresh, threshold]);

  return { scrollRef: ref, pull, refreshing };
}

/** 触底自动加载：哨兵元素可见且 hasMore 时触发 onLoadMore */
export function useInfiniteSentinel(hasMore: boolean, loading: boolean, onLoadMore: () => void) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const cbRef = useRef(onLoadMore);
  cbRef.current = onLoadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) cbRef.current();
    }, { rootMargin: '120px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  return sentinelRef;
}
