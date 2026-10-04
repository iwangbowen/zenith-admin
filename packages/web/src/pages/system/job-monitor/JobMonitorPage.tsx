import { useState } from 'react';
import { Banner, Col, Empty, Row, Select, Space, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { JOB_HEALTH_LABELS, JOB_SOURCE_CATEGORIES, JOB_SOURCE_CATEGORY_LABELS, type JobSourceSummary } from '@zenith/shared/platform';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import DateTimeText from '@/components/DateTimeText';
import PageLoading from '@/components/PageLoading';
import { RefreshButton } from '@/components/toolbar-controls';
import { useJobMonitorOverview } from '@/hooks/queries/job-monitor';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import JobSourceCard from './JobSourceCard';
import QueueBacklogTable from './QueueBacklogTable';
import WorkerNodesStrip from './WorkerNodesStrip';
import StuckJobsDrawer from './StuckJobsDrawer';
import JobTrendChart from './JobTrendChart';
import { JOB_HEALTH_COLORS, JOB_REFRESH_OPTIONS, sortJobSources } from './job-monitor-shared';

export default function JobMonitorPage() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useUrlTabState(JOB_SOURCE_CATEGORIES, 'runtime');
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
  return (
    <div className="page-container page-tabs-page zx-flat-panels" style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Space wrap>
          <Typography.Title heading={5} style={{ margin: 0 }}>作业监控</Typography.Title>
          <Tag color={JOB_HEALTH_COLORS[data.health]}>{JOB_HEALTH_LABELS[data.health]}</Tag>
        </Space>
        <Space wrap>
          <Typography.Text type="tertiary" size="small">生成于 <DateTimeText value={data.generatedAt} mode="absolute" /></Typography.Text>
          <Select aria-label="自动刷新" value={refreshValue} optionList={JOB_REFRESH_OPTIONS} onChange={(value) => setRefreshValue(String(value))} />
          <RefreshButton onClick={refresh} loading={overview.isFetching} />
        </Space>
      </div>
      {overview.isError && <Banner type="warning" closeIcon={null} description={`刷新失败，正在展示最近一次快照：${overview.error?.message ?? '未知错误'}`} />}
      {sources.some((source) => source.health === 'unavailable') && <Banner type="warning" closeIcon={null} description="部分作业源探测不可用，顶部汇总仅包含可用来源。" />}
      <StatGrid minItemWidth={150}>
        <StatCard title="在线 Worker" value={workers?.workerRoleActive ?? EMPTY_PLACEHOLDER} sub={workers ? `失联节点 ${workers.stale}` : '节点探测不可用'} accent={workers?.workerRoleActive === 0 ? 'var(--semi-color-danger)' : undefined} onClick={() => navigate('/system/scheduler?tab=nodes')} />
        <StatCard title="总积压" value={data.totals.backlog} />
        <StatCard title="运行中" value={data.totals.running} />
        <StatCard title="卡死" value={data.totals.stuck} accent={data.totals.stuck > 0 ? `var(--semi-color-${sources.some(source => source.counts.stuck > 0 && source.health === 'critical') ? 'danger' : 'warning'})` : undefined} />
        <StatCard title="死信" value={data.totals.dead} accent={data.totals.dead > 0 ? 'var(--semi-color-warning)' : undefined} />
        <StatCard title="近 24h 失败" value={data.totals.failed24h} />
      </StatGrid>
      <WorkerNodesStrip workers={data.workers} />
      <Tabs collapsible="auto" type="line" activeKey={activeCategory} onChange={key => setActiveCategory(key as typeof activeCategory)} lazyRender keepDOM={false}>
        {JOB_SOURCE_CATEGORIES.map(category => <Tabs.TabPane key={category} itemKey={category} tab={JOB_SOURCE_CATEGORY_LABELS[category]}>
          {sources.some(source => source.category === category) ? <Row gutter={[16, 16]}>
            {sources.filter(source => source.category === category).map(source => <Col key={source.key} xs={24} md={12} xl={8}><JobSourceCard source={source} onStuck={setStuckSource} /></Col>)}
          </Row> : <Empty title="暂无作业源" />}
        </Tabs.TabPane>)}
      </Tabs>
      <QueueBacklogTable queues={data.queues} refreshing={overview.isFetching} onRefresh={refresh} />
      <JobTrendChart />
      <StuckJobsDrawer source={stuckSource} onClose={() => setStuckSource(null)} />
    </div>
  );
}
