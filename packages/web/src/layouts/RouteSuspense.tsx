import { Suspense } from 'react';
import type { ReactNode } from 'react';
import PageLoading from '@/components/PageLoading';
import { useRouteAnimation } from '@/hooks/usePreferences';
import RouteViewTransition from './RouteViewTransition';

type Props = Readonly<{
  /** 懒加载期间的占位；默认行内加载态 */
  fallback?: ReactNode;
  children: ReactNode;
}>;

/**
 * 后台布局内懒加载页面的 Suspense 边界。
 *
 * 路由切换时页面容器整体走 RouteViewTransition；但每个路由的 Suspense 是随导航新挂载的边界，
 * 首次访问会先提交 fallback，chunk 就绪后再揭示内容——这一步默认是硬切，肉眼看就是"闪一下"。
 * 这里把 fallback 与内容各自包进 RouteViewTransition：揭示时 fallback 走退出、内容走进入，
 * 与路由切换保持同一套动画偏好。
 */
export default function RouteSuspense({ fallback, children }: Props) {
  const animation = useRouteAnimation();
  return (
    <Suspense
      fallback={<RouteViewTransition animation={animation}>{fallback ?? <PageLoading inline />}</RouteViewTransition>}
    >
      <RouteViewTransition animation={animation}>{children}</RouteViewTransition>
    </Suspense>
  );
}
