import { config } from '@/config';
import { useIsPlatformAdmin } from '@/hooks/useIsPlatformAdmin';
import ForbiddenPage from '@/pages/forbidden/ForbiddenPage';
import IpAccessConfig from './IpAccessConfig';
import { useState } from 'react';
import { Banner, Descriptions, SideSheet, Tabs, TabPane, Tag, Typography } from '@douyinfe/semi-ui';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { ListSearchToolbar } from '@/components/list-page';
import { FilterSelect } from '@/components/search-filters';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { type IpAccessLog, ipAccessLogContract, IP_ACCESS_BLOCK_TYPE_OPTIONS } from '@zenith/shared/platform';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePermission } from '@/hooks/usePermission';
import { dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import { useIpAccessLogs, useIpAccessLogHealth } from '@/hooks/queries/ip-access';

import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useListPage } from '@/hooks/useListPage';

// ─── 拦截日志子页面 ─────────────────────────────────────────────

function IpAccessLogsTab() {
  const [detail, setDetail] = useState<IpAccessLog | null>(null);
  const health = useIpAccessLogHealth();
  const page = useListPage({
    contract: ipAccessLogContract,
    useList: useIpAccessLogs,
  });
  const { tableProps } = page;

  const columns: ColumnProps<IpAccessLog>[] = [
    { title: 'IP 地址', dataIndex: 'ip', width: 210 },
    {
      title: '拦截类型', dataIndex: 'blockType', width: 120,
      render: (v: string) => (
        <Tag color={v === 'blacklist' ? 'red' : 'blue'} size="small">
          {IP_ACCESS_BLOCK_TYPE_OPTIONS.find((option) => option.value === v)?.label ?? v}
        </Tag>
      ),
    },
    { title: '请求路径', dataIndex: 'path', render: renderEllipsis },
    { title: '请求方法', dataIndex: 'method', width: 100 },
    { title: '命中地址', dataIndex: 'matchedEntry', width: 180, render: renderEllipsis },
    { title: '策略版本', dataIndex: 'policyVersion', width: 100 },
    dateTimeColumn('拦截时间', 'createdAt'),
    createOperationColumn<IpAccessLog>({ width: 80, actions: (row) => [{ key: 'detail', label: '详情', onClick: () => setDetail(row) }] }),
  ];

  return (
    <>
      {health.data?.dropped ? <Banner type="warning" closeIcon={null} description={'当前 API 实例已丢弃 ' + health.data.dropped + ' 条日志，写入失败批次 ' + health.data.flushFailures + '；日志并非完整流量统计。'} /> : null}
      <ListSearchToolbar
        page={page}
        filters={['ip', 'blockType', ['startTime', 'endTime']]}
        overrides={{
          blockType: ({ bind }) => <FilterSelect placeholder="全部拦截类型" items={IP_ACCESS_BLOCK_TYPE_OPTIONS}
            width={200} dropdownMatchSelectWidth={false} dropdownStyle={{ minWidth: 220 }} {...bind('blockType')} />,
        }}
        filterTitle="IP 访问筛选"
        extraFilters={health.data ? <Typography.Text type="tertiary" size="small">当前实例待写 {health.data.pending} · 丢弃 {health.data.dropped}</Typography.Text> : null}
      />
      <ConfigurableTable<IpAccessLog>
        columns={columns}
        {...tableProps}
      />
      <SideSheet title="拦截详情" visible={!!detail} onCancel={() => setDetail(null)} width={600}>
        {detail ? <Descriptions align="left" data={[
          { key: '来源 IP', value: detail.ip }, { key: '请求路径', value: detail.path }, { key: 'HTTP 方法', value: detail.method },
          { key: '拦截原因', value: IP_ACCESS_BLOCK_TYPE_OPTIONS.find((option) => option.value === detail.blockType)?.label },
          { key: '命中地址', value: detail.matchedEntry ?? '未命中白名单或来源无效' }, { key: '策略版本', value: detail.policyVersion ?? '—' },
          { key: '请求 ID', value: <Typography.Text copyable>{detail.correlationId ?? '—'}</Typography.Text> },
          { key: 'User-Agent', value: detail.userAgent ?? '—' }, { key: '拦截时间', value: detail.createdAt },
        ]} /> : null}
      </SideSheet>
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
