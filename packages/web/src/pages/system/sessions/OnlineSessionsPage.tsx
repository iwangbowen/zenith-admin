import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Input,
  Modal,
  Space,
  Table,
  Toast,
} from '@douyinfe/semi-ui';
import { Search, RotateCcw } from 'lucide-react';
import type { OnlineUser } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';

export default function OnlineSessionsPage() {
  const { hasPermission } = usePermission();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OnlineUser[]>([]);
  const [keyword, setKeyword] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<{ list: OnlineUser[]; total: number }>('/api/sessions');
      if (res.code === 0) {
        setData(res.data.list);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, []);

  const handleForceLogout = (tokenId: string, username: string) => {
    Modal.confirm({
      title: '确定要强制下线吗？',
      content: `用户：${username}`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete(`/api/sessions/${tokenId}`);
        if (res.code === 0) {
          Toast.success('已强制下线');
          void fetchData();
        }
      },
    });
  };

  const filtered = keyword
    ? data.filter(
        (u) =>
          u.username.includes(keyword) ||
          u.nickname.includes(keyword) ||
          u.ip.includes(keyword)
      )
    : data;

  const columns: ColumnProps<OnlineUser>[] = [
    { title: '用户名', dataIndex: 'username', width: 140 },
    { title: '昵称', dataIndex: 'nickname', width: 140 },
    { title: 'IP', dataIndex: 'ip', width: 150 },
    { title: '浏览器', dataIndex: 'browser', width: 160, ellipsis: true },
    { title: '操作系统', dataIndex: 'os', width: 160, ellipsis: true },
    {
      title: '登录时间',
      dataIndex: 'loginAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 120,
      render: (_: unknown, record: OnlineUser) => (
        <Space>
          {hasPermission('system:session:forceLogout') && (
            <Button
              theme="borderless"
              type="danger"
              size="small"
              onClick={() => handleForceLogout(record.tokenId, record.username)}
            >
              强制下线
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="search-area">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Space wrap>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索用户名/昵称/IP"
              value={keyword}
              onChange={setKeyword}
              style={{ width: 240 }}
              showClear
            />
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { void fetchData(); }}>刷新</Button>
          </Space>
        </div>
      </div>

      <Table
        bordered
        className="admin-table-nowrap"
        columns={columns}
        dataSource={filtered}
        loading={loading}
        rowKey="tokenId"
        pagination={false}
        empty="暂无在线用户"
      />
    </div>
  );
}
