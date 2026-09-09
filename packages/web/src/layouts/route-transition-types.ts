import { addTransitionType, startTransition } from 'react';
import type { NavigateFunction } from 'react-router-dom';

/** 路由 Transition 类型：目标位于当前页签左侧（后退方向），slide 类路由动画据此反向播放 */
export const ROUTE_BACK_TRANSITION_TYPE = 'route-back';

/**
 * 带方向标记的导航。
 *
 * react-router 会把导航 setState 包在自己的 startTransition 里；React 让嵌套 Transition 继承外层的
 * types，所以在这里的 startTransition 作用域内先 addTransitionType 再 navigate，
 * `<ViewTransition enter / exit={{ [ROUTE_BACK_TRANSITION_TYPE]: …, default: … }}>` 就能按方向选 class。
 * 非后退方向不附加类型，走 default class。
 */
export function navigateWithDirection(navigate: NavigateFunction, to: string, backward: boolean) {
  startTransition(() => {
    if (backward) addTransitionType(ROUTE_BACK_TRANSITION_TYPE);
    navigate(to);
  });
}
