import { Activity, Database, Layers, Radio, Server } from 'lucide-react';
import { Banner, Skeleton, Typography } from '@douyinfe/semi-ui';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { FreshnessBadge, PartialDataBanner } from '@/components/observability/ObservabilityStatus';
import { useObservabilitySummary } from '@/hooks/queries/observability';
import './ObservabilitySummaryPanel.css';

const { Text } = Typography;

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export default function ObservabilitySummaryPanel() {
  const query = useObservabilitySummary();
  if (query.isPending) return <Skeleton active placeholder={<div className="observability-summary-skeleton" />} />;
  if (query.isError || !query.data) {
    return <Banner type="warning" description="观测汇总暂时不可用，基础设施监控仍可继续查看。" closeIcon={null} />;
  }

  const summary = query.data;
  const readyQueues = summary.capacity.queues.reduce((total, queue) => total + queue.ready, 0);
  const unavailableSources = summary.sources.filter((source) => source.status !== 'ok').map((source) => source.key);
  const primarySlo = summary.slos[0];
  const freshness = summary.sources.reduce<number | null>((max, source) => {
    if (source.ageSeconds === null) return max;
    return max === null ? source.ageSeconds : Math.max(max, source.ageSeconds);
  }, null);

  return (
    <section className="observability-summary-panel" aria-label="观测汇总">
      <div className="observability-summary-panel__header">
        <div>
          <Text strong>观测汇总</Text>
          <Text type="tertiary" size="small">低基数聚合视图 · {summary.window.seconds / 60} 分钟窗口</Text>
        </div>
        <div className="observability-summary-panel__status">
          <FreshnessBadge status={summary.status} ageSeconds={freshness} />
          <PartialDataBanner partial={summary.partial} unavailableSources={unavailableSources} />
        </div>
      </div>
      <StatGrid minItemWidth={180}>
        <StatCard title="Worker" value={summary.capacity.workers.active ?? '—'} sub={`需要 ${summary.capacity.workers.required ?? '—'} 个`} icon={<Server size={18} />} />
        <StatCard title="就绪队列" value={readyQueues} sub={`${summary.capacity.queues.length} 条队列`} icon={<Layers size={18} />} />
        <StatCard title="数据库连接" value={percent(summary.capacity.database.utilization)} sub={`${summary.capacity.database.activeConnections ?? '—'} / ${summary.capacity.database.totalConnections ?? '—'}`} icon={<Database size={18} />} />
        <StatCard title="Redis 客户端" value={percent(summary.capacity.redis.utilization)} sub={`${summary.capacity.redis.connectedClients ?? '—'} / ${summary.capacity.redis.maxClients ?? '—'}`} icon={<Radio size={18} />} />
        <StatCard title={primarySlo?.name ?? 'SLO'} value={primarySlo?.achieved === null || primarySlo?.achieved === undefined ? '—' : `${(primarySlo.achieved * 100).toFixed(2)}%`} sub={primarySlo ? `目标 ${(primarySlo.target * 100).toFixed(2)}% · ${primarySlo.status}` : '暂无样本'} icon={<Activity size={18} />} />
      </StatGrid>
    </section>
  );
}
