import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Input,
  Modal,
  RadioGroup,
  Radio,
  Space,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { Search, RotateCcw } from 'lucide-react';
import type { OnlineUser, PaginatedResponse } from '@zenith/shared';
import { TOKEN_KEY } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import { renderEllipsis } from '../../../utils/table-columns';

export default function OnlineSessionsPage() {
  const { hasPermission } = usePermission();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OnlineUser[]>([]);
  const [total, setTotal] = useState(0);
  interface SearchParams { keyword: string; }
  const defaultSearchParams: SearchParams = { keyword: '' };
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  // 从本地 JWT 解码当前会话 tokenId（jti），无需额外请求
  const currentTokenId = useMemo<string | null>(() => {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1]));
      return typeof payload.jti === 'string' ? payload.jti : null;
    } catch {
      return null;
    }
  }, []);

  const fetchData = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const { keyword: activeKw } = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (activeKw) query.set('keyword', activeKw);
      const res = await request.get<PaginatedResponse<OnlineUser>>(`/api/sessions?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleForceLogout = (record: OnlineUser) => {
    // 模式引用，Modal.confirm 内部无法直接读 state，改用 ref
    let logoutMode: 'single' | 'all' = 'single';

    Modal.confirm({
      title: '强制下线',
      content: (
        <Space vertical align="start" style={{ width: '100%' }}>
          <Typography.Text>用户：{record.username}（{record.nickname}）</Typography.Text>
          <RadioGroup
            defaultValue="single"
            onChange={(e) => { logoutMode = e.target.value as 'single' | 'all'; }}
          >
            <Radio value="single">仅下线此会话</Radio>
            <Radio value="all">下线该用户全部会话</Radio>
          </RadioGroup>
        </Space>
      ),
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = logoutMode === 'all'
          ? await request.delete(`/api/sessions/user/${record.userId}`)
          : await request.delete(`/api/sessions/${record.tokenId}`);
        if (res.code === 0) {
          Toast.success(logoutMode === 'all' ? '已强制下线全部会话' : '已强制下线');
          void fetchData(page, pageSize, keyword);
        }
      },
    });
  };

  const columns: ColumnProps<OnlineUser>[] = [
    {
      title: '用户名',
      dataIndex: 'username',
      width: 180,
      render: (v: string, record: OnlineUser) => (
        <Space>
          <span>{v}</span>
          {record.tokenId === currentTokenId && (
            <Tag color="blue" size="small">当前会话</Tag>
          )}
        </Space>
      ),
    },
    { title: '昵称', dataIndex: 'nickname', width: 140 },
    { title: 'IP', dataIndex: 'ip', width: 150 },
    { title: '浏览器', dataIndex: 'browser', width: 160, render: renderEllipsis },
    { title: '操作系统', dataIndex: 'os', width: 160, render: renderEllipsis },
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
              onClick={() => handleForceLogout(record)}
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
            value={searchParams.keyword}
            onChange={(v) => setSearchParams({ keyword: v })}
            onEnterPress={() => { setPage(1); void fetchData(1, pageSize); }}
            style={{ width: 240 }}
            showClear
          />
          <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); void fetchData(1, pageSize); }}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setSearchParams(defaultSearchParams); setPage(1); void fetchData(1, pageSize, defaultSearchParams); }}>重置</Button>
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={loading}
        onRefresh={fetchData}
        refreshLoading={loading}
        rowKey="tokenId"
        pagination={buildPagination(total, fetchData)}
        empty="暂无在线用户"
      />
    </div>
  );
}
