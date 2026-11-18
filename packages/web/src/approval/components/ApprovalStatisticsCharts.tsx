import { memo, useMemo } from 'react';
import type { WorkflowAnalytics } from '@zenith/shared/workflow';
import { shortDate } from '@/utils/date';

const SERIES = [
  { key: 'created', label: '创建', color: 'var(--semi-color-primary)' },
  { key: 'completed', label: '完结', color: 'var(--semi-color-success)' },
] as const;

/** 移动端固定双序列趋势；每日原始值可展开查看。 */
export default memo(function ApprovalStatisticsCharts({ trend }: Readonly<{ trend: WorkflowAnalytics['trend'] }>) {
  const chart = useMemo(() => {
    const maximum = Math.max(1, ...trend.flatMap(point => [point.created, point.completed]));
    const x = (index: number) => 32 + index * 308 / Math.max(1, trend.length - 1);
    const y = (value: number) => 170 - value / maximum * 140;
    return { maximum, x, y };
  }, [trend]);
  return <div>
    <div className="ap-stat-legend">{SERIES.map(series => <span key={series.key} style={{ color: series.color }}>● {series.label}</span>)}</div>
    <svg role="img" aria-label="近14天创建与完结趋势；每日数值可展开查看" viewBox="0 0 360 205" style={{ display: 'block', width: '100%', height: 'auto' }}>
      {[0, 0.5, 1].map(ratio => <g key={ratio}>
        <line x1={32} x2={340} y1={chart.y(chart.maximum * ratio)} y2={chart.y(chart.maximum * ratio)} stroke="var(--semi-color-border)" strokeDasharray="4 4" />
        <text x={24} y={chart.y(chart.maximum * ratio) + 4} textAnchor="end" fill="var(--semi-color-text-2)" fontSize={11}>{Number((chart.maximum * ratio).toFixed(1))}</text>
      </g>)}
      {SERIES.map(series => <g key={series.key}>
        <polyline points={trend.map((point, index) => `${chart.x(index)},${chart.y(point[series.key])}`).join(' ')} fill="none" stroke={series.color} strokeWidth={2} />
        {trend.map((point, index) => <circle key={point.date} cx={chart.x(index)} cy={chart.y(point[series.key])} r={3} fill={series.color}><title>{point.date} {series.label} {point[series.key]}</title></circle>)}
      </g>)}
      {trend.filter((_, index) => index === 0 || index === Math.floor((trend.length - 1) / 2) || index === trend.length - 1).map(point => <text key={point.date} x={chart.x(trend.indexOf(point))} y={194} textAnchor="middle" fill="var(--semi-color-text-2)" fontSize={11}>{shortDate(point.date)}</text>)}
    </svg>
    <details><summary>查看每日数据</summary><table className="ap-stat-daily"><thead><tr><th>日期</th><th>创建</th><th>完结</th></tr></thead><tbody>{trend.map(point => <tr key={point.date}><td>{point.date}</td><td>{point.created}</td><td>{point.completed}</td></tr>)}</tbody></table></details>
  </div>;
});
