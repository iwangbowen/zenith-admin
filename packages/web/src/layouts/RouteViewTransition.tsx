import { ViewTransition } from 'react';
import type { ReactNode, ViewTransitionClass } from 'react';
import type { RouteAnimation } from '@/hooks/usePreferences';
import { ROUTE_BACK_TRANSITION_TYPE } from './route-transition-types';

type AnimatedRouteAnimation = Exclude<RouteAnimation, 'none'>;

/**
 * 偏好值 → View Transition class；对应动画定义在 AdminLayout.css 的 `::view-transition-*(.route-vt-*)`。
 * 「左滑」按 Transition 类型区分方向：页签栏上切到左侧页签（ROUTE_BACK_TRANSITION_TYPE）时反向滑动。
 */
const ENTER_CLASS: Record<AnimatedRouteAnimation, ViewTransitionClass> = {
  fade: 'route-vt-fade-in',
  'slide-up': 'route-vt-slide-up-in',
  'slide-left': { [ROUTE_BACK_TRANSITION_TYPE]: 'route-vt-slide-right-in', default: 'route-vt-slide-left-in' },
};

const EXIT_CLASS: Record<AnimatedRouteAnimation, ViewTransitionClass> = {
  fade: 'route-vt-fade-out',
  'slide-up': 'route-vt-slide-up-out',
  'slide-left': { [ROUTE_BACK_TRANSITION_TYPE]: 'route-vt-slide-right-out', default: 'route-vt-slide-left-out' },
};

type Props = Readonly<{
  /** 路由切换动画偏好；`'none'` / 未传时完全关闭（含 reduceMotion 场景） */
  animation?: RouteAnimation;
  children: ReactNode;
}>;

/**
 * 路由级页面过渡边界：把 `routeAnimation` 偏好映射为 React `<ViewTransition>` 的 enter / exit class。
 *
 * - 只在 Transition 更新中激活：react-router 导航、`<Activity>` 显隐切换、`startTransition` 包裹的页签刷新
 * - `default="none"`：页面内部的 DOM 变化（搜索参数变更、Suspense 就绪等）不触发整页动画
 * - 必须直接包裹页面容器，边界之前不能出现其他 DOM 节点，否则不会激活
 * - 浏览器不支持 View Transitions（含 jsdom）时 React 直接跳过动画，功能不受影响
 */
export default function RouteViewTransition({ animation, children }: Props) {
  if (!animation || animation === 'none') {
    return <ViewTransition default="none">{children}</ViewTransition>;
  }
  return (
    <ViewTransition default="none" enter={ENTER_CLASS[animation]} exit={EXIT_CLASS[animation]}>
      {children}
    </ViewTransition>
  );
}
