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
