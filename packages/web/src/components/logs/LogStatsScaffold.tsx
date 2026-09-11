/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react';
import dayjs from 'dayjs';
import { Select, Skeleton, Spin } from '@douyinfe/semi-ui';
import { sectionTitleStyle } from '@/components/charts/helpers';
import { StatGrid } from '@/components/charts/StatCard';

export const LOG_STATS_DAYS_OPTIONS = [
  { label: '最近 7 天', value: 7 },
  { label: '最近 30 天', value: 30 },
  { label: '最近 90 天', value: 90 },
];

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 日统计按周一 … 周日归桶（本地时区取周几），登录 / 操作日志的周分布柱图共用 */
export function weekdayBuckets(dailyStats: readonly { date: string; count: number }[] | null | undefined): { name: string; count: number }[] {
  const buckets = new Array<number>(7).fill(0);
  for (const d of dailyStats ?? []) {
    buckets[(dayjs(d.date).day() + 6) % 7] += d.count;
  }
  return WEEKDAY_LABELS.map((name, i) => ({ name, count: buckets[i] }));
}

export interface SuccessRateSummary {
  readonly total: number;
  readonly successCount: number;
}

/** 环比增量：上一周期无数据时不展示。 */
export function deltaOf(current: number, prev: number): number | null {
  return prev > 0 ? current - prev : null;
}

/** 成功率百分比：无汇总或总数为 0 时不展示。 */
export function calcSuccessRate(summary: SuccessRateSummary | null | undefined): string | null {
  return summary == null || summary.total === 0
    ? null
    : ((summary.successCount / summary.total) * 100).toFixed(1);
}

/** 成功率环比：两个周期都有数据才展示比率差。 */
export function calcSuccessRateDelta(
  summary: SuccessRateSummary | null | undefined,
  prevSummary: SuccessRateSummary | null | undefined,
): number | null {
  return summary && prevSummary && summary.total > 0 && prevSummary.total > 0
    ? summary.successCount / summary.total - prevSummary.successCount / prevSummary.total
    : null;
}

/** 首屏加载骨架：按统计页布局占位，避免空白闪烁。 */
export function LogStatsSkeleton() {
  return (
    <Skeleton
      loading
      active
      placeholder={(
        <>
          <StatGrid style={{ marginBottom: 16 }}>
            {Array.from({ length: 4 }, (_, i) => `sk-stat-${i}`).map((key) => (
              <div key={key}>
                <Skeleton.Title style={{ width: 64, height: 26, marginBottom: 10 }} />
                <Skeleton.Paragraph rows={1} style={{ width: 80, marginBottom: 0 }} />
              </div>
            ))}
          </StatGrid>
          <div className="zx-panel" style={{ marginBottom: 16 }}>
            <Skeleton.Title style={{ width: 180, height: 14, marginBottom: 16 }} />
            <Skeleton.Image style={{ width: '100%', height: 230 }} />
          </div>
          <div className="chart-grid">
            {['sk-chart-a', 'sk-chart-b'].map((key) => (
              <div key={key} className="zx-panel">
                <Skeleton.Title style={{ width: 120, height: 14, marginBottom: 16 }} />
                <Skeleton.Image style={{ width: '100%', height: 260 }} />
              </div>
            ))}
          </div>
        </>
      )}
    >{null}</Skeleton>
  );
}

interface LogStatsScaffoldProps {
  readonly days: number;
  readonly onDaysChange: (days: number) => void;
  readonly loading: boolean;
  readonly fetching: boolean;
  readonly children: ReactNode;
}

export function LogStatsScaffold({ days, onDaysChange, loading, fetching, children }: LogStatsScaffoldProps) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Select value={days} onChange={(v) => onDaysChange(v as number)} style={{ width: 140 }}>
          {LOG_STATS_DAYS_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>
          ))}
        </Select>
      </div>

      {loading ? <LogStatsSkeleton /> : (
      <Spin spinning={fetching}>
        {children}
      </Spin>
      )}
    </div>
  );
}

export function ChartPanel({ title, children, danger }: Readonly<{ title: ReactNode; children: ReactNode; danger?: boolean }>) {
  return (
    <div className="zx-panel">
      <div style={{ ...sectionTitleStyle, color: danger ? 'var(--semi-color-danger)' : sectionTitleStyle.color }}>{title}</div>
      {children}
    </div>
  );
}



