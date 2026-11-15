import { config } from '@/config';
import { useIsPlatformAdmin } from '@/hooks/useIsPlatformAdmin';
import ForbiddenPage from '@/pages/forbidden/ForbiddenPage';
import IpAccessConfig from './IpAccessConfig';
import { Tabs, TabPane, Tag } from '@douyinfe/semi-ui';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { ListSearchToolbar } from '@/components/list-page';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { type IpAccessLog, ipAccessLogContract } from '@zenith/shared/platform';
import { usePermission } from '@/hooks/usePermission';
import { dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import { useIpAccessLogs } from '@/hooks/queries/ip-access';

import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useListPage } from '@/hooks/useListPage';

// ─── 拦截日志子页面 ─────────────────────────────────────────────

function IpAccessLogsTab() {
  const page = useListPage({
    contract: ipAccessLogContract,
    useList: useIpAccessLogs,
  });
  const { tableProps } = page;

  const columns: ColumnProps<IpAccessLog>[] = [
    { title: 'IP 地址', dataIndex: 'ip', width: 160 },
    {
      title: '拦截类型', dataIndex: 'blockType', width: 120,
      render: (v: string) => (
        <Tag color={v === 'blacklist' ? 'red' : 'blue'} size="small">
          {v === 'blacklist' ? '黑名单' : '白名单'}
        </Tag>
      ),
    },
    { title: '请求路径', dataIndex: 'path', render: renderEllipsis },
    { title: '请求方法', dataIndex: 'method', width: 100 },
    { title: 'User-Agent', dataIndex: 'userAgent', render: renderEllipsis },
    dateTimeColumn('拦截时间', 'createdAt'),
  ];

  return (
    <>
      <ListSearchToolbar
        page={page}
        filters={['ip', 'blockType', 'startTime', 'endTime']}
        filterTitle="IP 访问筛选"
      />
      <ConfigurableTable<IpAccessLog>
        columns={columns}
        {...tableProps}
      />
    </>
  );
}

// ─── 主页面 ────────────────────────────────────────────────────

function IpAccessEditor() {
  const [activeTab, setActiveTab] = useUrlTabState(['config', 'logs'] as const, 'config');
  const { hasPermission } = usePermission();
  const canViewLog = hasPermission('system:ip-access:log');
  return <div className="page-container page-tabs-page">
    {canViewLog ? <Tabs collapsible="auto" type="line" activeKey={activeTab} onChange={(key) => setActiveTab(key as typeof activeTab)}>
      <TabPane tab="访问控制配置" itemKey="config"><IpAccessConfig /></TabPane>
      <TabPane tab="拦截日志" itemKey="logs"><IpAccessLogsTab /></TabPane>
    </Tabs> : <IpAccessConfig />}
  </div>;
}

export default function IpAccessPage() {
  const platformAdmin = useIsPlatformAdmin();
  if (config.multiTenantMode && !platformAdmin) return <ForbiddenPage />;
  return <IpAccessEditor />;
}
