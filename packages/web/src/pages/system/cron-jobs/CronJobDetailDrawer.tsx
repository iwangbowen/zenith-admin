import { useMemo } from 'react';
import { Descriptions, Empty, SideSheet, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import type { CronJobDetailStats, CronJobRunPoint } from '@zenith/shared/platform';
import { CRON_RUN_TRIGGER_LABELS, cronSuccessRatePercent } from '@zenith/shared/platform';
import dayjs from 'dayjs';
import {
  BarChart,
  CommonChart,
  ScatterChart,
  chartOptions,
  makeBarSpec,
  makeMixedBarLineSpec,
  makeScatterSpec,
  useChartPalette,
  StatCard,
  StatGrid,
} from '@/components/charts';
import { calcSuccessRateDelta } from '@/components/logs/LogStatsScaffold';
import { useCronJobDetailStats } from '@/hooks/queries/cron-jobs';
import { formatDurationMs } from '@/utils/format';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import {
  DURATION_COLOR,
  FAIL_COLOR,
  P95_COLOR,
  RESULT_META,
  RecentResultBlocks,
  RelativeTime,
  SUCCESS_COLOR,
  TIMEOUT_COLOR,
  TRIGGER_TAG,
  TrendMark,
  statusMeta,
  type CronStatsDays,
} from './cron-dashboard-shared';

interface Props {
  readonly jobId: number | null;
  readonly jobName: string;
  readonly days: CronStatsDays;
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onViewLogs: (jobId: number, jobName: string) => void;
}

const CHART_HEIGHT = 220;

function DetailBody({ detail, days, updatedAt, onViewLogs }: Readonly<{ detail: CronJobDetailStats; days: number; updatedAt: number; onViewLogs: Props['onViewLogs'] }>) {
  const palette = useChartPalette();
  // 相对时间以数据到达时刻为基准
  const now = useMemo(() => new Date(updatedAt || Date.now()), [updatedAt]);
  const { job, period, prevPeriod } = detail;
  const rate = cronSuccessRatePercent(period.successCount, period.total);

  const filledDaily = useMemo(() => {
    const map = new Map(detail.dailyStats.map((d) => [d.date, d]));
    const today = dayjs(now);
    return Array.from({ length: days }, (_, i) => {
      const date = today.subtract(days - 1 - i, 'day').format('YYYY-MM-DD');
      const d = map.get(date);
      return {
        date,
        successCount: d?.successCount ?? 0,
        failCount: d?.failCount ?? 0,
        timeoutCount: d?.timeoutCount ?? 0,
        avgDurationMs: d?.avgDurationMs ?? 0,
        p95DurationMs: d?.p95DurationMs ?? 0,
      };
    });
  }, [detail, days, now]);

  const trendSpec = useMemo(() => makeMixedBarLineSpec({
    data: filledDaily,
    xField: 'date',
    palette,
    bar: { field: 'successCount', name: '成功', color: SUCCESS_COLOR },
    stackedBars: [
      { field: 'failCount', name: '失败', color: FAIL_COLOR },
      { field: 'timeoutCount', name: '超时', color: TIMEOUT_COLOR },
    ],
    line: { field: 'avgDurationMs', name: '平均耗时', color: DURATION_COLOR, format: (v) => formatDurationMs(v) },
    extraLines: [{ field: 'p95DurationMs', name: 'P95 耗时', color: P95_COLOR, lineWidth: 1.5, showPoint: false, format: (v) => formatDurationMs(v) }],
    axis: { xLabel: (d) => d.slice(5), rightLabel: (v) => formatDurationMs(v) },
    tooltip: { title: (x) => `日期：${x}`, barValue: (v) => `${v} 次` },
  }), [filledDaily, palette]);

  const runPoints = useMemo(() => detail.runs
    .filter((r): r is CronJobRunPoint & { durationMs: number } => r.durationMs != null)
    .map((r, i) => ({ index: i + 1, durationMs: r.durationMs, status: r.status, trigger: r.trigger, startedAt: r.startedAt })), [detail]);

  const scatterSpec = useMemo(() => makeScatterSpec({
    data: runPoints,
    xField: 'index',
    yField: 'durationMs',
    palette,
    point: {
      size: 6,
      fillOpacity: 0.85,
      fill: (d) => RESULT_META[(d as { status: keyof typeof RESULT_META }).status]?.color ?? palette.primary,
    },
    xAxis: { label: (v) => `#${v}` },
    yAxis: { min: 0, label: (v) => formatDurationMs(v) },
    tooltip: {
      title: (d) => `${(d as { startedAt: string }).startedAt}`,
      items: [
        { key: '耗时', value: (d) => formatDurationMs((d as { durationMs: number }).durationMs) },
        { key: '结果', value: (d) => RESULT_META[(d as { status: keyof typeof RESULT_META }).status]?.label ?? '' },
        { key: '触发', value: (d) => CRON_RUN_TRIGGER_LABELS[(d as { trigger: keyof typeof CRON_RUN_TRIGGER_LABELS }).trigger] ?? '' },
      ],
    },
  }), [runPoints, palette]);

  const latencySpec = useMemo(() => makeBarSpec({
    data: detail.latencyBuckets,
    xField: 'bucket',
    series: [{ field: 'count', name: '执行次数', color: palette.dataColors[1] ?? palette.primary }],
    palette,
    showLabel: true,
    barMaxWidth: 36,
    legend: false,
    tooltip: { value: (v) => `${v} 次` },
  }), [detail.latencyBuckets, palette]);

  return (
    <div className="zx-flat-panels cron-detail">
      <Descriptions
        align="left"
        size="small"
        data={[
          { key: '处理器', value: <span className="cron-mono">{job.handler}</span> },
          { key: '表达式', value: <span className="cron-mono">{job.cronExpression}</span> },
          { key: '状态', value: job.enabled ? <Tag color="green" size="small" type="light">启用</Tag> : <Tag color="grey" size="small" type="light">已停用</Tag> },
          { key: '监控超时', value: job.monitorTimeout ? `${job.monitorTimeout} 秒` : '未设置' },
          { key: '最近执行', value: job.lastRunAt ? <><Tag color={statusMeta(job.lastRunStatus).tag} size="small" type="light">{statusMeta(job.lastRunStatus).label}</Tag> {job.lastRunAt}（<RelativeTime value={job.lastRunAt} now={now} />）</> : EMPTY_PLACEHOLDER },
          { key: '下次执行', value: job.nextRunAt ? <>{job.nextRunAt}（<RelativeTime value={job.nextRunAt} now={now} />）</> : EMPTY_PLACEHOLDER },
          { key: `近 ${job.recentResults.length} 次`, value: <RecentResultBlocks results={job.recentResults} durations={job.recentDurations} /> },
        ]}
      />

      <StatGrid minItemWidth={130} gap={12} style={{ margin: '12px 0 4px' }}>
        <StatCard title={`近 ${days} 天执行`} value={period.total} sub={`历史累计 ${job.totalRuns}`} />
        <StatCard
          title="成功率" value={rate == null ? '—' : `${rate}%`}
          sub={`失败 ${period.failCount} · 超时 ${period.timeoutCount}`}
          delta={calcSuccessRateDelta(period, prevPeriod)} deltaLabel="较上期" deltaFormat="ratio"
        />
        <StatCard
          title="平均耗时" value={formatDurationMs(period.avgDurationMs)}
          sub={<>P95 {formatDurationMs(period.p95DurationMs)} <TrendMark current={period.avgDurationMs} previous={prevPeriod.avgDurationMs} invert format={(d) => formatDurationMs(d)} /></>}
        />
        <StatCard title="平均调度延迟" value={formatDurationMs(period.avgLatencyMs)} sub={`重试 ${period.retryCount} · 手动 ${period.manualCount}`} />
      </StatGrid>

      <div className="zx-panel">
        <div className="cron-detail__title">每日执行与耗时</div>
        <CommonChart {...trendSpec} options={chartOptions} height={CHART_HEIGHT} />
      </div>

      <div className="chart-grid">
        <div className="zx-panel">
          <div className="cron-detail__title">耗时分布（近 {runPoints.length} 次，按结果着色）</div>
          {runPoints.length === 0
            ? <div className="cron-empty" style={{ height: CHART_HEIGHT }}><Empty description="周期内暂无已完成执行" /></div>
            : <ScatterChart {...scatterSpec} options={chartOptions} height={CHART_HEIGHT} />}
        </div>
        <div className="zx-panel">
          <div className="cron-detail__title">调度延迟分布</div>
          <BarChart {...latencySpec} options={chartOptions} height={CHART_HEIGHT} />
        </div>
      </div>

      <div className="chart-grid">
        <div className="zx-panel">
          <div className="cron-detail__title">最近失败 / 超时 · {detail.recentErrors.length}</div>
          {detail.recentErrors.length === 0
            ? <Typography.Text type="tertiary">周期内没有失败记录</Typography.Text>
            : detail.recentErrors.map((e) => (
              <div key={e.logId} className="cron-error" style={{ cursor: 'default' }}>
                <span className="cron-error__body">
                  <span className="cron-error__message" style={{ color: 'var(--semi-color-danger)' }}>{e.message || '（无错误信息）'}</span>
                  <span className="cron-error__meta">
                    <Tag color={statusMeta(e.status).tag} size="small" type="light">{statusMeta(e.status).label}</Tag>
                    {' '}<Tag color={TRIGGER_TAG[e.trigger]} size="small" type="light">{CRON_RUN_TRIGGER_LABELS[e.trigger]}{e.attempt > 0 ? ` #${e.attempt}` : ''}</Tag>
                    {' '}{e.startedAt} · 耗时 {formatDurationMs(e.durationMs)}
                  </span>
                </span>
              </div>
            ))}
        </div>
        <div className="zx-panel">
          <div className="cron-detail__title">未来 {detail.nextRuns.length} 次计划执行</div>
          {detail.nextRuns.length === 0
            ? <Typography.Text type="tertiary">{job.enabled ? '表达式无效' : '任务已停用'}</Typography.Text>
            : detail.nextRuns.map((t) => (
              <div key={t} className="cron-upcoming">
                <span className="cron-upcoming__time cron-mono">{t}</span>
                <span className="cron-upcoming__meta">{dayjs(t).diff(now) >= 0 ? <RelativeTime value={t} now={now} /> : null}</span>
              </div>
            ))}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Typography.Text link onClick={() => onViewLogs(job.jobId, job.jobName)}>查看全部执行日志 →</Typography.Text>
      </div>
    </div>
  );
}

/** 单任务下钻抽屉：每日趋势、耗时散点、调度延迟分布、最近错误与未来执行 */
export function CronJobDetailDrawer({ jobId, jobName, days, visible, onClose, onViewLogs }: Props) {
  const query = useCronJobDetailStats(visible ? jobId : null, { days });
  const detail = query.data ?? null;
  return (
    <SideSheet
      title={`任务详情 — ${jobName}`}
      visible={visible}
      onCancel={onClose}
      width={960}
      closeOnEsc
    >
      <Spin spinning={query.isFetching}>
        {detail
          ? <DetailBody detail={detail} days={days} updatedAt={query.dataUpdatedAt} onViewLogs={onViewLogs} />
          : <div className="cron-empty" style={{ height: 240 }}>{query.isError ? <Empty description="加载失败" /> : null}</div>}
      </Spin>
    </SideSheet>
  );
}
