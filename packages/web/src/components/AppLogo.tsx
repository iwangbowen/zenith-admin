import './AppLogo.css';

interface AppLogoProps {
  size?: number;
  variant?: 'solid' | 'glass';
  className?: string;
}

export default function AppLogo({ size = 28, variant = 'solid', className }: Readonly<AppLogoProps>) {
  const borderRadius = Math.round(size * 0.25);
  const fontSize = Math.round(size * 0.5);
  const cls = ['app-logo', `app-logo--${variant}`, className].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      style={{ width: size, height: size, borderRadius, fontSize }}
    >
      Z
    </div>
  );
}
