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
  it('文档不可见时跳过 View Transition，子树仍正常渲染', () => {
    const descriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const child = <div>后台页</div>;

    try {
      expect(RouteViewTransition({ animation: 'fade', children: child })).toBe(child);
    } finally {
      if (descriptor) Object.defineProperty(document, 'visibilityState', descriptor);
      else Reflect.deleteProperty(document, 'visibilityState');
    }
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
