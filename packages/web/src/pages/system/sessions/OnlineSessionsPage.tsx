import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import type { OnlineUser } from '@zenith/shared';
import { TOKEN_KEY } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { renderEllipsis } from '../../../utils/table-columns';
import { sessionKeys, useForceLogoutSession, useSessionList } from '@/hooks/queries/sessions';

export default function OnlineSessionsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  interface SearchParams { keyword: string; }
  const defaultSearchParams: SearchParams = { keyword: '' };
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const listQuery = useSessionList({ page, pageSize, keyword: submittedParams.keyword || undefined });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const forceLogoutMutation = useForceLogoutSession();

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

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: sessionKeys.lists });
  };

  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: sessionKeys.lists });
  };

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
        await forceLogoutMutation.mutateAsync({ mode: logoutMode, tokenId: record.tokenId, userId: record.userId });
        Toast.success(logoutMode === 'all' ? '已强制下线全部会话' : '已强制下线');
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
    { title: 'IP 地址', dataIndex: 'ip', width: 140 },
    {
      title: '登录地点', dataIndex: 'location', width: 180,
      render: (location: string | null) => location ?? '-',
    },
    { title: '浏览器', dataIndex: 'browser', width: 160, render: renderEllipsis },
    { title: '操作系统', dataIndex: 'os', width: 160, render: renderEllipsis },
    {
      title: '登录时间',
      dataIndex: 'loginAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    createOperationColumn<OnlineUser>({
      width: 120,
      actions: (record) => [
        {
          key: 'force-logout',
          label: '强制下线',
          danger: true,
          hidden: !hasPermission('system:session:forceLogout'),
          onClick: () => handleForceLogout(record),
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索用户名/昵称/IP"
              value={draftParams.keyword}
              onChange={(v) => setDraftParams({ keyword: v })}
              onEnterPress={handleSearch}
              style={{ width: 240 }}
              showClear
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索用户名/昵称/IP"
              value={draftParams.keyword}
              onChange={(v) => setDraftParams({ keyword: v })}
              onEnterPress={handleSearch}
              style={{ width: 240 }}
              showClear
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          </>
        )}
        mobileActions={(
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        )}
        actionTitle="会话操作"
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="tokenId"
        pagination={buildPagination(total)}
        empty="暂无在线用户"
      />
    </div>
  );
}
