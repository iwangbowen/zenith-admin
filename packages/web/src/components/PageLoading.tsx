import { readCachedPreferences } from '@/lib/preference-cache';
import {
  defaultPreferences,
  isLoadingStyle,
  useOptionalPreferences,
} from '@/hooks/usePreferences';
import type { LoadingStyle } from '@/hooks/usePreferences';

function readCachedLoadingStyle(): LoadingStyle {
  return readCachedPreferences().loadingStyle;
}

export function LoadingIndicator({ variant }: Readonly<{ variant: LoadingStyle }>) {
  return (
    <span
      className={`page-loading-indicator page-loading-indicator--${variant}`}
      data-loading-style={variant}
      aria-hidden="true"
    >
      {variant === 'dots' && (
        <>
          <span className="page-loading__dot" />
          <span className="page-loading__dot" />
          <span className="page-loading__dot" />
        </>
      )}
      {variant === 'ring' && <span className="page-loading__ring" />}
      {variant === 'flip' && <span className="page-loading__flip" />}
      {variant === 'bars' && (
        <>
          <span className="page-loading__bar" />
          <span className="page-loading__bar" />
          <span className="page-loading__bar" />
          <span className="page-loading__bar" />
        </>
      )}
      {variant === 'spinner' && (
        <span className="page-loading__spinner">
          {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
        </span>
      )}
      {variant === 'bounce' && (
        <>
          <span className="page-loading__bounce-dot" />
          <span className="page-loading__bounce-dot" />
        </>
      )}
      {variant === 'ripple' && (
        <span className="page-loading__ripple">
          <i />
          <i />
        </span>
      )}
      {variant === 'progress' && (
        <span className="page-loading__track">
          <i className="page-loading__thumb" />
        </span>
      )}
      {variant === 'orbit' && (
        // 两颗圆点固定在旋转容器的上下极：容器自转即两点绕圈，圆点自身无需再动
        <span className="page-loading__orbit">
          <i />
          <i />
        </span>
      )}
      {variant === 'grid' && (
        <span className="page-loading__grid">
          {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
        </span>
      )}
      {variant === 'travel' && <span className="page-loading__travel" />}
      {variant === 'ellipsis' && (
        <>
          <span className="page-loading__ellipsis-dot" />
          <span className="page-loading__ellipsis-dot" />
          <span className="page-loading__ellipsis-dot" />
        </>
      )}
      {variant === 'carousel' && (
        // 三个静态槽位 + 一颗游走的光点：单程从左到右，在首尾不可见时重置，故看不到回弹
        <span className="page-loading__carousel">
          <i className="page-loading__carousel-slot" />
          <i className="page-loading__carousel-slot" />
          <i className="page-loading__carousel-slot" />
          <i className="page-loading__carousel-bead" />
        </span>
      )}
      {variant === 'landing' && (
        // 地面参照（影子）与球分开：球靠 transform-origin 落在底部做压扁，影子随高度缩放
        <span className="page-loading__landing">
          <i className="page-loading__landing-ball" />
          <i className="page-loading__landing-shadow" />
        </span>
      )}
      {variant === 'pendulum' && (
        // 摆锤是摆杆的子元素：刚性由结构保证。曾把两者做成各自旋转的兄弟以避开透明度继承，
        // 但那样要求两个 transform-origin 换算到同一世界点（锤的轴心在自身负 y 方向），
        // 极易写错且错了看不出来 —— 两元素变换矩阵相同只代表角度相同，不代表轴心相同。
        <span className="page-loading__pendulum">
          <i className="page-loading__pendulum-pivot" />
          <span className="page-loading__pendulum-arm">
            <i className="page-loading__pendulum-bob" />
          </span>
        </span>
      )}
      {variant === 'marquee' && (
        // 轨道比可视区宽一倍，位移恰好等于虚线一个周期的整数倍，循环无缝
        <span className="page-loading__marquee">
          <i className="page-loading__marquee-track" />
        </span>
      )}
    </span>
  );
}

export default function PageLoading({
  inline = false,
  variant,
  label = '页面加载中',
}: Readonly<{
  inline?: boolean;
  variant?: LoadingStyle;
  label?: string;
}>) {
  const preferencesContext = useOptionalPreferences();
  const preferredStyle = variant
    ?? preferencesContext?.preferences.loadingStyle
    ?? readCachedLoadingStyle();
  const resolvedStyle = isLoadingStyle(preferredStyle)
    ? preferredStyle
    : defaultPreferences.loadingStyle;

  return (
    <div
      className={`page-loading${inline ? ' page-loading--inline' : ''}`}
      data-loading-style={resolvedStyle}
      role="status"
      aria-label={label}
    >
      <LoadingIndicator variant={resolvedStyle} />
    </div>
  );
}
