import { Button, Collapse, SideSheet, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { JOB_HEALTH_LABELS, JOB_SOURCE_CATEGORIES, JOB_SOURCE_CATEGORY_LABELS, type JobSourceCategory, type JobSourceSummary } from '@zenith/shared/platform';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { formatAge, JOB_HEALTH_COLORS } from './job-monitor-shared';

function SourceMetric({ label, value, tone }: Readonly<{ label: string; value: string | number; tone?: 'danger' | 'warning' }>) {
  return <span className="job-monitor-source-list__metric"><Typography.Text type="tertiary" size="small">{label}</Typography.Text><Typography.Text strong type={tone}>{value}</Typography.Text></span>;
}

function SourceDetails({ source, visible, onClose }: Readonly<{ source: JobSourceSummary; visible: boolean; onClose: () => void }>) {
  const navigate = useNavigate();
  return (
    <SideSheet title={`${source.title} · 来源明细`} visible={visible} onCancel={onClose} width={720}>
      <div className="job-monitor-source-list__drawer">
        <Space wrap>
          <Tag color={JOB_HEALTH_COLORS[source.health]}>{JOB_HEALTH_LABELS[source.health]}</Tag>
          <Typography.Text type="tertiary">{source.module}</Typography.Text>
          <Typography.Text type="tertiary">积压最久 {formatAge(source.oldestPendingAgeSec)}</Typography.Text>
          <Typography.Text type="tertiary">失败率 {source.failureRate24h == null ? EMPTY_PLACEHOLDER : `${(source.failureRate24h * 100).toFixed(1)}%`}</Typography.Text>
        </Space>
        {source.reason && <Typography.Text type="warning">{source.reason}</Typography.Text>}
        {source.issues.map((issue, index) => <Typography.Text key={`${issue.level}-${index}`} type={issue.level === 'critical' ? 'danger' : 'warning'}>{issue.message}</Typography.Text>)}
        {source.breakdown && source.breakdown.length > 0 && (
          <div className="job-monitor-source-list__breakdown">
            <Typography.Text strong>明细</Typography.Text>
            {source.breakdown.map((item) => (
              <div className="job-monitor-source-list__breakdown-row" key={item.key}>
                <Typography.Text>{item.label}</Typography.Text>
                <Typography.Text type="tertiary">待处理 {item.pending} · 运行 {item.running} · 卡死 {item.stuck} · 24h 失败 {item.failed24h}</Typography.Text>
                {item.drillDown && <Button theme="borderless" size="small" onClick={() => navigate(item.drillDown!.path)}>查看</Button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </SideSheet>
  );
}

function SourceRow({ source, onStuck }: Readonly<{ source: JobSourceSummary; onStuck: (source: JobSourceSummary) => void }>) {
  const navigate = useNavigate();
  const [detailsVisible, setDetailsVisible] = useState(false);
  const executionIsElsewhere = source.category === 'business' || source.key === 'drive-rendition';
  return (
    <div className={`job-monitor-source-list__row job-monitor-source-list__row--${source.health}`}>
      <div className="job-monitor-source-list__identity">
        <span className={`job-monitor-health-dot job-monitor-health-dot--${source.health}`} />
        <Typography.Text strong>{source.title}</Typography.Text>
        <Typography.Text type="tertiary" size="small">{source.module}</Typography.Text>
        <Tag color={JOB_HEALTH_COLORS[source.health]} size="small">{JOB_HEALTH_LABELS[source.health]}</Tag>
      </div>
      <div className="job-monitor-source-list__metrics">
        <SourceMetric label="待处理" value={source.health === 'unavailable' || executionIsElsewhere ? EMPTY_PLACEHOLDER : source.counts.pending} />
        <SourceMetric label="运行中" value={source.health === 'unavailable' || executionIsElsewhere ? EMPTY_PLACEHOLDER : source.counts.running} />
        <SourceMetric label="卡死" value={source.health === 'unavailable' ? EMPTY_PLACEHOLDER : source.counts.stuck} tone={source.counts.stuck > 0 ? 'danger' : undefined} />
        <SourceMetric label="死信" value={source.health === 'unavailable' ? EMPTY_PLACEHOLDER : source.counts.dead ?? EMPTY_PLACEHOLDER} tone={(source.counts.dead ?? 0) > 0 ? 'warning' : undefined} />
        <SourceMetric label="24h 失败" value={source.health === 'unavailable' ? EMPTY_PLACEHOLDER : source.counts.failed24h} tone={source.counts.failed24h > 0 ? 'danger' : undefined} />
      </div>
      <div className="job-monitor-source-list__meta">
        <Typography.Text type="tertiary" size="small">积压最久 {formatAge(source.oldestPendingAgeSec)}</Typography.Text>
        <Typography.Text type="tertiary" size="small">失败率 {source.failureRate24h == null ? EMPTY_PLACEHOLDER : `${(source.failureRate24h * 100).toFixed(1)}%`}</Typography.Text>
      </div>
      <div className="job-monitor-source-list__actions">
        {source.breakdown && source.breakdown.length > 0 && <Button theme="borderless" size="small" onClick={() => setDetailsVisible(true)}>查看明细</Button>}
        {source.supportsStuckList && source.counts.stuck > 0 && <Button theme="borderless" type="danger" size="small" onClick={() => onStuck(source)}>卡死明细</Button>}
        {source.drillDown && <Button theme="borderless" size="small" onClick={() => navigate(source.drillDown!.path)}>{source.drillDown.label}</Button>}
      </div>
      <SourceDetails source={source} visible={detailsVisible} onClose={() => setDetailsVisible(false)} />
    </div>
  );
}

export default function JobSourceList({ sources, onStuck }: Readonly<{ sources: JobSourceSummary[]; onStuck: (source: JobSourceSummary) => void }>) {
  const order = new Map(JOB_SOURCE_CATEGORIES.map((key, index) => [key, index]));
  const sorted = [...sources].sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) || a.title.localeCompare(b.title));
  return (
    <Collapse className="job-monitor-source-list" defaultActiveKey={[...JOB_SOURCE_CATEGORIES]} keepDOM={false} expandIconPosition="left">
      {JOB_SOURCE_CATEGORIES.map((category: JobSourceCategory) => {
        const group = sorted.filter((source) => source.category === category);
        if (group.length === 0) return null;
        return (
          <Collapse.Panel key={category} itemKey={category} header={<div className="job-monitor-source-list__group-header"><Typography.Text strong>{JOB_SOURCE_CATEGORY_LABELS[category]}</Typography.Text><Typography.Text type="tertiary" size="small">{group.length} 个来源</Typography.Text></div>}>
            {group.map((source) => <SourceRow key={source.key} source={source} onStuck={onStuck} />)}
          </Collapse.Panel>
        );
      })}
    </Collapse>
  );
}
