import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useElementSize } from './useElementSize';

type ResizeCallback = (entries: Array<{ contentRect: { width: number; height: number } }>) => void;

const observers: Array<{ callback: ResizeCallback; observed: Element[]; disconnect: () => void }> = [];

class FakeResizeObserver {
  observed: Element[] = [];
  disconnect = vi.fn();
  constructor(private readonly callback: ResizeCallback) {
    observers.push({ callback, observed: this.observed, disconnect: this.disconnect });
  }
  observe(el: Element) { this.observed.push(el); }
  unobserve() { /* noop */ }
}

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  observers.length = 0;
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

describe('useElementSize', () => {
  it('未挂载元素时保持初始占位值，不创建 observer', () => {
    const { result } = renderHook(() => useElementSize<HTMLDivElement>({ height: 500 }));
    expect(result.current.height).toBe(500);
    expect(result.current.width).toBe(0);
    expect(observers).toHaveLength(0);
  });

  it('挂载后观察元素，contentRect 变化向下取整写回，卸载时 disconnect', () => {
    const el = document.createElement('div');
    const { result, unmount } = renderHook(() => {
      const size = useElementSize<HTMLDivElement>({ height: 500 });
      // 模拟 ref 挂载：effect 在 commit 后读取 ref.current
      (size.ref as { current: HTMLDivElement | null }).current = el;
      return size;
    });
    expect(observers).toHaveLength(1);
    expect(observers[0].observed).toEqual([el]);

    act(() => observers[0].callback([{ contentRect: { width: 800.7, height: 360.2 } }]));
    expect(result.current.width).toBe(800);
    expect(result.current.height).toBe(360);

    unmount();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('无 ResizeObserver 的环境不报错并保持占位值', () => {
    // @ts-expect-error 模拟不支持 ResizeObserver 的环境
    delete globalThis.ResizeObserver;
    const el = document.createElement('div');
    const { result } = renderHook(() => {
      const size = useElementSize<HTMLDivElement>({ width: 10, height: 20 });
      (size.ref as { current: HTMLDivElement | null }).current = el;
      return size;
    });
    expect(result.current).toMatchObject({ width: 10, height: 20 });
  });
});
