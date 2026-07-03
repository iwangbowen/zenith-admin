import { useState } from 'react';
import { Table, Tag, Typography } from '@douyinfe/semi-ui';
import { Clock } from 'lucide-react';
import { MemberPage } from '../../components/MemberPage';
import { useMemberLoginLogs } from '../../hooks/queries';

const { Text } = Typography;

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  success: { color: 'green', label: '成功' },
  fail: { color: 'red', label: '失败' },
};

export default function LoginHistoryPage() {
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const logsQuery = useMemberLoginLogs({ page, pageSize });
  const data = logsQuery.data?.list ?? [];
  const total = logsQuery.data?.total ?? 0;

  const columns = [
    {
      title: '登录时间',
      dataIndex: 'createdAt',
      width: 200,
      render: (v: string) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Clock size={13} color="var(--m-text-secondary)" />
          {v}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (v: string) => {
        const cfg = STATUS_TAG[v] ?? { color: 'grey', label: v };
        return <Tag color={cfg.color as 'green' | 'red'}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 140,
      render: (v: string | null) => <Text type="tertiary">{v ?? '—'}</Text>,
    },
    {
      title: '归属地',
      dataIndex: 'location',
      width: 140,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: '浏览器',
      dataIndex: 'browser',
      render: (v: string | null) => v ?? '—',
    },
    {
      title: '操作系统',
      dataIndex: 'os',
      render: (v: string | null) => v ?? '—',
    },
    {
      title: '备注',
      dataIndex: 'message',
      render: (v: string | null) => <Text type="tertiary">{v ?? '—'}</Text>,
    },
  ];

  return (
    <MemberPage title="登录历史" showBack noTabbar>
      <Table
        columns={columns}
        dataSource={data}
        loading={logsQuery.isFetching}
        rowKey="id"
        size="small"
        bordered
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onChange: (p) => setPage(p),
          showTotal: true,
        }}
        style={{ background: '#fff', borderRadius: 8 }}
        empty={
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--m-text-secondary)' }}>
            暂无登录记录
          </div>
        }
      />
    </MemberPage>
  );
}
