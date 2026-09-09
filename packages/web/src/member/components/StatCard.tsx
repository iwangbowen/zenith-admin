import type { ReactNode } from 'react';

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  /** 主数值用会员端主色强调 */
  accent?: boolean;
}

/**
 * 会员前台统计数值（数值在上、标签在下），使用会员端自有视觉令牌（--m-*），
 * 与后台 `components/charts/StatCard` 是不同设计体系；配合 `StatGrid` 分栏细线排布，不画卡片盒子。
 */
export function StatCard({ label, value, accent }: Readonly<StatCardProps>) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent ? 'var(--m-primary)' : 'var(--m-text)', letterSpacing: '-0.03em' }}>
        {value}
      </div>
      <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', marginTop: 9, display: 'flex', alignItems: 'center', gap: 6 }}>
        {label}
      </div>
    </div>
  );
}
