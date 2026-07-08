/**
 * 深浅色切换的 View Transition 圆形扩散动画。
 * 以最近一次 pointerdown 的坐标为圆心，新主题以圆形裁剪从点击处扩散铺满全屏；
 * 不支持 View Transition API 或用户偏好减少动效时，直接应用变更（优雅降级）。
 */

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { ready: Promise<void> };
};

let lastPointer: { x: number; y: number; time: number } | null = null;

// 捕获阶段全局记录指针位置，避免在 Semi 组件回调中层层透传原生事件
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => { lastPointer = { x: e.clientX, y: e.clientY, time: Date.now() }; },
    { capture: true, passive: true },
  );
}

export function withThemeTransition(applyChange: () => void) {
  const doc = document as ViewTransitionDocument;
  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || prefersReducedMotion) {
    applyChange();
    return;
  }

  // 3 秒内的点击视为本次切换的触发源；否则从屏幕中心扩散（如快捷键触发）
  const recent = lastPointer && Date.now() - lastPointer.time < 3000 ? lastPointer : null;
  const x = recent?.x ?? window.innerWidth / 2;
  const y = recent?.y ?? window.innerHeight / 2;

  const transition = doc.startViewTransition(applyChange);
  transition.ready
    .then(() => {
      const maxRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${maxRadius}px at ${x}px ${y}px)`] },
        { duration: 500, easing: 'cubic-bezier(0.25, 1, 0.5, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    })
    .catch(() => { /* 快照失败时忽略，变更已生效 */ });
}
