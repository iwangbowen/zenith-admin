import { useState } from 'react';
import { Button, Empty, Select, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { JOB_HEALTH_LABELS, type JobSourceSummary } from '@zenith/shared/platform';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import DateTimeText from '@/components/DateTimeText';
import PageLoading from '@/components/PageLoading';
import { RefreshButton } from '@/components/toolbar-controls';
import { useJobMonitorOverview } from '@/hooks/queries/job-monitor';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import JobSourceList from './JobSourceList';
import QueueBacklogTable from './QueueBacklogTable';
import WorkerNodesStrip from './WorkerNodesStrip';
import StuckJobsDrawer from './StuckJobsDrawer';
import JobTrendChart from './JobTrendChart';
import { formatAge, JOB_HEALTH_COLORS, JOB_REFRESH_OPTIONS, sortJobSources } from './job-monitor-shared';
import './job-monitor.css';

function isProblemSource(source: JobSourceSummary) {
  return source.health !== 'ok'
    || source.counts.pending > 0
    || source.counts.running > 0
    || source.counts.stuck > 0
    || (source.counts.dead ?? 0) > 0
    || source.counts.failed24h > 0;
}

function issueSummary(source: JobSourceSummary) {
  if (source.reason) return source.reason;
  if (source.issues[0]?.message) return source.issues[0].message;
  if (source.counts.stuck > 0) return `${source.counts.stuck} 条作业超过推进阈值仍未恢复`;
  if ((source.counts.dead ?? 0) > 0) return `${source.counts.dead} 条作业进入死信`;
  if (source.counts.failed24h > 0) return `近 24 小时失败 ${source.counts.failed24h} 次`;
  if (source.counts.pending > 0) return `有 ${source.counts.pending} 条作业待处理`;
  return '作业源状态需要关注';
}

export default function JobMonitorPage() {
  const navigate = useNavigate();
  const [refreshValue, setRefreshValue] = useState('30000');
  const [stuckSource, setStuckSource] = useState<JobSourceSummary | null>(null);
  const overview = useJobMonitorOverview({ refetchInterval: refreshValue === 'off' ? false : Number(refreshValue) });
  const data = overview.data;
  const refresh = () => { void overview.refetch(); };

  if (!data) {
    return overview.isError ? (
      <div className="page-container">
        <Empty title="作业监控加载失败" description={overview.error?.message} />
        <RefreshButton onClick={refresh} loading={overview.isFetching} />
      </div>
    ) : <PageLoading inline />;
  }

  const workers = data.workers.data;
  const sources = sortJobSources(data.sources);
  const problemSources = sources.filter(isProblemSource);
  const sourceByKey = new Map(sources.map((source) => [source.key, source]));
  const incidentSourceKeys = new Set(data.incidents.map((incident) => incident.source));
  const sourceAlerts = problemSources.filter((source) => !incidentSourceKeys.has(source.key) || source.counts.stuck === 0);
  const unavailableCount = sources.filter((source) => source.health === 'unavailable').length;
  const openStuckDetails = () => {
    const source = sourceByKey.get(data.incidents[0]?.source) ?? problemSources.find((item) => item.counts.stuck > 0);
    if (source) setStuckSource(source);
    else navigate('/system/scheduler?tab=runs&status=running');
  };
  return (
    <div className="page-container zx-flat-panels job-monitor-page">
      <div className="job-monitor-page__header">
        <div>
          <Space wrap>
            <Typography.Title heading={5} style={{ margin: 0 }}>作业监控</Typography.Title>
            <Tag color={JOB_HEALTH_COLORS[data.health]}>{JOB_HEALTH_LABELS[data.health]}</Tag>
          </Space>
          <Typography.Text type="tertiary" size="small">平台级作业健康 · 生成于 <DateTimeText value={data.generatedAt} mode="absolute" /></Typography.Text>
        </div>
        <Space wrap>
          <Select aria-label="自动刷新" value={refreshValue} optionList={JOB_REFRESH_OPTIONS} onChange={(value) => setRefreshValue(String(value))} />
          <RefreshButton onClick={refresh} loading={overview.isFetching} />
        </Space>
      </div>
      {overview.isError && <div className="job-monitor-inline-notice job-monitor-inline-notice--warning" role="status">刷新失败，正在展示最近一次快照：{overview.error?.message ?? '未知错误'}</div>}
      {unavailableCount > 0 && <div className="job-monitor-inline-notice" role="status">{unavailableCount} 个作业源暂不可用，顶部汇总已排除这些来源。</div>}

      <StatGrid minItemWidth={150}>
        <StatCard title="在线 Worker" value={workers?.workerRoleActive ?? EMPTY_PLACEHOLDER} sub={workers ? `失联节点 ${workers.stale}` : '节点探测不可用'} accent={workers?.workerRoleActive === 0 ? 'var(--semi-color-danger)' : undefined} onClick={() => navigate('/system/scheduler?tab=nodes')} />
        <StatCard title="总积压" value={data.totals.backlog} sub="到期未领取" onClick={() => navigate('/system/scheduler?tab=tasks')} />
        <StatCard title="运行中" value={data.totals.running} sub="当前执行" onClick={() => navigate('/system/scheduler?tab=runs&status=running')} />
        <StatCard title="卡死" value={data.totals.stuck} sub={problemSources.length > 0 ? `${problemSources.length} 个来源需关注` : '当前无异常'} accent={data.totals.stuck > 0 ? 'var(--semi-color-danger)' : undefined} onClick={openStuckDetails} />
        <StatCard title="死信" value={data.totals.dead} accent={data.totals.dead > 0 ? 'var(--semi-color-warning)' : undefined} onClick={() => navigate('/system/task-center?tab=tasks&status=dead')} />
        <StatCard title="近 24h 失败" value={data.totals.failed24h} onClick={() => navigate('/system/task-center?tab=tasks&status=failed')} />
      </StatGrid>

      <section className="job-monitor-section job-monitor-issues" aria-label="当前异常">
        <div className="job-monitor-section__header">
          <Typography.Text strong>当前异常</Typography.Text>
          <Typography.Text type="tertiary" size="small">{data.incidents.length + sourceAlerts.length > 0 ? `${data.incidents.length + sourceAlerts.length} 条异常需要关注` : '当前没有需要处理的作业源'}</Typography.Text>
        </div>
        {data.incidents.length + sourceAlerts.length === 0 ? <Empty description="作业源运行正常" /> : (
          <div className="job-monitor-issues__list">
            {data.incidents.map((incident) => {
              const source = sourceByKey.get(incident.source);
              return (
              <div className="job-monitor-issue-row" key={`${incident.source}-${incident.refId}`}>
                <div className="job-monitor-issue-row__title">
                  <span className={`job-monitor-health-dot job-monitor-health-dot--${source?.health ?? 'critical'}`} />
                  <Typography.Text strong>{incident.title}</Typography.Text>
                  <Typography.Text type="tertiary" size="small">{source?.title ?? incident.source} · {incident.refId}</Typography.Text>
                </div>
                <Typography.Text type="tertiary" size="small">{incident.detail ?? incident.status}</Typography.Text>
                <div className="job-monitor-issue-row__meta">
                  <Typography.Text type="danger" size="small">持续 {formatAge(incident.ageSec)}</Typography.Text>
                  {incident.nodeId && <Typography.Text type="tertiary" size="small">节点 {incident.nodeId}</Typography.Text>}
                  {incident.drillDown && <Button theme="borderless" size="small" onClick={() => navigate(incident.drillDown!.path)}>{incident.drillDown.label}</Button>}
                </div>
              </div>
              );
            })}
            {sourceAlerts.map((source) => (
              <div className="job-monitor-issue-row" key={source.key}>
                <div className="job-monitor-issue-row__title">
                  <span className={`job-monitor-health-dot job-monitor-health-dot--${source.health}`} />
                  <Typography.Text strong>{source.title}</Typography.Text>
                  <Tag color={JOB_HEALTH_COLORS[source.health]} size="small">{JOB_HEALTH_LABELS[source.health]}</Tag>
                </div>
                <Typography.Text type="tertiary" size="small">{issueSummary(source)}</Typography.Text>
                <div className="job-monitor-issue-row__meta">
                  <Typography.Text type={source.counts.stuck > 0 ? 'danger' : 'tertiary'} size="small">卡死 {source.counts.stuck}</Typography.Text>
                  <Typography.Text type="tertiary" size="small">待处理 {source.counts.pending}</Typography.Text>
                  {source.supportsStuckList && source.counts.stuck > 0 && <Button theme="borderless" type="danger" size="small" onClick={() => setStuckSource(source)}>卡死明细</Button>}
                  {source.drillDown && <Button theme="borderless" size="small" onClick={() => navigate(source.drillDown!.path)}>{source.drillDown.label}</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <WorkerNodesStrip workers={data.workers} />

      <section className="job-monitor-section job-monitor-sources" aria-label="作业源状态">
        <div className="job-monitor-section__header">
          <Typography.Text strong>作业源状态</Typography.Text>
          <Typography.Text type="tertiary" size="small">按分类查看全部 {sources.length} 个来源</Typography.Text>
        </div>
        <JobSourceList sources={sources} onStuck={setStuckSource} />
      </section>

      <QueueBacklogTable queues={data.queues} refreshing={overview.isFetching} onRefresh={refresh} />
      <JobTrendChart />
      <StuckJobsDrawer source={stuckSource} onClose={() => setStuckSource(null)} />
    </div>
  );
}
