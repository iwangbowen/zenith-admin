import { useMemo, useRef, useState } from 'react';
import { Card, Empty, Modal, Radio, RadioGroup, Spin, Toast, Tooltip } from '@douyinfe/semi-ui';
import type { CronJobStats, CronJobStatsPerJob, CronJobTopError, CronJobUpcomingRun } from '@zenith/shared/platform';
import { CRON_HEALTH_RULES, cronSuccessRatePercent } from '@zenith/shared/platform';
import dayjs from 'dayjs';
import {
  CommonChart,
  HeatmapChart,
  chartOptions,
  makeHeatmapSpec,
  makeMixedBarLineSpec,
  useChartPalette,
  StatCard,
  StatGrid,
} from '@/components/charts';
import { LogStatsSkeleton, WEEKDAY_LABELS, calcSuccessRateDelta, deltaOf } from '@/components/logs/LogStatsScaffold';
import { usePermission } from '@/hooks/usePermission';
import { useCronJobStats, useRunCronJob, useUpdateCronJobStatus } from '@/hooks/queries/cron-jobs';
import { formatDurationMs } from '@/utils/format';
import { formatRelativeTime } from '@/utils/date';
import { CronJobAlertsPanel } from './CronJobAlertsPanel';
import { CronJobHealthTable } from './CronJobHealthTable';
import { CronJobRecentLogs } from './CronJobRecentLogs';
import {
  CRON_STATS_DAYS_OPTIONS,
  DURATION_COLOR,
  FAIL_COLOR,
  P95_COLOR,
  RelativeTime,
  SUCCESS_COLOR,
  TrendMark,
  useRecentLogsSearch,
  type CronStatsDays,
} from './cron-dashboard-shared';
import './CronJobDashboard.css';

const SIDE_PANEL_HEIGHT = 320;
const SOON_THRESHOLD_MS = 60 * 60_000;

type JobFilter = 'all' | 'alerting' | 'running' | 'disabled' | 'never';

const JOB_FILTER_LABELS: Record<JobFilter, string> = {
  all: '全部',
  alerting: '有提醒',
  running: '运行中',
  disabled: '已停用',
  never: '从未执行',
};

interface Props {
  readonly onViewLogs: (jobId: number, jobName: string) => void;
}

function SchedulerBar({ scheduler, now }: Readonly<{ scheduler: CronJobStats['scheduler']; now: Date }>) {
  const online = scheduler.activeNodes > 0;
  return (
    <div className="cron-scheduler">
      <span className="cron-scheduler__state">
        <span className={`cron-scheduler__dot${online ? '' : ' cron-scheduler__dot--offline'}`} />
        {online ? `调度器在线 · ${scheduler.activeNodes} 个节点` : '调度器离线'}
      </span>
      <Tooltip content={scheduler.online ? '当前接口进程已初始化调度器' : '当前接口进程未运行调度器（由其它节点承担）'} position="bottom">
        <span className="cron-scheduler__meta cron-mono">{scheduler.hostname}:{scheduler.pid}</span>
      </Tooltip>
      <Tooltip content="当前接口进程内正在执行的任务数；多实例部署时用于判断由哪台机器承担" position="bottom"><span className="cron-scheduler__meta">本节点执行中 {scheduler.wipCount}</span></Tooltip>
      <span className="cron-scheduler__meta">
        心跳 {scheduler.lastHeartbeatAt ? formatRelativeTime(scheduler.lastHeartbeatAt, now) : '无记录'}
      </span>
    </div>
  );
}

function UpcomingList({ items, now }: Readonly<{ items: readonly CronJobUpcomingRun[]; now: Date }>) {
  if (items.length === 0) {
    return <div className="cron-empty" style={{ height: SIDE_PANEL_HEIGHT }}><Empty description="未来 24 小时无计划执行" /></div>;
  }
  const today = dayjs(now).format('YYYY-MM-DD');
  const groups: Array<{ label: string; items: CronJobUpcomingRun[] }> = [];
  for (const item of items) {
    const label = item.runAt.startsWith(today) ? '今天' : '明天';
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return (
    <div className="cron-list" style={{ height: SIDE_PANEL_HEIGHT }}>
      {groups.map((group) => (
        <div key={group.label}>
          <div className="cron-list__group">{group.label}</div>
          {group.items.map((item) => {
            const soon = dayjs(item.runAt).diff(now) <= SOON_THRESHOLD_MS;
            return (
              <div key={item.jobId} className={`cron-upcoming${soon ? ' cron-upcoming--soon' : ''}`}>
                <span className="cron-upcoming__time cron-mono">{item.runAt.slice(11)}</span>
                <span className="cron-upcoming__name" title={item.jobName}>{item.jobName}</span>
                <span className="cron-upcoming__meta cron-mono" title={item.cronExpression}>{item.cronExpression}</span>
                <span className="cron-upcoming__meta cron-upcoming__cadence">{item.runsPerDay != null ? `约 ${item.runsPerDay} 次/天` : '单次'}</span>
                <span className="cron-upcoming__meta cron-upcoming__eta">{formatRelativeTime(item.runAt, now)}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TopErrorList({ items, now, onSelect }: Readonly<{ items: readonly CronJobTopError[]; now: Date; onSelect: (item: CronJobTopError) => void }>) {
  if (items.length === 0) {
    return <div className="cron-empty" style={{ height: SIDE_PANEL_HEIGHT }}><Empty description="周期内没有失败记录" /></div>;
  }
  return (
    <div className="cron-list" style={{ height: SIDE_PANEL_HEIGHT }}>
      {items.map((item) => (
        <button
          type="button"
          key={item.message}
          className="cron-error"
          title="点击在执行记录中筛选该错误"
          onClick={() => onSelect(item)}
        >
          <span className="cron-error__count">{item.count}</span>
          <span className="cron-error__body">
            <span className="cron-error__message">{item.message || '（空输出）'}</span>
            <span className="cron-error__meta">
              {item.jobNames.join('、')} · 最近 <RelativeTime value={item.lastAt} now={now} />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** 归一化错误里数字已被替换为 #，取第一个占位符之前的文本作为关键字（过短则只按状态筛） */
function keywordFromNormalizedError(message: string): string {
  const head = message.split('#')[0]?.trim() ?? '';
  return head.length >= 3 ? head : '';
}

function rateAccent(rate: number | null): string | undefined {
  if (rate == null) return undefined;
  if (rate < CRON_HEALTH_RULES.lowSuccessRatePercent) return 'var(--semi-color-danger)';
  if (rate < 95) return 'var(--semi-color-warning)';
  return 'var(--semi-color-success)';
}

export default function CronJobDashboard({ onViewLogs }: Readonly<Props>) {
  const palette = useChartPalette();
  const { hasPermission } = usePermission();
  const canExecute = hasPermission('system:cronjob:execute');
  const canUpdate = hasPermission('system:cronjob:update');
  const [days, setDays] = useState<CronStatsDays>(14);
  const [jobFilter, setJobFilter] = useState<JobFilter>('all');
  const statsQuery = useCronJobStats({ days });
  const stats = statsQuery.data ?? null;
  const runMutation = useRunCronJob();
  const toggleMutation = useUpdateCronJobStatus();
  const recentLogsSearch = useRecentLogsSearch();
  const logsPanelRef = useRef<HTMLDivElement>(null);

  // 相对时间以本次数据到达时刻为基准，随刷新一起推进
  const dataUpdatedAt = statsQuery.dataUpdatedAt;
  const now = useMemo(() => new Date(dataUpdatedAt || Date.now()), [dataUpdatedAt]);

  const handleRun = (jobId: number, jobName: string) => {
    Modal.confirm({
      title: '确定要立即执行一次吗？',
      content: `任务：${jobName}`,
      onOk: async () => {
        await runMutation.mutateAsync({ params: { id: jobId } });
        Toast.success('已触发执行');
      },
    });
  };

  const handleToggleStatus = (job: CronJobStatsPerJob) => {
    const next = job.enabled ? 'disabled' : 'enabled';
    const run = async () => {
      await toggleMutation.mutateAsync({ params: { id: job.jobId }, body: { status: next } });
      Toast.success(next === 'enabled' ? '已启用' : '已暂停');
    };
    if (next === 'enabled') {
      void run();
      return;
    }
    Modal.confirm({
      title: '暂停定时任务',
      content: `确定要暂停「${job.jobName}」吗？暂停后该任务将不再自动执行。`,
      okText: '暂停',
      okButtonProps: { type: 'warning' },
      cancelText: '取消',
      onOk: run,
    });
  };

  const alertingJobIds = useMemo(
    () => new Set((stats?.alerts ?? []).filter((a) => a.level !== 'info').map((a) => a.jobId)),
    [stats],
  );

  const filteredJobs = useMemo(() => {
    const rows = stats?.perJob ?? [];
    switch (jobFilter) {
      case 'alerting': return rows.filter((r) => alertingJobIds.has(r.jobId));
      case 'running': return rows.filter((r) => r.lastRunStatus === 'running');
      case 'disabled': return rows.filter((r) => !r.enabled);
      case 'never': return rows.filter((r) => r.totalRuns === 0);
      default: return rows;
    }
  }, [stats, jobFilter, alertingJobIds]);

  const jobOptions = useMemo(
    () => (stats?.perJob ?? []).map((p) => ({ value: p.jobId, label: p.jobName })).sort((a, b) => a.label.localeCompare(b.label)),
    [stats],
  );

  const filledDaily = useMemo(() => {
    const map = new Map((stats?.dailyStats ?? []).map((d) => [d.date, d]));
    const today = dayjs(now);
    return Array.from({ length: days }, (_, i) => {
      const date = today.subtract(days - 1 - i, 'day').format('YYYY-MM-DD');
      const d = map.get(date);
      return {
        date,
        total: d?.total ?? 0,
        successCount: d?.successCount ?? 0,
        failCount: d?.failCount ?? 0,
        avgDurationMs: d?.avgDurationMs ?? 0,
        p95DurationMs: d?.p95DurationMs ?? 0,
      };
    });
  }, [stats, days, now]);

  const trendSpec = useMemo(() => makeMixedBarLineSpec({
    data: filledDaily,
    xField: 'date',
    palette,
    bar: { field: 'successCount', name: '成功', color: SUCCESS_COLOR },
    stackedBars: [{ field: 'failCount', name: '失败', color: FAIL_COLOR }],
    line: { field: 'avgDurationMs', name: '平均耗时', color: DURATION_COLOR, format: (v) => formatDurationMs(v) },
    extraLines: [{ field: 'p95DurationMs', name: 'P95 耗时', color: P95_COLOR, lineWidth: 1.5, showPoint: false, format: (v) => formatDurationMs(v) }],
    axis: { xLabel: (d) => d.slice(5), rightLabel: (v) => formatDurationMs(v) },
    tooltip: { title: (x) => `日期：${x}`, barValue: (v) => `${v} 次` },
  }), [filledDaily, palette]);

  const heatmapData = useMemo(() => {
    const map = new Map((stats?.dowHourStats ?? []).map((d) => [`${d.dow}-${d.hour}`, d]));
    const cells: Array<{ hour: string; weekday: string; count: number; failCount: number }> = [];
    // 纵轴按数据顺序自下而上排列：倒序喂入让周一落在最上方
    for (let dow = 7; dow >= 1; dow--) {
      for (let hour = 0; hour < 24; hour++) {
        const d = map.get(`${dow}-${hour}`);
        cells.push({
          hour: `${String(hour).padStart(2, '0')}`,
          weekday: WEEKDAY_LABELS[dow - 1] ?? `周${dow}`,
          count: d?.total ?? 0,
          failCount: d?.failCount ?? 0,
        });
      }
    }
    return cells;
  }, [stats]);

  const heatmapSpec = useMemo(() => makeHeatmapSpec({
    data: heatmapData,
    xField: 'hour',
    yField: 'weekday',
    valueField: 'count',
    palette,
    axis: { xLabel: (v) => `${v}时` },
    tooltip: {
      title: (d) => `${(d as { weekday?: string })?.weekday ?? ''} ${(d as { hour?: string })?.hour ?? ''}:00`,
      valueName: '执行',
      value: (v, d) => `${v} 次 · 失败 ${(d as { failCount?: number })?.failCount ?? 0}`,
    },
  }), [heatmapData, palette]);

  const handleSelectError = (item: CronJobTopError) => {
    recentLogsSearch.applySearch({ keyword: keywordFromNormalizedError(item.message), status: 'fail', jobId: undefined, range: null });
    logsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (statsQuery.isLoading || !stats) return <LogStatsSkeleton />;

  const { today, yesterday, yesterdaySameTime, period, prevPeriod, scheduler, alerts } = stats;
  const todayRate = cronSuccessRatePercent(today.successCount, today.total);
  const periodRate = cronSuccessRatePercent(period.successCount, period.total);
  const disabledJobs = stats.totalJobs - stats.enabledJobs;
  const neverRun = stats.perJob.filter((p) => p.totalRuns === 0).length;
  const alertingJobs = alertingJobIds.size;

  return (
    <div className="zx-flat-panels cron-dashboard">
      <div className="cron-dashboard__toolbar">
        <SchedulerBar scheduler={scheduler} now={now} />
        <RadioGroup type="button" value={days} onChange={(e) => setDays(e.target.value as CronStatsDays)}>
          {CRON_STATS_DAYS_OPTIONS.map((d) => <Radio key={d} value={d}>近 {d} 天</Radio>)}
        </RadioGroup>
      </div>

      <Spin spinning={statsQuery.isFetching}>
        <StatGrid minItemWidth={150} gap={16} style={{ marginBottom: 16 }}>
          <StatCard
            title="任务总数" value={stats.totalJobs}
            sub={`启用 ${stats.enabledJobs} · 停用 ${disabledJobs}`}
            onClick={() => setJobFilter('all')} active={jobFilter === 'all'}
          />
          <StatCard
            title="运行中" value={stats.runningJobs}
            sub={`本节点执行中 ${scheduler.wipCount}`}
            accent={stats.runningJobs > 0 ? 'var(--semi-color-primary)' : undefined}
            onClick={() => setJobFilter('running')} active={jobFilter === 'running'}
          />
          <StatCard
            title="今日执行" value={today.total}
            sub={`成功 ${today.successCount} · 失败 ${today.failCount}`}
            delta={deltaOf(today.total, yesterdaySameTime.total)} deltaLabel="较昨日同时段"
          />
          <StatCard
            title="今日成功率" value={todayRate == null ? '—' : `${todayRate}%`}
            sub={`昨日全天 ${cronSuccessRatePercent(yesterday.successCount, yesterday.total) ?? '—'}%（${yesterday.total} 次）`}
            accent={rateAccent(todayRate)}
            delta={calcSuccessRateDelta(today, yesterdaySameTime)} deltaLabel="较昨日同时段" deltaFormat="ratio"
          />
          <StatCard
            title={`近 ${days} 天成功率`} value={periodRate == null ? '—' : `${periodRate}%`}
            sub={`${period.total} 次执行`}
            accent={rateAccent(periodRate)}
            delta={calcSuccessRateDelta(period, prevPeriod)} deltaLabel="较上期" deltaFormat="ratio"
          />
          <StatCard
            title="平均耗时" value={formatDurationMs(period.avgDurationMs)}
            sub={(
              <>
                P95 {formatDurationMs(period.p95DurationMs)} · 上期 {formatDurationMs(prevPeriod.avgDurationMs)}{' '}
                <TrendMark current={period.avgDurationMs} previous={prevPeriod.avgDurationMs} invert format={(d) => formatDurationMs(d)} />
              </>
            )}
          />
          <StatCard
            title="失败次数" value={period.failCount}
            sub={(
              <>
                上期 {prevPeriod.failCount}{' '}
                <TrendMark current={period.failCount} previous={prevPeriod.failCount} invert format={(d) => `${d}`} />
              </>
            )}
            accent={period.failCount > 0 ? 'var(--semi-color-danger)' : undefined}
          />
          <StatCard
            title="异常任务" value={alertingJobs}
            sub={`提醒 ${alerts.length} 条 · 从未执行 ${neverRun}`}
            accent={alertingJobs > 0 ? 'var(--semi-color-danger)' : 'var(--semi-color-success)'}
            onClick={() => setJobFilter('alerting')} active={jobFilter === 'alerting'}
          />
        </StatGrid>

        {alerts.length > 0 && (
          <Card title={`健康提醒 · ${alerts.length}`}>
            <CronJobAlertsPanel alerts={alerts} canExecute={canExecute} onViewLogs={onViewLogs} onRun={handleRun} />
          </Card>
        )}

        <div className="chart-grid chart-grid--aside" style={{ ['--chart-aside-main' as string]: '1.4fr', ['--chart-aside-side' as string]: '1fr', marginTop: 20 }}>
          <Card title={`近 ${days} 天执行趋势`}>
            <CommonChart {...trendSpec} options={chartOptions} height={260} />
          </Card>
          <Card title="执行时段分布（星期 × 小时）">
            <HeatmapChart {...heatmapSpec} options={chartOptions} height={260} />
          </Card>
        </div>

        <Card
          title={`任务健康 · ${filteredJobs.length}/${stats.perJob.length}`}
          headerExtraContent={(
            <RadioGroup type="button" value={jobFilter} onChange={(e) => setJobFilter(e.target.value as JobFilter)}>
              {(Object.keys(JOB_FILTER_LABELS) as JobFilter[]).map((k) => <Radio key={k} value={k}>{JOB_FILTER_LABELS[k]}</Radio>)}
            </RadioGroup>
          )}
        >
          <CronJobHealthTable
            rows={filteredJobs}
            loading={statsQuery.isFetching}
            now={now}
            onRefresh={() => { void statsQuery.refetch(); }}
            canExecute={canExecute}
            canUpdate={canUpdate}
            onViewLogs={onViewLogs}
            onRun={handleRun}
            onToggleStatus={handleToggleStatus}
          />
        </Card>

        <div className="chart-grid" style={{ marginTop: 20 }}>
          <Card title={`未来 24 小时调度 · ${stats.upcoming.length}`}>
            <UpcomingList items={stats.upcoming} now={now} />
          </Card>
          <Card title={`失败原因 Top ${stats.topErrors.length}`}>
            <TopErrorList items={stats.topErrors} now={now} onSelect={handleSelectError} />
          </Card>
        </div>

        <div ref={logsPanelRef}>
          <Card title="执行记录">
            <CronJobRecentLogs jobOptions={jobOptions} now={now} search={recentLogsSearch} onViewLogs={onViewLogs} />
          </Card>
        </div>
      </Spin>
    </div>
  );
}
