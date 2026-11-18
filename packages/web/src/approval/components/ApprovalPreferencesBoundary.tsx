import { useLayoutEffect, type ReactNode } from 'react';
import { useApprovalMultiSelectLayout } from '../lib/preferences';

/** 只在审批端已登录路由内应用；Portal 弹层同样受 body 标记控制。 */
export function ApprovalPreferencesBoundary({ children }: Readonly<{ children: ReactNode }>) {
  const layout = useApprovalMultiSelectLayout();
  useLayoutEffect(() => {
    document.body.dataset.multiSelectLayout = layout;
    return () => { delete document.body.dataset.multiSelectLayout; };
  }, [layout]);
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      document.body.style.setProperty('--ap-viewport-height', `${height}px`);
      document.body.style.setProperty('--ap-keyboard-offset', `${Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0))}px`);
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.body.style.removeProperty('--ap-viewport-height');
      document.body.style.removeProperty('--ap-keyboard-offset');
    };
  }, []);
  return children;
}
