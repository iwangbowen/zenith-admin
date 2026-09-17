import { useMemo } from 'react';
import { RadioGroup, Radio, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { sessionContract, type OnlineSession } from '@zenith/shared/identity';
import { TOKEN_KEY } from '@zenith/shared/core';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { usePermission } from '@/hooks/usePermission';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SessionClientTag } from '@/components/SessionClientTag';
import { dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import { useForceLogoutSession, useForceLogoutUserSessions, useSessionList } from '@/hooks/queries/sessions';
import { confirmDanger } from '@/utils/confirm';
import { useListPage } from '@/hooks/useListPage';

export default function OnlineSessionsPage() {
  const { hasPermission } = usePermission();
  const page = useListPage({
    contract: sessionContract,
    useList: useSessionList,
    table: { rowKey: 'tokenId', empty: '暂无在线用户' },
  });
  const { tableProps } = page;

  const forceLogoutMutation = useForceLogoutSession();
  const forceLogoutUserMutation = useForceLogoutUserSessions();

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

  const handleForceLogout = (record: OnlineSession) => {
    // 模式引用，Modal.confirm 内部无法直接读 state，改用 ref
    let logoutMode: 'single' | 'all' = 'single';

    confirmDanger({
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
      onOk: async () => {
        if (logoutMode === 'all') await forceLogoutUserMutation.mutateAsync({ params: { id: record.userId } });
        else await forceLogoutMutation.mutateAsync({ params: { tokenId: record.tokenId } });
        Toast.success(logoutMode === 'all' ? '已强制下线全部会话' : '已强制下线');
      },
    });
  };

  const columns: ColumnProps<OnlineSession>[] = [
    {
      title: '用户名',
      dataIndex: 'username',
      width: 180,
      render: (v: string, record: OnlineSession) => (
        <Space>
          <span>{v}</span>
          {record.tokenId === currentTokenId && (
            <Tag color="blue" size="small">当前会话</Tag>
          )}
          {record.impersonatorName && (
            <Tag color="orange" size="small">由 {record.impersonatorName} 模拟</Tag>
          )}
        </Space>
      ),
    },
    { title: '昵称', dataIndex: 'nickname', minWidth: 140 },
    { title: '终端', dataIndex: 'client', width: 110, render: (v: OnlineSession['client']) => <SessionClientTag client={v} /> },
    { title: 'IP 地址', dataIndex: 'ip', width: 140 },
    { title: '登录地点', dataIndex: 'location', width: 180, render: renderEllipsis },
    { title: '浏览器', dataIndex: 'browser', width: 160, render: renderEllipsis },
    { title: '操作系统', dataIndex: 'os', width: 160, render: renderEllipsis },
    dateTimeColumn('登录时间', 'loginAt'),
    dateTimeColumn('最近活跃', 'lastActiveAt'),
    createOperationColumn<OnlineSession>({
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
      <ListSearchToolbar
        page={page}
        filters={['keyword', 'client']}
        actionTitle="会话操作"
      />

      <ConfigurableTable<OnlineSession>
        columns={columns}
        {...tableProps}
      />
    </div>
  );
}
