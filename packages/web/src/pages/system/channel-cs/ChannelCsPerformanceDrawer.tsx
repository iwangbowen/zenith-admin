/**
 * 客服绩效统计抽屉
 *
 * 打开时拉取 GET /api/channels/cs/performance，展示每位客服的回复数、解决数、
 * 平均响应时长与平均评分。
 */
import { useEffect, useState } from 'react';
import { Empty, SideSheet, Spin, Table } from '@douyinfe/semi-ui';
import { Star } from 'lucide-react';
import type { ChannelCsPerformance } from '@zenith/shared';
import { request } from '@/utils/request';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function ChannelCsPerformanceDrawer({ visible, onClose }: Readonly<Props>) {
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<ChannelCsPerformance[]>([]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setList([]);
    void (async () => {
      const res = await request.get<ChannelCsPerformance[]>('/api/channels/cs/performance', { silent: true });
      if (cancelled) return;
      setLoading(false);
      if (res.code === 0 && res.data) setList(res.data);
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const columns = [
    { title: '客服', dataIndex: 'agentName', key: 'agentName' },
    { title: '回复消息数', dataIndex: 'replyCount', key: 'replyCount', width: 110 },
    { title: '解决会话数', dataIndex: 'resolvedCount', key: 'resolvedCount', width: 110 },
    {
      title: '平均响应(分钟)',
      dataIndex: 'avgResponseMinutes',
      key: 'avgResponseMinutes',
      width: 130,
      render: (value: number | null) => (value == null ? '-' : value),
    },
    {
      title: '平均评分',
      dataIndex: 'avgRating',
      key: 'avgRating',
      width: 110,
      render: (value: number | null) =>
        value == null ? (
          '-'
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Star size={13} style={{ color: '#fa8c16', fill: '#fa8c16' }} />
            {value.toFixed(1)}
          </span>
        ),
    },
  ];

  return (
    <SideSheet title="客服绩效统计" visible={visible} onCancel={onClose} width={640}>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : list.length === 0 ? (
        <Empty description="暂无绩效数据" style={{ padding: 60 }} />
      ) : (
        <Table
          rowKey="agentId"
          columns={columns}
          dataSource={list}
          pagination={false}
          bordered
        />
      )}
    </SideSheet>
  );
}

export default ChannelCsPerformanceDrawer;
