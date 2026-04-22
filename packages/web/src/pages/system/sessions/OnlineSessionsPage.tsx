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
import type { OnlineUser, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';

export default function OnlineSessionsPage() {
  const { hasPermission } = usePermission();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OnlineUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');

  const fetchData = useCallback(async (p = page, ps = pageSize, kw = keyword) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (kw) query.set('keyword', kw);
      const res = await request.get<PaginatedResponse<OnlineUser>>(`/api/sessions?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleForceLogout = (tokenId: string, username: string) => {
    Modal.confirm({
      title: '确定要强制下线吗？',
      content: `用户：${username}`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete(`/api/sessions/${tokenId}`);
        if (res.code === 0) {
          Toast.success('已强制下线');
          void fetchData(page, pageSize, keyword);
        }
      },
    });
  };

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
      <SearchToolbar>
          <Input
            prefix={<Search size={14} />}
            placeholder="搜索用户名/昵称/IP"
            value={keyword}
            onChange={(v) => setKeyword(v)}
            onEnterPress={() => { setPage(1); void fetchData(1, pageSize, keyword); }}
            style={{ width: 240 }}
            showClear
          />
          <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); void fetchData(1, pageSize, keyword); }}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setKeyword(''); setPage(1); void fetchData(1, pageSize, ''); }}>重置</Button>
      </SearchToolbar>

      <Table
        bordered
        className="admin-table-nowrap"
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="tokenId"
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: (p) => { setPage(p); void fetchData(p, pageSize, keyword); },
          onPageSizeChange: (size) => { setPageSize(size); void fetchData(1, size, keyword); },
          showSizeChanger: true,
        }}
        empty="暂无在线用户"
      />
    </div>
  );
}
