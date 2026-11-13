import { useState } from 'react';
import { Banner, Descriptions, SideSheet, TabPane, Table, Tabs, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useQueryClient } from '@tanstack/react-query';
import { accessGovernanceContract, accessSourceLabel, ACCESS_GRANT_STATUS_LABELS, ACCESS_PROVISION_STATUS_LABELS, ACCESS_REQUEST_STATUS_LABELS, ACCESS_RISK_LABELS, type AccessGrant, type AccessRequest } from '@zenith/shared/identity';
import ConfigurableTable from '@/components/ConfigurableTable';
import DateTimeText from '@/components/DateTimeText';
import { ListSearchToolbar } from '@/components/list-page';
import { DATA_SCOPE_OPTIONS } from '@/components/permissions/DataScopePanel';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { RefreshButton } from '@/components/toolbar-controls';
import WorkflowInstanceCell from '@/components/workflow/WorkflowInstanceCell';
import WorkflowInstanceDetailSheet from '@/components/workflow/WorkflowInstanceDetailSheet';
import { identityAccessGovernanceKeys, useMyAccessGrants, useMyAccessRequests } from '@/hooks/queries/identity-access-governance';
import { useListPage } from '@/hooks/useListPage';
import { useWebSocket } from '@/hooks/useWebSocket';
import { singleLineColumns, dateTimeColumn } from '@/utils/table-columns';

function MyRequests() {
  const page = useListPage({ op: accessGovernanceContract.myRequests, useList: useMyAccessRequests, table: { rowKey: 'id', empty: '暂无权限申请', loadingMode: 'initial' } });
  const [instanceId, setInstanceId] = useState<number | null>(null);
  const columns: ColumnProps<AccessRequest>[] = [
    { title: '申请原因', dataIndex: 'reason', minWidth: 240 },
    { title: '审批状态', dataIndex: 'status', width: 110, render: (value: AccessRequest['status']) => ACCESS_REQUEST_STATUS_LABELS[value] },
    { title: '授权发放', dataIndex: 'provisionStatus', width: 120, render: (value: AccessRequest['provisionStatus'], row) => <div>{ACCESS_PROVISION_STATUS_LABELS[value]}{row.failureReason && <Typography.Text type="danger" size="small" style={{ display: 'block' }}>{row.failureReason}</Typography.Text>}</div> },
    { title: '风险', dataIndex: 'riskLevel', width: 90, render: (value: AccessRequest['riskLevel']) => ACCESS_RISK_LABELS[value] },
    dateTimeColumn('生效时间', 'startsAt'), dateTimeColumn('失效时间', 'expiresAt', { empty: '永久有效' }),
    { title: '审批流程', minWidth: 130, render: (_, row) => row.workflowInstanceId ? <WorkflowInstanceCell instanceId={row.workflowInstanceId} onOpen={setInstanceId} /> : '—' },
  ];
  return <><ListSearchToolbar page={page} filters={['keyword', 'status', 'provisionStatus']} actions={<RefreshButton onClick={() => void page.listQuery.refetch()} loading={page.listQuery.isFetching} />} /><ConfigurableTable columns={singleLineColumns(columns)} {...page.tableProps} /><WorkflowInstanceDetailSheet instanceId={instanceId} visible={instanceId !== null} onClose={() => setInstanceId(null)} /></>;
}

function MyGrants() {
  const page = useListPage({ op: accessGovernanceContract.myGrants, useList: useMyAccessGrants, table: { rowKey: 'id', empty: '暂无审批授权' } });
  const [detailId, setDetailId] = useState<number | null>(null);
  const detail = page.listQuery.data?.list.find(grant => grant.id === detailId);
  const columns: ColumnProps<AccessGrant>[] = [
    { title: '授权', dataIndex: 'id', width: 90, render: (value: number) => `#${value}` },
    { title: '状态', dataIndex: 'status', width: 110, render: (value: AccessGrant['status']) => ACCESS_GRANT_STATUS_LABELS[value] },
    { title: '权限项', dataIndex: 'items', minWidth: 200, render: (items: AccessGrant['items']) => items.map(item => item.permissionLabel ?? item.permissionCode).join('、') },
    dateTimeColumn('生效时间', 'startsAt'), dateTimeColumn('失效时间', 'expiresAt', { empty: '永久有效' }),
    createOperationColumn<AccessGrant>({ width: 140, actions: row => [{ key: 'detail', label: '查看授权项', onClick: () => setDetailId(row.id) }] }),
  ];
  return <><ListSearchToolbar page={page} filters={['keyword', 'status']} actions={<RefreshButton onClick={() => void page.listQuery.refetch()} loading={page.listQuery.isFetching} />} /><ConfigurableTable columns={singleLineColumns(columns)} {...page.tableProps} />
    <SideSheet title="本人授权明细" visible={detailId !== null} onCancel={() => setDetailId(null)} width={760} closeOnEsc footer={null}>
      {detail && <><Descriptions column={2} align="plain" data={[{ key: '状态', value: ACCESS_GRANT_STATUS_LABELS[detail.status] }, { key: '失效时间', value: <DateTimeText value={detail.expiresAt} empty="永久有效" mode="absolute" /> }]} /><Table rowKey="id" pagination={false} size="small" dataSource={detail.items} columns={singleLineColumns([
        { title: '操作权限', render: (_, item: AccessGrant['items'][number]) => item.permissionLabel ?? item.permissionCode },
        { title: '数据范围', render: (_, item: AccessGrant['items'][number]) => DATA_SCOPE_OPTIONS.find(option => option.value === item.dataScope)?.label },
        { title: '来源', render: (_, item: AccessGrant['items'][number]) => accessSourceLabel(item.sourceRefs) },
        { title: '状态', render: (_, item: AccessGrant['items'][number]) => ACCESS_GRANT_STATUS_LABELS[item.status] },
        dateTimeColumn('失效时间', 'expiresAt', { empty: '永久有效' }),
      ])} /></>}
    </SideSheet>
  </>;
}

export default function MyAccessPage() {
  const [tab, setTab] = useState('requests');
  const queryClient = useQueryClient();
  useWebSocket(message => {
    if (message.type !== 'identity:permissions-changed') return;
    void queryClient.invalidateQueries({ queryKey: identityAccessGovernanceKeys.myRequests });
    void queryClient.invalidateQueries({ queryKey: identityAccessGovernanceKeys.myGrants });
  });
  return <div className="page-container page-tabs-page"><Typography.Title heading={5}>我的权限</Typography.Title><Banner type="info" closeIcon={null} description="查看本人申请、发放结果和逐项授权范围；新增申请请前往发起工作台的“权限申请”。永久授权仍可被撤销并参加周期复核。" style={{ marginBottom: 16 }} /><Tabs type="line" activeKey={tab} onChange={setTab} lazyRender keepDOM={false}><TabPane itemKey="requests" tab="我的权限申请"><MyRequests /></TabPane><TabPane itemKey="grants" tab="我的审批授权"><MyGrants /></TabPane></Tabs></div>;
}
