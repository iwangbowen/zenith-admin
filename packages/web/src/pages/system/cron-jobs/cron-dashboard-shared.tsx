/* eslint-disable react-refresh/only-export-components */
import { Tooltip } from '@douyinfe/semi-ui';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag/interface';
import type { CronRunStatus, CronRunTrigger } from '@zenith/shared/platform';
import { CRON_RUN_STATUS_LABELS } from '@zenith/shared/platform';
import { cronJobKeys } from '@/hooks/queries/cron-jobs';
import { useListSearch } from '@/hooks/useListSearch';
import { formatDurationMs } from '@/utils/format';
import { formatRelativeTime } from '@/utils/date';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

export const SUCCESS_COLOR = '#10b981';
export const FAIL_COLOR = '#ef4444';
export const RUNNING_COLOR = '#3b82f6';
export const TIMEOUT_COLOR = '#f97316';
export const DURATION_COLOR = '#8b5cf6';
export const P95_COLOR = '#f59e0b';

/** 统计周期可选天数 */
export const CRON_STATS_DAYS_OPTIONS = [7, 14, 30] as const;

export type CronStatsDays = (typeof CRON_STATS_DAYS_OPTIONS)[number];

export interface RecentLogsSearchParams {
  keyword: string;
  status?: CronRunStatus;
  trigger?: CronRunTrigger;
  jobId?: number;
  range?: [Date, Date] | null;
}

const RECENT_LOGS_DEFAULTS: RecentLogsSearchParams = { keyword: '', status: undefined, trigger: undefined, jobId: undefined, range: null };

/** 执行记录面板的搜索状态：由概览页持有，失败原因榜单点击时经 `applySearch` 直接下发条件 */
export function useRecentLogsSearch() {
  return useListSearch<RecentLogsSearchParams>({ defaults: RECENT_LOGS_DEFAULTS, listKey: cronJobKeys.logs, pageSize: 20 });
}

export const RESULT_META: Record<CronRunStatus, { color: string; label: string; tag: TagColor }> = {
  success: { color: SUCCESS_COLOR, label: CRON_RUN_STATUS_LABELS.success, tag: 'green' },
  fail: { color: FAIL_COLOR, label: CRON_RUN_STATUS_LABELS.fail, tag: 'red' },
  running: { color: RUNNING_COLOR, label: CRON_RUN_STATUS_LABELS.running, tag: 'blue' },
  timeout: { color: TIMEOUT_COLOR, label: CRON_RUN_STATUS_LABELS.timeout, tag: 'orange' },
};

export const TRIGGER_TAG: Record<CronRunTrigger, TagColor> = {
  schedule: 'grey',
  manual: 'blue',
  retry: 'orange',
};

export function statusMeta(status: CronRunStatus | null): { label: string; color: string; tag: TagColor } {
  return status ? RESULT_META[status] : { label: '从未执行', color: 'var(--semi-color-text-3)', tag: 'grey' };
}

/** GitHub Actions 风格近 N 次执行状态块（旧 → 新），可选叠加耗时 tooltip */
export function RecentResultBlocks({
  results,
  durations,
}: Readonly<{ results: readonly CronRunStatus[]; durations?: readonly (number | null)[] }>) {
  if (results.length === 0) return <span style={{ color: 'var(--semi-color-text-3)' }}>{EMPTY_PLACEHOLDER}</span>;
  return (
    <span className="cron-result-blocks" aria-label={`近 ${results.length} 次执行`}>
      {results.map((r, i) => {
        const duration = durations?.[i];
        const tip = `第 ${i - results.length} 次：${RESULT_META[r].label}${duration != null ? ` · ${formatDurationMs(duration)}` : ''}`;
        return (
          <Tooltip key={`${i}-${r}`} content={tip} position="top">
            <span
              className="cron-result-block"
              style={{ background: RESULT_META[r].color, opacity: r === 'success' ? 0.7 : 1 }}
            />
          </Tooltip>
        );
      })}
    </span>
  );
}

/** 迷你耗时折线（纯 SVG，避免每行挂一个图表实例）；运行中（null）留空 */
export function DurationSparkline({
  values,
  width = 96,
  height = 22,
  color = DURATION_COLOR,
}: Readonly<{ values: readonly (number | null)[]; width?: number; height?: number; color?: string }>) {
  const points = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (points.length < 2) return <span style={{ color: 'var(--semi-color-text-3)' }}>{EMPTY_PLACEHOLDER}</span>;
  const max = Math.max(...points.map((p) => p.v));
  const min = Math.min(...points.map((p) => p.v));
  const span = Math.max(max - min, 1);
  const stepX = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
  const toX = (i: number) => 2 + i * stepX;
  const toY = (v: number) => 2 + (height - 4) * (1 - (v - min) / span);
  const path = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${toX(p.i).toFixed(1)},${toY(p.v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <Tooltip content={`近 ${points.length} 次：最短 ${formatDurationMs(min)} · 最长 ${formatDurationMs(max)} · 最近 ${formatDurationMs(last.v)}`} position="top">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="耗时趋势" style={{ display: 'block' }}>
        <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
        <circle cx={toX(last.i)} cy={toY(last.v)} r={2.2} fill={color} />
      </svg>
    </Tooltip>
  );
}

/** 「3 分钟前」+ 悬浮显示精确时刻 */
export function RelativeTime({ value, now, className }: Readonly<{ value: string | null; now: Date; className?: string }>) {
  if (!value) return <span className={className} style={{ color: 'var(--semi-color-text-3)' }}>{EMPTY_PLACEHOLDER}</span>;
  return (
    <Tooltip content={value} position="top">
      <span className={className}>{formatRelativeTime(value, now)}</span>
    </Tooltip>
  );
}

/** 相对变化箭头：`invert` 表示数值越大越差（耗时、失败数） */
export function TrendMark({
  current,
  previous,
  invert = false,
  format,
}: Readonly<{ current: number | null; previous: number | null; invert?: boolean; format: (delta: number) => string }>) {
  if (current == null || previous == null) return null;
  const delta = current - previous;
  if (delta === 0) return null;
  const better = invert ? delta < 0 : delta > 0;
  let cls = 'cron-trend ';
  if (better) cls += 'cron-trend--up';
  else cls += invert ? 'cron-trend--worse' : 'cron-trend--down';
  return <span className={cls}>{delta > 0 ? '▲' : '▼'} {format(Math.abs(delta))}</span>;
}
