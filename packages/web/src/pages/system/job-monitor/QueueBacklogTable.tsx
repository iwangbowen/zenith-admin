import { Banner, Button, Card, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import type { JobMonitorOverview, JobQueueRow } from '@zenith/shared/platform';
import ConfigurableTable from '@/components/ConfigurableTable';

export default function QueueBacklogTable({ queues, refreshing, onRefresh }: Readonly<{
  queues: JobMonitorOverview['queues'];
  refreshing: boolean;
  onRefresh: () => void;
}>) {
  const navigate = useNavigate();
  const rows = [...(queues.data ?? [])].sort((a, b) => b.queued - a.queued).slice(0, 20);
  return (
    <Card title={<Typography.Text strong>队列积压</Typography.Text>} headerExtraContent={<Typography.Text type="tertiary" size="small">积压最多的前 20 个队列</Typography.Text>}>
      {!queues.available ? <Banner type="warning" closeIcon={null} description={`队列探测不可用：${queues.reason ?? '未知原因'}`} /> : (
        <ConfigurableTable<JobQueueRow>
          rowKey="name"
          pagination={false}
          dataSource={rows}
          onRefresh={onRefresh}
          refreshLoading={refreshing}
          empty="暂无调度队列"
          columns={[
            { title: '队列', dataIndex: 'title', minWidth: 240, ellipsis: { showTitle: true }, render: (_: unknown, row: JobQueueRow) => (
              <Button className="job-monitor-queue-link" theme="borderless" size="small" onClick={() => navigate(`/system/scheduler?tab=tasks&keyword=${encodeURIComponent(row.name)}`)}>{row.title || row.name}</Button>
            ) },
            { title: '模块', dataIndex: 'module', width: 120 },
            { title: '排队', dataIndex: 'queued', width: 90, align: 'right', render: (value: number) => <Typography.Text className="job-monitor-queue-number" strong={value > 0} type={value > 0 ? undefined : 'tertiary'}>{value}</Typography.Text> },
            { title: '执行中', dataIndex: 'active', width: 90, align: 'right', render: (value: number) => <Typography.Text className="job-monitor-queue-number" type={value > 0 ? undefined : 'tertiary'}>{value}</Typography.Text> },
            { title: '延后', dataIndex: 'deferred', width: 90, align: 'right', render: (value: number) => <Typography.Text className="job-monitor-queue-number" type={value > 0 ? undefined : 'tertiary'}>{value}</Typography.Text> },
            { title: '失败', dataIndex: 'failed', width: 90, align: 'right', render: (value: number) => <Typography.Text className="job-monitor-queue-number" strong={value > 0} type={value > 0 ? 'danger' : 'tertiary'}>{value}</Typography.Text> },
          ]}
        />
      )}
    </Card>
  );
}
