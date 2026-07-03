import { useMemo } from 'react';
import { Row, Col, Card, Table, Typography, Tag, Empty, Spin } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import {
  AreaChart,
  PieChart,
  chartOptions,
  makeAreaSpec,
  makePieSpec,
  useChartPalette,
} from '@/components/charts';
import { CronExpressionParser } from 'cron-parser';
import type { CronJob, CronJobStatsPerJob, CronJobRecentLog, CronRunStatus } from '@zenith/shared';
import dayjs from 'dayjs';
import { useCronJobStats } from '@/hooks/queries/cron-jobs';

const SUCCESS_COLOR = '#10b981';
const FAIL_COLOR = '#ef4444';
const RUNNING_COLOR = '#3b82f6';
const TREND_DAYS = 14;
const PANEL_TABLE_SCROLL_Y = 392;
const PANEL_PREVIEW_HEIGHT = 428;

interface UpcomingItem {
  key: string;
  jobId: number;
  jobName: string;
  time: Date;
  timeStr: string;
  dateLabel: string;
}

interface Props {
  jobs: CronJob[];
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function statusMeta(status: CronRunStatus | null): { label: string; color: 'green' | 'red' | 'blue' | 'grey' } {
  switch (status) {
    case 'success': return { label: '成功', color: 'green' };
    case 'fail': return { label: '失败', color: 'red' };
    case 'running': return { label: '运行中', color: 'blue' };
    default: return { label: '从未执行', color: 'grey' };
  }
}

function calcUpcoming(jobs: CronJob[], total = 30): UpcomingItem[] {
  const today = dayjs().format('YYYY-MM-DD');
  const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
  const results: UpcomingItem[] = [];
  const enabled = jobs.filter((j) => j.status === 'enabled');
  const perJob = Math.ceil(total / Math.max(enabled.length, 1)) + 3;

  for (const job of enabled) {
    try {
      const interval = CronExpressionParser.parse(job.cronExpression);
      for (let i = 0; i < perJob; i++) {
        const d = interval.next().toDate();
        const dateStr = dayjs(d).format('YYYY-MM-DD');
        let dateLabel: string;
        if (dateStr === today) dateLabel = '今天';
        else if (dateStr === tomorrow) dateLabel = '明天';
        else dateLabel = dayjs(d).format('MM月DD日');
        results.push({ key: `${job.id}-${i}`, jobId: job.id, jobName: job.name, time: d, timeStr: dayjs(d).format('HH:mm:ss'), dateLabel });
      }
    } catch { /* skip invalid expressions */ }
  }

  return results.toSorted((a, b) => a.time.getTime() - b.time.getTime()).slice(0, total);
}

export default function CronJobDashboard({ jobs }: Readonly<Props>) {
  const palette = useChartPalette();
  const statsQuery = useCronJobStats();
  const stats = statsQuery.data ?? null;
  const loading = statsQuery.isFetching;
  const upcoming = useMemo(() => calcUpcoming(jobs, 30), [jobs]);

  const todaySuccessRate =
    stats && stats.todayRuns > 0 ? Math.round((stats.todaySuccesses / stats.todayRuns) * 100) : null;

  let rateColor: string | undefined;
  if (todaySuccessRate !== null) {
    if (todaySuccessRate < 80) rateColor = 'var(--semi-color-warning)';
    else if (todaySuccessRate >= 95) rateColor = 'var(--semi-color-success)';
  }

  const disabledJobs = stats ? stats.totalJobs - stats.enabledJobs : 0;
  const neverRunCount = stats ? stats.perJob.filter((p) => p.totalRuns === 0).length : 0;
  const todayRunning = stats ? Math.max(0, stats.todayRuns - stats.todaySuccesses - stats.todayFails) : 0;

  const statItems = [
    { label: '任务总数', value: stats?.totalJobs ?? '—', sub: stats ? `启用 ${stats.enabledJobs} · 禁用 ${disabledJobs}` : null, color: undefined as string | undefined },
    { label: '当前运行中', value: stats?.runningJobs ?? '—', sub: null as string | null, color: (stats?.runningJobs ?? 0) > 0 ? 'var(--semi-color-primary)' : undefined },
    { label: '今日执行', value: stats?.todayRuns ?? '—', sub: stats ? `运行中 ${todayRunning}` : null, color: undefined },
    { label: '今日成功率', value: todaySuccessRate === null ? '—' : `${todaySuccessRate}%`, sub: stats ? `成功 ${stats.todaySuccesses} · 失败 ${stats.todayFails}` : null, color: rateColor },
    { label: '今日平均耗时', value: stats ? formatDuration(stats.todayAvgDurationMs) : '—', sub: '已完成执行', color: undefined },
    { label: '从未执行', value: stats ? neverRunCount : '—', sub: stats ? `共 ${stats.totalJobs} 个任务` : null, color: neverRunCount > 0 ? 'var(--semi-color-warning)' : undefined },
  ];

  const filledDaily = useMemo(() => {
    const map = new Map((stats?.dailyStats ?? []).map((d) => [d.date, d]));
    const today = dayjs();
    return Array.from({ length: TREND_DAYS }, (_, i) => {
      const date = today.subtract(TREND_DAYS - 1 - i, 'day').format('YYYY-MM-DD');
      return map.get(date) ?? { date, total: 0, successCount: 0, failCount: 0 };
    });
  }, [stats]);

  const trendSpec = useMemo(() => makeAreaSpec({
    data: filledDaily,
    xField: 'date',
    series: [
      { field: 'successCount', name: '成功', color: SUCCESS_COLOR },
      { field: 'failCount', name: '失败', color: FAIL_COLOR },
    ],
    palette,
    fillOpacity: 0.25,
    axis: { xLabel: (d) => d.slice(5) },
    tooltip: { title: (x) => `日期：${x}`, value: (v) => `${v} 次` },
  }), [filledDaily, palette]);

  const donutData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: '成功', value: stats.todaySuccesses, fill: SUCCESS_COLOR },
      { name: '失败', value: stats.todayFails, fill: FAIL_COLOR },
      { name: '运行中', value: todayRunning, fill: RUNNING_COLOR },
    ].filter((d) => d.value > 0);
  }, [stats, todayRunning]);

  const donutSpec = useMemo(() => makePieSpec({
    data: donutData,
    categoryField: 'name',
    valueField: 'value',
    donut: true,
    colors: donutData.map((d) => d.fill),
    palette,
    indicator: { title: String(stats?.todayRuns ?? 0), subtitle: '今日执行' },
    valueUnit: '次',
  }), [donutData, palette, stats?.todayRuns]);

  const perJobColumns: ColumnProps<CronJobStatsPerJob>[] = [
    { title: '任务名称', dataIndex: 'jobName', ellipsis: { showTitle: true } },
    {
      title: '最近状态', dataIndex: 'lastRunStatus', width: 96,
      render: (v: CronRunStatus | null, record: CronJobStatsPerJob) => {
        const meta = statusMeta(v);
        return <span title={record.lastRunAt ?? undefined}><Tag color={meta.color} size="small" type="light">{meta.label}</Tag></span>;
      },
    },
    { title: '总执行', dataIndex: 'totalRuns', width: 90, align: 'right' },
    {
      title: '成功', dataIndex: 'successCount', width: 90, align: 'right',
      render: (v: number) => <span style={{ color: 'var(--semi-color-success)' }}>{v}</span>,
    },
    {
      title: '失败', dataIndex: 'failCount', width: 90, align: 'right',
      render: (v: number) => (v > 0 ? <span style={{ color: 'var(--semi-color-danger)' }}>{v}</span> : <span>{v}</span>),
    },
    {
      title: '平均耗时', dataIndex: 'avgDurationMs', width: 96, align: 'right',
      render: (v: number | null) => formatDuration(v),
    },
    {
      title: '成功率', dataIndex: 'successRate', width: 84, align: 'right',
      render: (v: number, record: CronJobStatsPerJob) => {
        if (record.totalRuns === 0) return '—';
        let tagColor: 'green' | 'orange' | 'red' = 'red';
        if (v >= 90) tagColor = 'green';
        else if (v >= 70) tagColor = 'orange';
        return <Tag color={tagColor} size="small">{v}%</Tag>;
      },
    },
  ];

  const recentColumns: ColumnProps<CronJobRecentLog>[] = [
    { title: '时间', dataIndex: 'startedAt', width: 170, render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    { title: '任务名称', dataIndex: 'jobName', width: 180, ellipsis: { showTitle: true } },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: CronRunStatus) => {
        const meta = statusMeta(v);
        return <Tag color={meta.color} size="small" type="light">{meta.label}</Tag>;
      },
    },
    {
      title: '耗时', dataIndex: 'durationMs', width: 96, align: 'right',
      render: (v: number | null, record: CronJobRecentLog) => (record.status === 'running' ? '运行中' : formatDuration(v)),
    },
    {
      title: '执行次数', dataIndex: 'executionCount', width: 104, align: 'right',
      render: (v: number) => `第 ${v} 次`,
    },
    {
      title: '输出', dataIndex: 'output', ellipsis: { showTitle: true },
      render: (v: string | null) => (v == null || v === '' ? <Typography.Text type="tertiary">—</Typography.Text> : <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v}</Typography.Text>),
    },
  ];

  // Group upcoming by dateLabel
  const groupedUpcoming: Array<{ dateLabel: string; items: UpcomingItem[] }> = [];
  for (const item of upcoming) {
    const last = groupedUpcoming.at(-1);
    if (last?.dateLabel === item.dateLabel) {
      last.items.push(item);
    } else {
      groupedUpcoming.push({ dateLabel: item.dateLabel, items: [item] });
    }
  }

  return (
    <Spin spinning={loading}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {statItems.map((s) => (
          <div key={s.label} style={{ flex: 1, minWidth: 150 }}>
            <Card bodyStyle={{ textAlign: 'center', padding: '16px 12px 12px' }}>
              <Typography.Text type="tertiary" size="small">{s.label}</Typography.Text>
              <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.3, marginTop: 6, color: s.color }}>
                {String(s.value)}
              </div>
              <Typography.Text type="tertiary" size="small">{s.sub ?? '\u00A0'}</Typography.Text>
            </Card>
          </div>
        ))}
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={14}>
          <Card title={`近 ${TREND_DAYS} 天执行趋势`}>
            <AreaChart {...trendSpec} options={chartOptions} height={260} />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="今日执行状态分布">
            {!stats || stats.todayRuns === 0 ? (
              <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty description="今日暂无执行" />
              </div>
            ) : (
              <PieChart {...donutSpec} options={chartOptions} height={260} />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={14}>
          <Card title="任务执行统计">
            <Table
              size="small"
              rowKey="jobId"
              dataSource={stats?.perJob ?? []}
              columns={perJobColumns}
              pagination={false}
              scroll={{ y: PANEL_TABLE_SCROLL_Y }}
              empty={<Empty description="暂无任务" />}
              loading={loading}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card title={`调度预览（接下来 ${upcoming.length} 次执行）`}>
            <div style={{ height: PANEL_PREVIEW_HEIGHT, overflowY: 'auto' }}>
              {upcoming.length === 0 ? (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Empty description="无启用中的任务" />
                </div>
              ) : (
                <>
                {groupedUpcoming.map((group) => (
                  <div key={group.dateLabel} style={{ marginBottom: 8 }}>
                    <div style={{
                      padding: '3px 4px',
                      marginBottom: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--semi-color-text-2)',
                      borderBottom: '1px solid var(--semi-color-border)',
                    }}>
                      {group.dateLabel}
                    </div>
                    {group.items.map((item) => (
                      <div key={item.key} style={{
                        display: 'flex',
                        gap: 12,
                        padding: '5px 4px',
                        alignItems: 'center',
                        borderRadius: 4,
                      }}>
                        <Typography.Text style={{ fontFamily: 'monospace', minWidth: 68, flexShrink: 0, color: 'var(--semi-color-primary)' }}>
                          {item.timeStr}
                        </Typography.Text>
                        <Typography.Text ellipsis={{ showTooltip: true }} style={{ flex: 1 }}>
                          {item.jobName}
                        </Typography.Text>
                      </div>
                    ))}
                  </div>
                ))}
                </>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      <Card title="最近执行记录">
        <Table
          size="small"
          rowKey="id"
          dataSource={stats?.recentLogs ?? []}
          columns={recentColumns}
          pagination={false}
          empty={<Empty description="暂无执行记录" />}
          loading={loading}
        />
      </Card>
    </Spin>
  );
}
