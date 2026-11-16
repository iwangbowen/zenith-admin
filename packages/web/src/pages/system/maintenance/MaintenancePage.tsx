import { useState } from 'react';
import { Banner, Button, SideSheet, Space, Spin, TabPane, Tabs } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { maintenanceContract, MAINTENANCE_LOG_STATUS_OPTIONS, type MaintenanceLog } from '@zenith/shared/ops';
import { useMaintenanceAccess, useMaintenanceStatus, useMaintenanceLogs } from '@/hooks/queries/maintenance';
import MaintenanceEditor from './MaintenanceEditor';
import MaintenanceDetail from './MaintenanceDetail';
import { ListSearchToolbar } from '@/components/list-page';
import ConfigurableTable from '@/components/ConfigurableTable';
import { useListPage } from '@/hooks/useListPage';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import './maintenance.css';

function MaintenanceHistory() {
  const page = useListPage({ op: maintenanceContract.logs, useList: useMaintenanceLogs });
  const [detail, setDetail] = useState<MaintenanceLog | null>(null);
  const columns: ColumnProps<MaintenanceLog>[] = [
    dateTimeColumn('计划开始','scheduledStartAt'), dateTimeColumn('实际开始','startedAt'), dateTimeColumn('结束时间','endedAt'),
    { title: '维护提示', dataIndex: 'message', render: renderEllipsis },
    { title: '状态', dataIndex: 'status', width: 110, render: (value) => MAINTENANCE_LOG_STATUS_OPTIONS.find((item) => item.value === value)?.label },
    { title: '开启人', dataIndex: 'startedByName', width: 120 },
    createOperationColumn({ width: 80, actions: (row) => [{ key: 'detail', label: '详情', onClick: () => setDetail(row) }] }),
  ];
  return <><ListSearchToolbar page={page} filters={['keyword','status',['startTime','endTime']]} /><ConfigurableTable columns={columns} {...page.tableProps} />
    <SideSheet title="维护详情" visible={!!detail} onCancel={() => setDetail(null)} width={720} closeOnEsc>
      {detail ? <MaintenanceDetail key={detail.id} detail={detail} /> : null}
    </SideSheet></>;
}
export default function MaintenancePage() {
  const access = useMaintenanceAccess();
  const status = useMaintenanceStatus(!!access.data?.canView);
  const [tab, setTab] = useUrlTabState(['config','logs'] as const,'config');
  if (access.isLoading || (access.data?.canView && status.isLoading)) return <Spin size="large" />;
  if (!access.data?.canView && access.data?.canViewLogs) return <div className="page-container"><MaintenanceHistory /></div>;
  if (!access.data?.canView && !access.isError) return <Banner type="warning" description="没有维护查看权限" />;
  if (!status.data) return <Banner type="danger" description={<Space>无法读取维护状态，不能将未知状态视为正常运行<Button onClick={() => void status.refetch()}>重试</Button></Space>} />;
  return <div className="page-container page-tabs-page"><Tabs collapsible="auto" activeKey={tab} onChange={(value) => setTab(value as typeof tab)} type="line">
    <TabPane itemKey="config" tab="维护控制">{status.isError ? <Banner type="warning" closeIcon={null} description="刷新失败，当前显示上次成功读取的状态；草稿已保留，请重试刷新。" /> : null}<MaintenanceEditor status={status.data} reload={() => status.refetch()} refreshing={status.isFetching} /></TabPane>
    {access.data?.canViewLogs ? <TabPane itemKey="logs" tab="维护记录"><MaintenanceHistory /></TabPane> : null}
  </Tabs></div>;
}
