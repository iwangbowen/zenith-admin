import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Empty, Modal, Popover, Radio, RadioGroup, Spin, Tag, Toast, Tooltip } from '@douyinfe/semi-ui';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { CronJobStats, CronJobStatsPerJob, CronJobTopError, CronJobUpcomingRun } from '@zenith/shared/platform';
import { CRON_HEALTH_RULES, SCHEDULER_WARNING_SEVERE_TYPES, cronSuccessRatePercent, schedulerWarningLabel } from '@zenith/shared/platform';
import dayjs from 'dayjs';
import {
  CommonChart,
  HeatmapChart,
  chartOptions,
  makeHeatmapSpec,
  useChartPalette,
  StatCard,
  StatGrid,
} from '@/components/charts';
import { LogStatsSkeleton, WEEKDAY_LABELS, calcSuccessRateDelta, deltaOf } from '@/components/logs/LogStatsScaffold';
import { usePermission } from '@/hooks/usePermission';
import { CRON_STATS_REFETCH_INTERVAL_MS, useCronJobStats, useRunCronJob, useUpdateCronJobStatus } from '@/hooks/queries/cron-jobs';
import { formatDurationMs } from '@/utils/format';
import { formatRelativeTime } from '@/utils/date';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { CronJobAlertsPanel } from './CronJobAlertsPanel';
import { CronJobDetailDrawer } from './CronJobDetailDrawer';
import { CronJobHealthTable } from './CronJobHealthTable';
import { CronJobRecentLogs } from './CronJobRecentLogs';
import {
  CRON_STATS_DAYS_OPTIONS,
  RelativeTime,
  TrendMark,
  buildCronTrendSpec,
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

function SchedulerWarnings({ warnings, now }: Readonly<{ warnings: CronJobStats['scheduler']['warnings']; now: Date }>) {
  if (warnings.length === 0) return null;
  const severe = warnings.some((w) => (SCHEDULER_WARNING_SEVERE_TYPES as readonly string[]).includes(w.type));
  return (
    <Popover
      position="bottomLeft"
      showArrow
      content={(
        <div className="cron-warnings">
          <div className="cron-warnings__title">pg-boss 运维警告（在线节点最近上报）</div>
          {warnings.map((w) => (
            <div key={`${w.nodeId}-${w.type}-${w.message}`} className="cron-warning">
              <div className="cron-warning__head">
                <Tag size="small" color={(SCHEDULER_WARNING_SEVERE_TYPES as readonly string[]).includes(w.type) ? 'orange' : 'grey'} type="light">
                  {schedulerWarningLabel(w.type)}
                </Tag>
                <span className="cron-warning__meta cron-mono">{w.nodeId}</span>
                <span className="cron-warning__meta">{formatRelativeTime(w.at, now)}</span>
              </div>
              <div className="cron-warning__message">{w.message}</div>
            </div>
          ))}
        </div>
      )}
    >
      <span className={`cron-chip cron-chip--clickable ${severe ? 'cron-chip--warn' : 'cron-chip--neutral'}`}>
        <AlertTriangle size={12} />
        {warnings.length} 条运维警告
      </span>
    </Popover>
  );
}

function HealthChip({ tone, tooltip, children }: Readonly<{ tone: 'ok' | 'warn' | 'danger' | 'neutral'; tooltip: React.ReactNode; children: React.ReactNode }>) {
  return (
    <Tooltip content={tooltip} position="bottom">
      <span className={`cron-chip cron-chip--${tone}`}>{children}</span>
    </Tooltip>
  );
}

function SchedulerHealth({ scheduler }: Readonly<{ scheduler: CronJobStats['scheduler'] }>) {
  const inconsistent = scheduler.scheduleMissing.length + scheduler.scheduleOrphans.length;
  return (
    <>
      {scheduler.schemaVersion != null && (
        scheduler.schemaDriftOk === false ? (
          <HealthChip tone="danger" tooltip={`pg-boss schema v${scheduler.schemaVersion}：detectSchemaDrift() 发现 ${scheduler.schemaDriftIssues} 项结构不一致（缺失 / 无效 / 不匹配的表、索引、函数、列、约束或枚举），请检查 pg-boss 迁移是否完整执行`}>
            <AlertTriangle size={12} />
            schema v{scheduler.schemaVersion} 漂移 {scheduler.schemaDriftIssues}
          </HealthChip>
        ) : (
          <HealthChip tone={scheduler.schemaDriftOk ? 'ok' : 'neutral'} tooltip={scheduler.schemaDriftOk ? `pg-boss schema v${scheduler.schemaVersion}，结构校验通过（每 10 分钟复检）` : `pg-boss schema v${scheduler.schemaVersion}，尚未完成结构校验`}>
            schema v{scheduler.schemaVersion}
          </HealthChip>
        )
      )}
      {inconsistent > 0 ? (
        <Popover
          position="bottomLeft"
          showArrow
          content={(
            <div className="cron-warnings">
              <div className="cron-warnings__title">任务与 pg-boss 调度计划不一致（启动时会自动对账，持续存在请检查日志）</div>
              {scheduler.scheduleMissing.length > 0 && (
                <div className="cron-warning">
                  <div className="cron-warning__head"><Tag size="small" color="red" type="light">启用中但未注册计划</Tag></div>
                  <div className="cron-warning__message cron-mono">{scheduler.scheduleMissing.map((id) => `#${id}`).join('、')}</div>
                </div>
              )}
              {scheduler.scheduleOrphans.length > 0 && (
                <div className="cron-warning">
                  <div className="cron-warning__head"><Tag size="small" color="orange" type="light">计划已注册但任务不存在或已停用</Tag></div>
                  <div className="cron-warning__message cron-mono">{scheduler.scheduleOrphans.map((key) => `key ${key}`).join('、')}</div>
                </div>
              )}
            </div>
          )}
        >
          <span className="cron-chip cron-chip--danger cron-chip--clickable">
            <AlertTriangle size={12} />
            计划不一致 {inconsistent}
          </span>
        </Popover>
      ) : (
        <HealthChip tone="ok" tooltip="启用中的每个任务在 pg-boss 中都有且仅有一条对应的调度计划">计划一致</HealthChip>
      )}
      {scheduler.maintaining && (
        <HealthChip tone="neutral" tooltip="本节点正在执行 pg-boss 维护（归档、清理、索引整理），期间取用新作业可能略有延迟">维护中</HealthChip>
      )}
      {scheduler.bamFailed > 0 ? (
        <HealthChip tone="danger" tooltip={`pg-boss 后台异步迁移（如大索引重建）有 ${scheduler.bamFailed} 条失败，请查看运维警告与服务端日志`}>
          <AlertTriangle size={12} />
          异步迁移失败 {scheduler.bamFailed}
        </HealthChip>
      ) : scheduler.bamPending > 0 ? (
        <HealthChip tone="warn" tooltip={`pg-boss 有 ${scheduler.bamPending} 条后台异步迁移待执行或进行中，完成前部分索引可能尚未生效`}>
          异步迁移中 {scheduler.bamPending}
        </HealthChip>
      ) : null}
    </>
  );
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
      <SchedulerHealth scheduler={scheduler} />
      <SchedulerWarnings warnings={scheduler.warnings} now={now} />
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
  const [detailJob, setDetailJob] = useState<{ id: number; name: string } | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  // 「更新于 x 秒前」每 5 秒触发一次重渲染重算；数据到达时刻本身由 dataUpdatedAt 驱动
  const [, bumpClock] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => bumpClock((v) => v + 1), 5_000);
    return () => clearInterval(timer);
  }, []);

  // 相对时间以本次数据到达时刻为基准，随刷新一起推进
  const dataUpdatedAt = statsQuery.dataUpdatedAt;
  const now = useMemo(() => new Date(dataUpdatedAt || Date.now()), [dataUpdatedAt]);
  // 图表只在首次出现时播放入场动画；之后的自动刷新直接换数据，不再重播柱子生长
  const [chartAnimation, setChartAnimation] = useState(true);
  const hasStats = stats != null;
  useEffect(() => {
    if (!hasStats) return;
    const timer = setTimeout(() => setChartAnimation(false), 1500);
    return () => clearTimeout(timer);
  }, [hasStats]);
  const updatedAgo = dataUpdatedAt ? formatRelativeTime(new Date(dataUpdatedAt)) : '';

  const openDetail = (jobId: number, jobName: string) => {
    setDetailJob({ id: jobId, name: jobName });
    setDetailVisible(true);
  };

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
        timeoutCount: d?.timeoutCount ?? 0,
        avgDurationMs: d?.avgDurationMs ?? 0,
        p95DurationMs: d?.p95DurationMs ?? 0,
      };
    });
  }, [stats, days, now]);

  const trendSpec = useMemo(() => ({ ...buildCronTrendSpec(filledDaily, palette), animation: chartAnimation }), [filledDaily, palette, chartAnimation]);

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

  const heatmapSpec = useMemo(() => ({ ...makeHeatmapSpec({
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
  }), animation: chartAnimation }), [heatmapData, palette, chartAnimation]);

  const handleSelectError = (item: CronJobTopError) => {
    // 归一化错误同时来自失败与超时记录，不限定状态，只按关键字定位
    recentLogsSearch.applySearch({ keyword: keywordFromNormalizedError(item.message), status: undefined, trigger: undefined, jobId: undefined, range: null });
    logsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (statsQuery.isLoading || !stats) return <LogStatsSkeleton />;

  // 只有切换统计周期（拿旧周期数据占位）时才盖遮罩；30 秒自动刷新与手动刷新静默换数据，
  // 进度只通过右上角「刷新中…」与旋转图标提示，避免整页周期性闪一次 loading
  const switchingPeriod = statsQuery.isPlaceholderData;

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
        <div className="cron-panel-extra">
          <Tooltip content={`每 ${CRON_STATS_REFETCH_INTERVAL_MS / 1000} 秒自动刷新（页面后台时暂停）`} position="bottom">
            <span className="cron-scheduler__meta">{statsQuery.isFetching ? '刷新中…' : updatedAgo ? `更新于 ${updatedAgo}` : ''}</span>
          </Tooltip>
          <Button
            type="tertiary" theme="borderless" size="small"
            icon={<RefreshCw size={14} className={statsQuery.isFetching ? 'spin' : ''} />}
            aria-label="立即刷新" title="立即刷新"
            disabled={statsQuery.isFetching}
            onClick={() => { void statsQuery.refetch(); }}
          />
          <RadioGroup type="button" value={days} onChange={(e) => setDays(e.target.value as CronStatsDays)}>
            {CRON_STATS_DAYS_OPTIONS.map((d) => <Radio key={d} value={d}>近 {d} 天</Radio>)}
          </RadioGroup>
        </div>
      </div>

      <Spin spinning={switchingPeriod}>
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
            title="今日成功率" value={todayRate == null ? EMPTY_PLACEHOLDER : `${todayRate}%`}
            sub={`昨日全天 ${cronSuccessRatePercent(yesterday.successCount, yesterday.total) ?? EMPTY_PLACEHOLDER}%`}
            accent={rateAccent(todayRate)}
            delta={calcSuccessRateDelta(today, yesterdaySameTime)} deltaLabel="较昨日同时段" deltaFormat="ratio"
          />
          <StatCard
            title={`近 ${days} 天成功率`} value={periodRate == null ? EMPTY_PLACEHOLDER : `${periodRate}%`}
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
            title="失败 / 超时" value={`${period.failCount} / ${period.timeoutCount}`}
            sub={(
              <>
                上期 {prevPeriod.failCount} / {prevPeriod.timeoutCount}{' '}
                <TrendMark
                  current={period.failCount + period.timeoutCount}
                  previous={prevPeriod.failCount + prevPeriod.timeoutCount}
                  invert
                  format={(d) => `${d}`}
                />
              </>
            )}
            accent={period.failCount + period.timeoutCount > 0 ? 'var(--semi-color-danger)' : undefined}
          />
          <StatCard
            title="平均调度延迟" value={formatDurationMs(period.avgLatencyMs)}
            sub={(
              <>
                重试 {period.retryCount} · 手动 {period.manualCount}{' '}
                <TrendMark current={period.avgLatencyMs} previous={prevPeriod.avgLatencyMs} invert format={(d) => formatDurationMs(d)} />
              </>
            )}
            accent={period.avgLatencyMs != null && period.avgLatencyMs >= 10_000 ? 'var(--semi-color-warning)' : undefined}
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
            loading={switchingPeriod}
            now={now}
            onRefresh={() => { void statsQuery.refetch(); }}
            canExecute={canExecute}
            canUpdate={canUpdate}
            onViewLogs={onViewLogs}
            onOpenDetail={openDetail}
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

      <CronJobDetailDrawer
        jobId={detailJob?.id ?? null}
        jobName={detailJob?.name ?? ''}
        days={days}
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
        onViewLogs={onViewLogs}
      />
    </div>
  );
}
