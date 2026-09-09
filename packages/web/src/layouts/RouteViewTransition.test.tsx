/**
 * RouteViewTransition 单元测试
 *
 * jsdom 没有 View Transitions API，React 会静默跳过动画；这里只保证：
 *  1. 各偏好取值下边界对子树透明（子节点正常渲染、无运行时报错）
 *  2. 与 KeepAliveOutlet 的 <Activity> 组合：hidden 时保留 DOM 且 display:none，visible 时恢复
 */
import { Activity } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import RouteViewTransition from './RouteViewTransition';

describe('RouteViewTransition', () => {
  it.each(['none', 'fade', 'slide-up', 'slide-left'] as const)('animation=%s 时透明渲染子节点', (animation) => {
    render(
      <RouteViewTransition animation={animation}>
        <div data-testid="page">页面内容</div>
      </RouteViewTransition>,
    );
    expect(screen.getByTestId('page')).toHaveTextContent('页面内容');
  });

  it('未传 animation 时同样渲染子节点', () => {
    render(
      <RouteViewTransition>
        <div>默认内容</div>
      </RouteViewTransition>,
    );
    expect(screen.getByText('默认内容')).toBeInTheDocument();
  });

  it('包在 <Activity> 内：hidden 保留 DOM 且不可见，visible 后恢复', () => {
    const { rerender } = render(
      <Activity mode="hidden">
        <RouteViewTransition animation="fade">
          <div data-testid="cached">缓存页</div>
        </RouteViewTransition>
      </Activity>,
    );
    const hidden = screen.getByTestId('cached');
    expect(hidden).toBeInTheDocument();
    expect(hidden).not.toBeVisible();

    rerender(
      <Activity mode="visible">
        <RouteViewTransition animation="fade">
          <div data-testid="cached">缓存页</div>
        </RouteViewTransition>
      </Activity>,
    );
    expect(screen.getByTestId('cached')).toBeVisible();
  });
});
