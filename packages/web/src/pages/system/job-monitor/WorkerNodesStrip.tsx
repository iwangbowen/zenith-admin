import { Banner, Button, Card, Col, Empty, Row, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import type { JobMonitorOverview } from '@zenith/shared/platform';
import DateTimeText from '@/components/DateTimeText';

export default function WorkerNodesStrip({ workers }: Readonly<{ workers: JobMonitorOverview['workers'] }>) {
  const navigate = useNavigate();
  const nodes = workers.data?.nodes ?? [];
  const visibleNodes = [...nodes].sort((a, b) => Number(a.stale) - Number(b.stale)
    || b.lastHeartbeatAt.localeCompare(a.lastHeartbeatAt)).slice(0, 6);
  return (
    <Card title={<Typography.Text strong>Worker 节点</Typography.Text>} headerExtraContent={<Button theme="light" type="tertiary" onClick={() => navigate('/system/scheduler?tab=nodes')}>查看全部</Button>}>
      {!workers.available ? (
        <Banner type="warning" closeIcon={null} description={`节点探测不可用：${workers.reason ?? '未知原因'}`} />
      ) : nodes.length === 0 ? (
        <Empty description="暂无 Worker 节点" />
      ) : (
        <Row gutter={[16, 16]}>
          {visibleNodes.map((node) => (
            <Col key={node.nodeId} xs={24} md={12} xl={8}>
              <Space vertical align="start" spacing={6} style={{ width: '100%', minWidth: 0 }}>
                <Space wrap>
                  <Typography.Text strong>{node.hostname} / {node.pid}</Typography.Text>
                  <Tag color={node.stale ? 'red' : 'green'}>{node.stale ? '心跳失联' : '在线'}</Tag>
                </Space>
                <Typography.Text type="tertiary" size="small">角色：{node.roles.join(' / ')} · 运行中 {node.runningJobCount}</Typography.Text>
                <Typography.Text type="tertiary" size="small">最近心跳：<DateTimeText value={node.lastHeartbeatAt} /></Typography.Text>
              </Space>
            </Col>
          ))}
        </Row>
      )}
      {nodes.length > visibleNodes.length && <Typography.Text type="tertiary" size="small">显示最近 {visibleNodes.length} 个节点，共 {nodes.length} 个；完整状态可在系统调度查看。</Typography.Text>}
    </Card>
  );
}
