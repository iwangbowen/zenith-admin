import { useId } from 'react';
import { LOGO_FACES, LOGO_STROKE_WIDTH, LOGO_VIEW_BOX, logoGradientAxis, logoStopCssColor } from '@/lib/brand-logo';
import './AppLogo.css';

interface AppLogoProps {
  size?: number;
  className?: string;
}

/**
 * 品牌标识：Z 形折带。三块折面以所在区域的 --semi-color-primary 为基准派生明暗，
 * 无底色，可直接置于浅色或深色背景；几何与配色比例见 `lib/brand-logo.ts`（favicon 同源）。
 */
export default function AppLogo({ size = 28, className }: Readonly<AppLogoProps>) {
  const uid = useId().replaceAll(/[^a-zA-Z0-9]/g, '');
  const gradientId = (key: string) => `app-logo-${key}-${uid}`;
  const cls = ['app-logo', className].filter(Boolean).join(' ');
  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox={LOGO_VIEW_BOX}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {LOGO_FACES.map((face) => (
          <linearGradient key={face.key} id={gradientId(face.key)} {...logoGradientAxis(face.axis)}>
            <stop offset="0" style={{ stopColor: logoStopCssColor(face.stops[0]) }} />
            <stop offset="1" style={{ stopColor: logoStopCssColor(face.stops[1]) }} />
          </linearGradient>
        ))}
      </defs>
      {LOGO_FACES.map((face) => (
        <path
          key={face.key}
          d={face.d}
          fill={`url(#${gradientId(face.key)})`}
          stroke={`url(#${gradientId(face.key)})`}
          strokeWidth={LOGO_STROKE_WIDTH}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
