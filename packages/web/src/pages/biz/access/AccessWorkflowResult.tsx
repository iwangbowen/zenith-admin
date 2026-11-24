import { Banner, Descriptions, Space, Spin, Table, Tag, Typography } from '@douyinfe/semi-ui';
import { ACCESS_GRANT_STATUS_LABELS, ACCESS_PROVISION_STATUS_LABELS, accessSourceLabel, type AccessGrantItem } from '@zenith/shared/identity';
import DateTimeText from '@/components/DateTimeText';
import { DATA_SCOPE_OPTIONS } from '@/components/permissions/DataScopePanel';
import { useAccessWorkflowResult } from '@/hooks/queries/identity-access-governance';
import { dateTimeColumn } from '@/utils/table-columns';
import type { ApiClient } from '@/lib/contract-query';

export default function AccessWorkflowResult({ instanceId, requestClient }: { readonly instanceId: number; readonly requestClient?: ApiClient }) {
  const result = useAccessWorkflowResult(instanceId, requestClient);
  if (result.isPending) return <Spin tip="读取授权结果" />;
  if (!result.data) return <Banner type="warning" closeIcon={null} description="暂时无法读取授权结果，请刷新重试。" />;
  const { request, grant } = result.data;
  return <section style={{ marginTop: 24 }} aria-label="当前授权结果">
    <Space wrap spacing={12}><Typography.Text strong>当前授权结果</Typography.Text><Tag>{ACCESS_PROVISION_STATUS_LABELS[request.provisionStatus]}</Tag></Space>
    <Typography.Paragraph type="tertiary" size="small" style={{ marginTop: 8 }}>此处为实时授权账本；申请内容与审批记录保留提交时的快照。</Typography.Paragraph>
    {request.failureReason ? <Banner type="warning" closeIcon={null} description={request.failureReason} /> : null}
    <Descriptions align="left" column={1} data={[
      { key: '实际发放', value: <DateTimeText value={request.appliedAt} empty="尚未发放" mode="absolute" /> },
      { key: '授权情况', value: grant ? '以每项权限的当前状态及有效期为准' : request.status === 'approved' ? '审批已通过，权限在发放成功后可用' : '尚未产生授权' },
    ]} />
    {grant && grant.menus.length > 0 ? <Table rowKey="menuId" dataSource={grant.menus} pagination={false} size="small" columns={[
      { title: '页面访问', dataIndex: 'title', width: 240 },
      { title: '路径', dataIndex: 'path', render: path => path ?? '—' },
    ]} /> : null}
    {grant ? <Table rowKey="id" dataSource={grant.items} pagination={false} size="small" scroll={{ x: 1000 }} columns={[
      { title: '权限', dataIndex: 'permissionLabel', width: 200, render: (label, row: AccessGrantItem) => label ?? row.permissionCode },
      { title: '数据范围', dataIndex: 'dataScope', width: 130, render: scope => DATA_SCOPE_OPTIONS.find(item => item.value === scope)?.label ?? scope },
      { title: '当前状态', dataIndex: 'status', width: 100, render: (status: AccessGrantItem['status']) => ACCESS_GRANT_STATUS_LABELS[status] },
      dateTimeColumn('失效时间', 'expiresAt', { empty: '永久有效' }),
      { title: '来源', dataIndex: 'sourceRefs', width: 160, render: refs => accessSourceLabel(refs) },
      { title: '撤销原因', dataIndex: 'revokeReason', width: 200 },
    ]} /> : null}
  </section>;
}
