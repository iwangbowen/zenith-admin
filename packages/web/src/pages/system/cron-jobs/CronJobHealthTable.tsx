import { Tag, Tooltip } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { CronJobStatsPerJob } from '@zenith/shared/platform';
import { CRON_HEALTH_RULES, isCronSlowTail } from '@zenith/shared/platform';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { DataBar } from '@/components/data-viz/DataBar';
import { formatDurationMs } from '@/utils/format';
import { formatRelativeTime } from '@/utils/date';
import { DATE_TIME_COLUMN_WIDTH, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import {
  DurationSparkline,
  FAIL_COLOR,
  RecentResultBlocks,
  RelativeTime,
  SUCCESS_COLOR,
  TIMEOUT_COLOR,
  TrendMark,
  statusMeta,
} from './cron-dashboard-shared';

interface Props {
  readonly rows: readonly CronJobStatsPerJob[];
  readonly loading: boolean;
  readonly now: Date;
  readonly onRefresh: () => void;
  readonly canExecute: boolean;
  readonly canUpdate: boolean;
  readonly onViewLogs: (jobId: number, jobName: string) => void;
  readonly onRun: (jobId: number, jobName: string) => void;
  readonly onToggleStatus: (job: CronJobStatsPerJob) => void;
}

function rateColor(rate: number | null): string {
  if (rate == null) return 'var(--semi-color-text-3)';
  if (rate >= 90) return SUCCESS_COLOR;
  if (rate >= CRON_HEALTH_RULES.lowSuccessRatePercent) return 'var(--semi-color-warning)';
  return FAIL_COLOR;
}

function numberSorter(pick: (row: CronJobStatsPerJob) => number | null) {
  return (a?: CronJobStatsPerJob, b?: CronJobStatsPerJob) => (a && b ? (pick(a) ?? -1) - (pick(b) ?? -1) : 0);
}

/** 任务健康表：每行一个任务，横向密排调度 / 结果 / 耗时 / 时间 / 操作 */
export function CronJobHealthTable({ rows, loading, now, onRefresh, canExecute, canUpdate, onViewLogs, onRun, onToggleStatus }: Props) {
  const columns: ColumnProps<CronJobStatsPerJob>[] = [
    {
      title: '任务', dataIndex: 'jobName', minWidth: 200,
      sorter: (a?: CronJobStatsPerJob, b?: CronJobStatsPerJob) => (a && b ? a.jobName.localeCompare(b.jobName) : 0),
      render: (_: unknown, r: CronJobStatsPerJob) => (
        <div className="cron-cell">
          <div className="cron-cell__main">
            <span className="cron-cell__title" title={r.jobName}>{r.jobName}</span>
            {!r.enabled && <Tag size="small" color="grey" type="light">已停用</Tag>}
            {r.consecutiveFails >= CRON_HEALTH_RULES.consecutiveFailThreshold && (
              <Tag size="small" color="red">连败 {r.consecutiveFails}</Tag>
            )}
          </div>
          <span className="cron-cell__sub" title={r.handler}>{r.handler}</span>
        </div>
      ),
    },
    {
      title: '表达式', dataIndex: 'cronExpression', width: 140,
      render: (v: string) => <span className="cron-mono" title={v} style={{ fontSize: 12 }}>{v}</span>,
    },
    {
      // 20 块 × 6px + 19 处 2px 间距 = 158，加单元格左右 padding 32
      title: '近 20 次', dataIndex: 'recentResults', width: 192,
      render: (_: unknown, r: CronJobStatsPerJob) => <RecentResultBlocks results={r.recentResults} durations={r.recentDurations} />,
    },
    {
      title: '耗时趋势', dataIndex: 'recentDurations', width: 120,
      render: (v: (number | null)[]) => <DurationSparkline values={v} width={88} />,
    },
    {
      title: '成功率', dataIndex: 'successRate', width: 130,
      sorter: numberSorter((r) => r.successRate),
      render: (_: unknown, r: CronJobStatsPerJob) => {
        if (r.successRate == null) return <span style={{ color: 'var(--semi-color-text-3)' }}>{EMPTY_PLACEHOLDER}</span>;
        return (
          <div className="cron-cell">
            <div className="cron-rate">
              <DataBar className="cron-rate__bar" value={r.successRate} max={100} color={rateColor(r.successRate)} height={6} />
              <span className="cron-rate__value" style={{ color: rateColor(r.successRate) }}>{r.successRate}%</span>
            </div>
            <span className="cron-cell__sub">
              {r.successCount}/{r.runs} 次
              {' '}
              <TrendMark current={r.successRate} previous={r.prevSuccessRate} format={(d) => `${d} pt`} />
            </span>
          </div>
        );
      },
    },
    {
      title: '执行', dataIndex: 'runs', width: 96, align: 'right',
      sorter: numberSorter((r) => r.runs),
      render: (_: unknown, r: CronJobStatsPerJob) => (
        <div className="cron-cell cron-cell--right">
          <Tooltip content={`历史累计 ${r.totalRuns} 次`} position="top"><span>{r.runs}</span></Tooltip>
          <span className="cron-cell__sub">今日 {r.todayRuns}</span>
        </div>
      ),
    },
    {
      title: '失败 / 超时', dataIndex: 'failCount', width: 110, align: 'right',
      sorter: numberSorter((r) => r.failCount + r.timeoutCount),
      render: (_: unknown, r: CronJobStatsPerJob) => (
        <div className="cron-cell cron-cell--right">
          <span>
            <span style={r.failCount > 0 ? { color: FAIL_COLOR, fontWeight: 500 } : undefined}>{r.failCount}</span>
            <span style={{ color: 'var(--semi-color-text-3)' }}> / </span>
            <span style={r.timeoutCount > 0 ? { color: TIMEOUT_COLOR, fontWeight: 500 } : undefined}>{r.timeoutCount}</span>
          </span>
          <span className="cron-cell__sub">今日 {r.todayFailCount}{r.retryCount > 0 ? ` · 重试 ${r.retryCount}` : ''}</span>
        </div>
      ),
    },
    {
      title: '平均 / P95', dataIndex: 'avgDurationMs', width: 144, align: 'right',
      sorter: numberSorter((r) => r.p95DurationMs),
      render: (_: unknown, r: CronJobStatsPerJob) => {
        const slowTail = isCronSlowTail(r.avgDurationMs, r.p95DurationMs);
        return (
          <div className="cron-cell cron-cell--right">
            <span title={r.maxDurationMs != null ? `最长 ${formatDurationMs(r.maxDurationMs)}` : undefined}>
              {formatDurationMs(r.avgDurationMs)}
              <span style={{ color: 'var(--semi-color-text-3)' }}> / </span>
              <span style={slowTail ? { color: 'var(--semi-color-warning)' } : undefined} title={slowTail ? '最慢 5% 的执行显著慢于平均值，耗时不稳定' : undefined}>
                {formatDurationMs(r.p95DurationMs)}
              </span>
            </span>
            <span className="cron-cell__sub">
              {r.prevAvgDurationMs != null ? `上期 ${formatDurationMs(r.prevAvgDurationMs)} ` : ''}
              <TrendMark current={r.avgDurationMs} previous={r.prevAvgDurationMs} invert format={(d) => formatDurationMs(d)} />
            </span>
          </div>
        );
      },
    },
    {
      title: '调度延迟', dataIndex: 'avgLatencyMs', width: 100, align: 'right',
      sorter: numberSorter((r) => r.avgLatencyMs),
      render: (v: number | null) => (
        <span style={v != null && v >= 10_000 ? { color: 'var(--semi-color-warning)' } : undefined} title="周期内平均：实际开始 − 计划触发">
          {formatDurationMs(v == null ? null : Math.max(v, 0))}
        </span>
      ),
    },
    {
      // 复合列：状态 + 相对时间 + 精确时刻，宽度按时间列口径
      title: '最近执行', dataIndex: 'lastRunAt', width: DATE_TIME_COLUMN_WIDTH,
      sorter: (a?: CronJobStatsPerJob, b?: CronJobStatsPerJob) => (a && b ? (a.lastRunAt ?? '').localeCompare(b.lastRunAt ?? '') : 0),
      render: (_: unknown, r: CronJobStatsPerJob) => {
        const meta = statusMeta(r.lastRunStatus);
        return (
          <div className="cron-cell">
            <div className="cron-cell__main">
              <span className="cron-status-dot" style={{ background: meta.color }} />
              <span>{meta.label}</span>
              {r.lastRunAt && <span style={{ color: 'var(--semi-color-text-2)' }}>· {formatRelativeTime(r.lastRunAt, now)}</span>}
            </div>
            <span className="cron-cell__sub" title={r.lastError ?? undefined}>
              {(r.lastRunStatus === 'fail' || r.lastRunStatus === 'timeout') && r.lastError ? r.lastError : (r.lastRunAt ?? '尚无执行记录')}
            </span>
          </div>
        );
      },
    },
    {
      title: '下次执行', dataIndex: 'nextRunAt', width: DATE_TIME_COLUMN_WIDTH,
      sorter: (a?: CronJobStatsPerJob, b?: CronJobStatsPerJob) => (a && b ? (a.nextRunAt ?? '9').localeCompare(b.nextRunAt ?? '9') : 0),
      render: (v: string | null, r: CronJobStatsPerJob) => {
        if (!r.enabled) return <span style={{ color: 'var(--semi-color-text-3)' }}>已停用</span>;
        if (!v) return <span style={{ color: 'var(--semi-color-text-3)' }}>表达式无效</span>;
        return (
          <div className="cron-cell">
            <RelativeTime value={v} now={now} />
            <span className="cron-cell__sub">{v}</span>
          </div>
        );
      },
    },
    createOperationColumn<CronJobStatsPerJob>({
      width: 180,
      desktopInlineKeys: ['execute', 'logs'],
      actions: (r) => [
        { key: 'execute', label: '执行', hidden: !canExecute, onClick: () => onRun(r.jobId, r.jobName) },
        { key: 'logs', label: '日志', onClick: () => onViewLogs(r.jobId, r.jobName) },
        { key: 'toggle', label: r.enabled ? '停用' : '启用', hidden: !canUpdate, danger: r.enabled, onClick: () => onToggleStatus(r) },
      ],
    }),
  ];

  return (
    <ConfigurableTable<CronJobStatsPerJob>
      columnSettingsKey="cron-jobs-health"
      rowKey="jobId"
      size="small"
      bordered
      columns={columns}
      dataSource={[...rows]}
      loading={loading}
      pagination={false}
      onRefresh={onRefresh}
      refreshLoading={loading}
      onRow={(record) => (record && record.consecutiveFails >= CRON_HEALTH_RULES.consecutiveFailThreshold ? { className: 'cron-row--alert' } : {})}
      empty="暂无任务"
    />
  );
}
