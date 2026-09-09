/**
 * RouteSuspense 单元测试
 *
 * jsdom 没有 View Transitions API，React 会静默跳过动画；这里只保证 Suspense 语义不变：
 *  1. 懒加载期间显示默认占位（PageLoading inline），chunk 就绪后揭示内容
 *  2. 支持自定义 fallback（首页骨架屏）
 */
import { lazy } from 'react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import RouteSuspense from './RouteSuspense';

type PageModule = { default: () => ReactElement };

describe('RouteSuspense', () => {
  it('懒加载期间显示默认占位，就绪后揭示内容', async () => {
    let resolvePage: ((m: PageModule) => void) | undefined;
    const LazyPage = lazy(() => new Promise<PageModule>((resolve) => { resolvePage = resolve; }));

    const { container } = render(
      <RouteSuspense>
        <LazyPage />
      </RouteSuspense>,
    );
    expect(screen.queryByText('页面内容')).toBeNull();
    expect(container.firstElementChild).not.toBeNull();

    await act(async () => {
      resolvePage?.({ default: () => <div>页面内容</div> });
    });
    expect(await screen.findByText('页面内容')).toBeInTheDocument();
  });

  it('支持自定义 fallback', () => {
    const NeverPage = lazy(() => new Promise<PageModule>(() => { /* 永不就绪 */ }));
    render(
      <RouteSuspense fallback={<div>骨架屏</div>}>
        <NeverPage />
      </RouteSuspense>,
    );
    expect(screen.getByText('骨架屏')).toBeInTheDocument();
  });
});
