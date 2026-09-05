/** 行为分析各 Tab 共用的小型 UI 组件：环比涨跌、区块标题、图表占位 */
import type { ReactNode } from 'react';
import { Empty, Spin, Typography } from '@douyinfe/semi-ui';

export function DeltaText({ value, suffix = '%' }: Readonly<{ value: number; suffix?: string }>) {
  if (value === 0) return <span style={{ color: 'var(--semi-color-text-2)' }}>持平</span>;
  const positive = value > 0;
  return (
    <span style={{ color: positive ? 'var(--semi-color-success)' : 'var(--semi-color-danger)', fontWeight: 600 }}>
      {positive ? '▲' : '▼'} {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
}

export function SectionHeader({
  title,
  description,
  extra,
}: Readonly<{ title: string; description?: string; extra?: ReactNode }>) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div>
        <Typography.Title heading={5} style={{ margin: 0 }}>{title}</Typography.Title>
        {description ? <Typography.Text type="tertiary">{description}</Typography.Text> : null}
      </div>
      {extra}
    </div>
  );
}

/** 图表 / 榜单无数据时的占位：加载中显示 Spin，否则显示空态 */
export function ChartPlaceholder({ loading, description = '暂无数据' }: Readonly<{ loading: boolean; description?: string }>) {
  if (loading) return <div style={{ height: 260, display: 'grid', placeItems: 'center' }}><Spin /></div>;
  return <Empty description={description} />;
}
