import { useId } from 'react';
import './AppLogo.css';

interface AppLogoProps {
  size?: number;
  className?: string;
}

/**
 * 品牌标识：Z 形折带。三块折面（顶杠 / 斜带 / 底杠）以主题主色为基准派生明暗，
 * 无底色，可直接置于浅色或深色背景；与 `public/favicon.svg` 共用同一套几何。
 */
export default function AppLogo({ size = 28, className }: Readonly<AppLogoProps>) {
  const uid = useId().replaceAll(/[^a-zA-Z0-9]/g, '');
  const topId = `app-logo-top-${uid}`;
  const bandId = `app-logo-band-${uid}`;
  const baseId = `app-logo-base-${uid}`;
  const cls = ['app-logo', className].filter(Boolean).join(' ');
  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={topId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="app-logo__top-a" />
          <stop offset="1" className="app-logo__top-b" />
        </linearGradient>
        <linearGradient id={bandId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="app-logo__band-a" />
          <stop offset="1" className="app-logo__band-b" />
        </linearGradient>
        <linearGradient id={baseId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="app-logo__base-a" />
          <stop offset="1" className="app-logo__base-b" />
        </linearGradient>
      </defs>
      <path d="M14 7 L56 7 L33.9 19 L14 19Z" fill={`url(#${topId})`} stroke={`url(#${topId})`} strokeWidth={2.5} strokeLinejoin="round" />
      <path d="M56 7 L33.9 19 L6.84 57 L32.62 43Z" fill={`url(#${bandId})`} stroke={`url(#${bandId})`} strokeWidth={2.5} strokeLinejoin="round" />
      <path d="M32.62 43 L58 43 L58 57 L6.84 57Z" fill={`url(#${baseId})`} stroke={`url(#${baseId})`} strokeWidth={2.5} strokeLinejoin="round" />
    </svg>
  );
}
