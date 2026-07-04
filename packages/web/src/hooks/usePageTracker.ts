import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView, trackPageLeave, getMaxScrollDepth, resetScrollDepth } from '@/utils/tracker';

/**
 * Auto-tracks page enter / leave for the current route.
 *
 * Place this hook in a page component (or in a global layout) to
 * automatically record dwell time. Only counts time while the tab is
 * visible (background time is excluded), and reports the max scroll
 * depth reached on the page.
 *
 * @param pageTitle  Human-readable page title, e.g. '用户管理'
 */
export function usePageTracker(pageTitle?: string) {
  const location = useLocation();

  useEffect(() => {
    let visibleMs = 0;
    let visibleSince: number | null = document.visibilityState === 'visible' ? Date.now() : null;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (visibleSince != null) { visibleMs += Date.now() - visibleSince; visibleSince = null; }
      } else if (visibleSince == null) {
        visibleSince = Date.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    resetScrollDepth();
    trackPageView(location.pathname, pageTitle);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (visibleSince != null) visibleMs += Date.now() - visibleSince;
      trackPageLeave(location.pathname, visibleMs, pageTitle, getMaxScrollDepth());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
}
