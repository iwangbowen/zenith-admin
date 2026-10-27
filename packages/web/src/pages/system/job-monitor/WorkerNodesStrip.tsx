import { Button, Empty, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import type { JobMonitorOverview } from '@zenith/shared/platform';
import DateTimeText from '@/components/DateTimeText';

export default function WorkerNodesStrip({ workers }: Readonly<{ workers: JobMonitorOverview['workers'] }>) {
  const navigate = useNavigate();
  const nodes = workers.data?.nodes ?? [];
  const visibleNodes = [...nodes].sort((a, b) => Number(a.stale) - Number(b.stale)
    || b.lastHeartbeatAt.localeCompare(a.lastHeartbeatAt)).slice(0, 6);
  return (
    <section className="job-monitor-section job-monitor-workers" aria-label="Worker 节点">
      <div className="job-monitor-section__header">
        <Typography.Text strong>Worker 节点</Typography.Text>
        <Button theme="borderless" size="small" onClick={() => navigate('/system/scheduler?tab=nodes')}>查看全部</Button>
      </div>
      {!workers.available ? (
        <Typography.Text type="warning" size="small">节点探测不可用：{workers.reason ?? '未知原因'}</Typography.Text>
      ) : nodes.length === 0 ? (
        <Empty description="暂无 Worker 节点" />
      ) : (
        <div className="job-monitor-workers__grid">
          {visibleNodes.map((node) => (
            <div className="job-monitor-worker" key={node.nodeId}>
              <Space wrap>
                <Typography.Text strong>{node.hostname} / {node.pid}</Typography.Text>
                <Tag color={node.stale ? 'red' : 'green'} size="small">{node.stale ? '心跳失联' : '在线'}</Tag>
              </Space>
              <Typography.Text type="tertiary" size="small">角色：{node.roles.join(' / ')} · 运行中 {node.runningJobCount}</Typography.Text>
              <Typography.Text type="tertiary" size="small">最近心跳：<DateTimeText value={node.lastHeartbeatAt} /></Typography.Text>
            </div>
          ))}
        </div>
      )}
      {nodes.length > visibleNodes.length && <Typography.Text type="tertiary" size="small">显示最近 {visibleNodes.length} 个节点，共 {nodes.length} 个</Typography.Text>}
    </section>
  );
}
