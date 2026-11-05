import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, Layers, Radio, Server, Timer } from 'lucide-react';
import { Banner, Skeleton, Tag, Typography } from '@douyinfe/semi-ui';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { FreshnessBadge, PartialDataBanner } from '@/components/observability/ObservabilityStatus';
import { useObservabilitySummary } from '@/hooks/queries/observability';
import './ObservabilitySummaryPanel.css';

const { Text } = Typography;

const STATUS_LABELS = { ok: '正常', degraded: '降级', unavailable: '不可用' } as const;
const STATUS_COLORS = { ok: 'green', degraded: 'orange', unavailable: 'red' } as const;
const DEPENDENCY_LABELS: Record<string, string> = {
  database: '数据库',
  redis: 'Redis',
  invalidationBus: '缓存失效总线',
  workers: '后台 Worker',
  telemetry: '观测链路',
};

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
  const queueTotals = summary.capacity.queues.reduce((totals, queue) => ({
    ready: totals.ready + queue.ready,
    active: totals.active + queue.active,
    deferred: totals.deferred + queue.deferred,
    failed: totals.failed + queue.failed,
  }), { ready: 0, active: 0, deferred: 0, failed: 0 });
  const sourceCounts = summary.sources.reduce((counts, source) => ({ ...counts, [source.status]: counts[source.status] + 1 }), { ok: 0, degraded: 0, unavailable: 0 });
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
      <div className="observability-summary-sections">
        <section className="observability-summary-section">
          <div className="observability-summary-section__header">
            <Text strong>依赖健康</Text>
            <Text type="tertiary" size="small">关键运行依赖与 Worker 状态</Text>
          </div>
          <div className="monitor-overview-grid observability-stat-grid">
            {Object.entries(summary.dependencies).map(([key, status]) => (
              <div className="monitor-overview-metric monitor-overview-metric--plain" key={key}>
                <div className="monitor-overview-metric__header"><Activity size={15} /><Text strong>{DEPENDENCY_LABELS[key] ?? key}</Text></div>
                <div className={`monitor-overview-metric__value observability-status-value observability-status-value--${status}`}>{STATUS_LABELS[status]}</div>
                <div className="monitor-overview-metric__info"><Tag color={STATUS_COLORS[status]} size="small">{STATUS_LABELS[status]}</Tag></div>
              </div>
            ))}
          </div>
        </section>

        <section className="observability-summary-section">
          <div className="observability-summary-section__header">
            <Text strong>SLO 与错误预算</Text>
            <Text type="tertiary" size="small">当前窗口 {summary.window.seconds} 秒</Text>
          </div>
          <div className="monitor-overview-grid observability-stat-grid">
            <div className="monitor-overview-metric monitor-overview-metric--plain">
              <div className="monitor-overview-metric__header"><CheckCircle2 size={15} /><Text strong>当前达成率</Text></div>
              <div className="monitor-overview-metric__value">{primarySlo?.achieved == null ? '—' : `${(primarySlo.achieved * 100).toFixed(2)}%`}</div>
              <div className="monitor-overview-metric__info"><Text type="tertiary" size="small">目标 {primarySlo ? `${(primarySlo.target * 100).toFixed(2)}%` : '—'}</Text></div>
            </div>
            <div className="monitor-overview-metric monitor-overview-metric--plain">
              <div className="monitor-overview-metric__header"><Activity size={15} /><Text strong>错误预算</Text></div>
              <div className="monitor-overview-metric__value">{primarySlo?.errorBudgetRemaining == null ? '—' : `${(primarySlo.errorBudgetRemaining * 100).toFixed(1)}%`}</div>
              <div className="monitor-overview-metric__info"><Text type="tertiary" size="small">剩余预算</Text></div>
            </div>
            <div className="monitor-overview-metric monitor-overview-metric--plain">
              <div className="monitor-overview-metric__header"><Timer size={15} /><Text strong>快速消耗</Text></div>
              <div className="monitor-overview-metric__value">{primarySlo?.burnRateFast == null ? '—' : `${primarySlo.burnRateFast.toFixed(2)}x`}</div>
              <div className="monitor-overview-metric__info"><Tag color={primarySlo?.status === 'ok' ? 'green' : 'orange'} size="small">{primarySlo ? STATUS_LABELS[primarySlo.status] : '无样本'}</Tag></div>
            </div>
            <div className="monitor-overview-metric monitor-overview-metric--plain">
              <div className="monitor-overview-metric__header"><Clock3 size={15} /><Text strong>观测窗口</Text></div>
              <div className="monitor-overview-metric__value">{summary.window.seconds}s</div>
              <div className="monitor-overview-metric__info"><Text type="tertiary" size="small">{primarySlo?.totalEvents ?? 0} 次请求</Text></div>
            </div>
          </div>
        </section>

        <section className="observability-summary-section">
          <div className="observability-summary-section__header">
            <Text strong>队列容量</Text>
            <Text type="tertiary" size="small">就绪、执行中、延迟和失败作业</Text>
          </div>
          <div className="monitor-overview-grid observability-stat-grid">
            <div className="monitor-overview-metric monitor-overview-metric--plain"><div className="monitor-overview-metric__header"><Layers size={15} /><Text strong>就绪作业</Text></div><div className="monitor-overview-metric__value">{queueTotals.ready}</div><div className="monitor-overview-metric__info"><Text type="tertiary" size="small">等待领取</Text></div></div>
            <div className="monitor-overview-metric monitor-overview-metric--plain"><div className="monitor-overview-metric__header"><Activity size={15} /><Text strong>执行中</Text></div><div className="monitor-overview-metric__value">{queueTotals.active}</div><div className="monitor-overview-metric__info"><Text type="tertiary" size="small">当前占用</Text></div></div>
            <div className="monitor-overview-metric monitor-overview-metric--plain"><div className="monitor-overview-metric__header"><Clock3 size={15} /><Text strong>延迟作业</Text></div><div className="monitor-overview-metric__value">{queueTotals.deferred}</div><div className="monitor-overview-metric__info"><Text type="tertiary" size="small">等待到期</Text></div></div>
            <div className="monitor-overview-metric monitor-overview-metric--plain"><div className="monitor-overview-metric__header"><AlertTriangle size={15} /><Text strong>失败作业</Text></div><div className={`monitor-overview-metric__value${queueTotals.failed > 0 ? ' monitor-overview-metric__value--warn' : ''}`}>{queueTotals.failed}</div><div className="monitor-overview-metric__info"><Text type="tertiary" size="small">队列保留失败</Text></div></div>
          </div>
        </section>

        <section className="observability-summary-section">
          <div className="observability-summary-section__header">
            <Text strong>观测源新鲜度</Text>
            <Text type="tertiary" size="small">缺失数据会明确标注</Text>
          </div>
          <div className="monitor-overview-grid observability-stat-grid">
            <div className="monitor-overview-metric monitor-overview-metric--plain"><div className="monitor-overview-metric__header"><CheckCircle2 size={15} /><Text strong>正常来源</Text></div><div className="monitor-overview-metric__value">{sourceCounts.ok}</div><div className="monitor-overview-metric__info"><Text type="tertiary" size="small">{summary.sources.length} 个来源</Text></div></div>
            <div className="monitor-overview-metric monitor-overview-metric--plain"><div className="monitor-overview-metric__header"><AlertTriangle size={15} /><Text strong>降级来源</Text></div><div className="monitor-overview-metric__value">{sourceCounts.degraded}</div><div className="monitor-overview-metric__info"><Text type="tertiary" size="small">需要关注</Text></div></div>
            <div className="monitor-overview-metric monitor-overview-metric--plain"><div className="monitor-overview-metric__header"><Database size={15} /><Text strong>不可用来源</Text></div><div className="monitor-overview-metric__value">{sourceCounts.unavailable}</div><div className="monitor-overview-metric__info"><Text type="tertiary" size="small">不以 0 代替</Text></div></div>
            <div className="monitor-overview-metric monitor-overview-metric--plain"><div className="monitor-overview-metric__header"><Clock3 size={15} /><Text strong>最大延迟</Text></div><div className="monitor-overview-metric__value">{freshness == null ? '—' : `${Math.round(freshness)}s`}</div><div className="monitor-overview-metric__info"><Text type="tertiary" size="small">最近采集</Text></div></div>
          </div>
        </section>
      </div>
    </section>
  );
}
