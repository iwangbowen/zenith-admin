import { Banner, Button, Card, Space, Typography } from '@douyinfe/semi-ui';
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
    <Card title={<Space wrap style={{ width: '100%', justifyContent: 'space-between' }}><span>队列积压</span><Typography.Text type="tertiary" size="small">积压最多的前 20 个队列</Typography.Text></Space>}>
      {!queues.available ? <Banner type="warning" closeIcon={null} description={`队列探测不可用：${queues.reason ?? '未知原因'}`} /> : (
        <ConfigurableTable<JobQueueRow>
          rowKey="name"
          pagination={false}
          dataSource={rows}
          onRefresh={onRefresh}
          refreshLoading={refreshing}
          empty="暂无调度队列"
          columns={[
            { title: '队列', dataIndex: 'title', minWidth: 240, render: (_: unknown, row: JobQueueRow) => (
              <Button theme="borderless" onClick={() => navigate(`/system/scheduler?tab=tasks&keyword=${encodeURIComponent(row.name)}`)}>{row.title || row.name}</Button>
            ) },
            { title: '模块', dataIndex: 'module', width: 120 },
            { title: '排队', dataIndex: 'queued', width: 90 },
            { title: '执行中', dataIndex: 'active', width: 90 },
            { title: '延后', dataIndex: 'deferred', width: 90 },
            { title: '失败', dataIndex: 'failed', width: 90 },
          ]}
        />
      )}
    </Card>
  );
}
