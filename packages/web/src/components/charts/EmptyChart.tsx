import type React from 'react';

interface EmptyChartProps {
  /** 占位高度，与对应图表高度保持一致 */
  readonly height?: number;
  /** 空状态文案 */
  readonly text?: string;
  /** 文案色调：muted 普通灰、success 绿色（用于「无异常」类正向空态） */
  readonly tone?: 'muted' | 'success';
}

/** 图表空状态占位：在数据为空时替代图表渲染，保持卡片高度稳定 */
export function EmptyChart({ height = 260, text = '暂无数据', tone = 'muted' }: EmptyChartProps) {
  const style: React.CSSProperties = {
    height,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tone === 'success' ? 'var(--semi-color-success)' : 'var(--semi-color-text-2)',
    fontSize: 13,
  };
  return <div style={style}>{text}</div>;
}
