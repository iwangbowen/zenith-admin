import { useEffect, useRef, useState, type RefObject } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * 用 `ResizeObserver` 订阅元素内容盒尺寸（`contentRect`，向下取整），供「表格 / 画布填满剩余高度」这类布局取数。
 *
 * - 返回的 `ref` 挂到被测元素上；`initial` 是首次测量前的占位值（默认 0×0）
 * - 无 `ResizeObserver` 的环境（SSR / 老浏览器）保持占位值
 * - 组件卸载自动 `disconnect`，页面不必再手写 observer 生命周期
 *
 * @example
 * const { ref, height } = useElementSize<HTMLDivElement>({ height: 500 });
 * <div ref={ref} style={{ flex: 1, minHeight: 0 }}><Table scroll={{ y: height }} /></div>
 */
export function useElementSize<T extends HTMLElement = HTMLElement>(
  initial: Partial<ElementSize> = {},
): ElementSize & { ref: RefObject<T | null> } {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: initial.width ?? 0, height: initial.height ?? 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.floor(entry.contentRect.width);
        const height = Math.floor(entry.contentRect.height);
        setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, ...size };
}
