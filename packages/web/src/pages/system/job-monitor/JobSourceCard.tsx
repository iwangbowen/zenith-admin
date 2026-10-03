import { Banner, Button, Card, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { JOB_HEALTH_LABELS, type JobSourceSummary } from '@zenith/shared/platform';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { formatAge, JOB_HEALTH_COLORS } from './job-monitor-shared';

export default function JobSourceCard({ source, onStuck }: Readonly<{ source: JobSourceSummary; onStuck: (source: JobSourceSummary) => void }>) {
  const navigate = useNavigate();
  const { counts } = source;
  return (
    <section aria-label={source.title} data-job-source={source.key} style={{ height: '100%' }}>
      <Card title={<Space wrap style={{ width: '100%', justifyContent: 'space-between' }}><span>{source.title}</span><Tag color={JOB_HEALTH_COLORS[source.health]}>{JOB_HEALTH_LABELS[source.health]}</Tag></Space>}>
        {source.health === 'unavailable' ? (
          <Banner type="warning" closeIcon={null} description={source.reason ?? '作业源探测不可用'} />
        ) : (
          <>
            <StatGrid minItemWidth={80} gap={8}>
              <StatCard title="待处理" value={counts.pending} />
              <StatCard title="运行中" value={counts.running} />
              <StatCard title="卡死" value={counts.stuck} accent={counts.stuck > 0 ? 'var(--semi-color-danger)' : undefined} />
              <StatCard title="死信" value={counts.dead ?? EMPTY_PLACEHOLDER} accent={(counts.dead ?? 0) > 0 ? 'var(--semi-color-warning)' : undefined} />
              <StatCard title="24h 失败" value={counts.failed24h} />
            </StatGrid>
            <Space vertical align="start" spacing={6} style={{ width: '100%', marginTop: 8 }}>
              <Typography.Text type="tertiary" size="small">积压最久：{formatAge(source.oldestPendingAgeSec)}</Typography.Text>
              <Typography.Text type="tertiary" size="small">近 24h 失败率：{source.failureRate24h == null ? EMPTY_PLACEHOLDER : `${(source.failureRate24h * 100).toFixed(1)}%`}</Typography.Text>
              {source.issues.map((issue, index) => (
                <Typography.Text key={`${issue.level}-${index}`} type={issue.level === 'critical' ? 'danger' : 'warning'} size="small">{issue.message}</Typography.Text>
              ))}
            </Space>
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
