import { Banner, Button, Card, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { JOB_HEALTH_LABELS, type JobSourceSummary } from '@zenith/shared/platform';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { formatAge, JOB_HEALTH_COLORS } from './job-monitor-shared';

export default function JobSourceCard({ source, onStuck }: Readonly<{ source: JobSourceSummary; onStuck: (source: JobSourceSummary) => void }>) {
  const navigate = useNavigate();
  const { counts } = source;
  const [expanded, setExpanded] = useState(false);
  const breakdown = source.breakdown ?? [];
  const executionIsElsewhere = source.category === 'business' || source.key === 'drive-rendition';
  return (
    <section aria-label={source.title} data-job-source={source.key} style={{ height: '100%' }}>
      <Card title={<Space wrap style={{ width: '100%', justifyContent: 'space-between' }}><span>{source.title}</span><Tag color={JOB_HEALTH_COLORS[source.health]}>{JOB_HEALTH_LABELS[source.health]}</Tag></Space>}>
        {source.health === 'unavailable' ? (
          <Banner type="warning" closeIcon={null} description={source.reason ?? '作业源探测不可用'} />
        ) : (
          <>
            <StatGrid minItemWidth={80} gap={8}>
              <StatCard title="待处理" value={executionIsElsewhere ? EMPTY_PLACEHOLDER : counts.pending} />
              <StatCard title="运行中" value={executionIsElsewhere ? EMPTY_PLACEHOLDER : counts.running} />
              <StatCard title="卡死" value={counts.stuck} accent={counts.stuck > 0 ? 'var(--semi-color-danger)' : undefined} />
              <StatCard title="死信" value={counts.dead ?? EMPTY_PLACEHOLDER} accent={(counts.dead ?? 0) > 0 ? 'var(--semi-color-warning)' : undefined} />
              <StatCard title="24h 失败" value={counts.failed24h} />
            </StatGrid>
            <Space vertical align="start" spacing={6} style={{ width: '100%', marginTop: 8 }}>
              {executionIsElsewhere && <Typography.Text type="tertiary" size="small">执行量由{source.key === 'drive-rendition' ? '系统队列' : '任务中心'}统计，本来源检查卡死与业务状态。</Typography.Text>}
              <Typography.Text type="tertiary" size="small">积压最久：{formatAge(source.oldestPendingAgeSec)}</Typography.Text>
              <Typography.Text type="tertiary" size="small">近 24h 失败率：{source.failureRate24h == null ? EMPTY_PLACEHOLDER : `${(source.failureRate24h * 100).toFixed(1)}%`}</Typography.Text>
              {source.issues.map((issue, index) => (
                <Typography.Text key={`${issue.level}-${index}`} type={issue.level === 'critical' ? 'danger' : 'warning'} size="small">{issue.message}</Typography.Text>
              ))}
            </Space>
            {breakdown.length > 0 && <Space vertical align="start" spacing={8} style={{ width: '100%', marginTop: 12 }}>
              {(expanded ? breakdown : breakdown.slice(0, 5)).map(item => <div key={item.key} style={{ width: '100%' }}>
                <Space wrap>
                  {item.drillDown ? <Button theme="borderless" size="small" onClick={() => navigate(item.drillDown!.path)}>{item.label}</Button> : <Typography.Text size="small">{item.label}</Typography.Text>}
                  <Typography.Text size="small" type={item.stuck > 0 ? 'danger' : 'tertiary'}>待处理 {item.pending} · 运行 {item.running} · 卡死 {item.stuck} · 24h 失败 {item.failed24h}</Typography.Text>
                </Space>
              </div>)}
              {breakdown.length > 5 && <Button theme="borderless" size="small" onClick={() => setExpanded(value => !value)}>{expanded ? '收起明细' : `展开全部 ${breakdown.length} 项`}</Button>}
            </Space>}
          </>
        )}
        {(source.drillDown || (source.supportsStuckList && counts.stuck > 0)) && (
          <Space wrap style={{ marginTop: 12 }}>
            {source.supportsStuckList && counts.stuck > 0 && <Button theme="borderless" onClick={() => onStuck(source)}>卡死明细</Button>}
            {source.drillDown && <Button theme="borderless" onClick={() => navigate(source.drillDown!.path)}>{source.drillDown.label}</Button>}
          </Space>
        )}
      </Card>
    </section>
  );
}
