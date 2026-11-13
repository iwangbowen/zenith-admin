import { useEffect, useState, type ReactNode } from 'react';
import { Banner, Descriptions, Divider, Form, SideSheet, Skeleton, Spin, TabPane, Table, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { AccessGrant, AccessRequest, AccessReviewItem, PermissionPolicy, UpdatePermissionPolicyInput } from '@zenith/shared/identity';
import { accessGovernanceContract, accessPermissionCount, accessSourceLabel, ACCESS_RISK_LABELS as RISK_LABELS, ACCESS_REQUEST_STATUS_LABELS as STATUS_LABELS, ACCESS_PROVISION_STATUS_LABELS, ACCESS_GRANT_STATUS_LABELS as GRANT_STATUS_LABELS, ACCESS_REVIEW_DECISION_LABELS as REVIEW_DECISION_LABELS, ACCESS_APPROVAL_POLICY_LABELS as APPROVAL_LABELS, ACCESS_REQUEST_TYPE_LABELS as REQUEST_TYPE_LABELS, ACCESS_GRANT_SOURCE_LABELS as GRANT_SOURCE_LABELS, ACCESS_REVIEW_SOURCE_LABELS as REVIEW_SOURCE_LABELS, ACCESS_MINIMUM_APPROVAL, higherAccessRisk, stricterAccessApproval } from '@zenith/shared/identity';
import { createLabelOptionsFromMap } from '@zenith/shared/core';
import AccessReviews from './AccessReviews';
import ConfigurableTable from '@/components/ConfigurableTable';
import DateTimeText from '@/components/DateTimeText';
import { EditFormModal } from '@/components/EditFormModal';
import JsonBlock from '@/components/JsonBlock';
import { ListSearchToolbar } from '@/components/list-page';
import { DATA_SCOPE_OPTIONS } from '@/components/permissions/DataScopePanel';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { RefreshButton } from '@/components/toolbar-controls';
import WorkflowInstanceCell from '@/components/workflow/WorkflowInstanceCell';
import WorkflowInstanceDetailSheet from '@/components/workflow/WorkflowInstanceDetailSheet';
import { useEditModal } from '@/hooks/useEditModal';
import { useListPage } from '@/hooks/useListPage';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useAccessGrantDetail, useAccessRequestDetail, useAccessUserOverview, usePermissionPolicyList, useAccessGrantList, useAccessRequestList, useRevokeAccessGrant, useRevokeAccessGrantItem, useRetryAccessProvision, useSavePermissionPolicy } from '@/hooks/queries/identity-access-governance';
import { singleLineColumns, dateTimeColumn, EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const { Title, Text } = Typography;

const RISK_COLORS: Record<AccessRequest['riskLevel'], 'green' | 'orange' | 'red'> = { low: 'green', high: 'orange', critical: 'red' };
const RISK_OPTIONS = createLabelOptionsFromMap(RISK_LABELS);
const APPROVAL_OPTIONS = createLabelOptionsFromMap(APPROVAL_LABELS);
const DATA_SCOPE_LABELS: Record<string, string> = Object.fromEntries(DATA_SCOPE_OPTIONS.map((option) => [option.value, option.label]));

function dataScopeLabel(value: string | null | undefined, fallback = EMPTY_PLACEHOLDER): string {
  if (!value) return fallback;
  return DATA_SCOPE_LABELS[value] ?? value;
}

function deptScopeText(ids: number[]): string {
  return ids.length > 0 ? `${ids.length} 个部门` : EMPTY_PLACEHOLDER;
}

function snapshotText(snapshot: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = snapshot[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

function RiskTag({ value }: { value: AccessRequest['riskLevel'] }) {
  return <Tag color={RISK_COLORS[value]} size="small">{RISK_LABELS[value]}</Tag>;
}

/** 详情里的外键引用：可跳转时渲染为链接，点击在治理页内叠加展开对应抽屉 */
function RefLink({ label, onClick }: { readonly label: ReactNode; readonly onClick?: () => void }) {
  if (!onClick) return <>{label}</>;
  return <Text link onClick={onClick}>{label}</Text>;
}

/** 用户权限治理概览：该用户的临时授权与复核项（详情里点用户名展开，不跳转用户管理） */
function UserGovernanceSheet({ userId, onClose }: { readonly userId: number; readonly onClose: () => void }) {
  const overview = useAccessUserOverview(userId);
  const data = overview.data;
  const grantColumns: ColumnProps<AccessGrant>[] = [
    { title: '状态', dataIndex: 'status', width: 90, render: (value: AccessGrant['status']) => GRANT_STATUS_LABELS[value] },
    { title: '风险等级', dataIndex: 'riskLevel', width: 90, render: (value: AccessGrant['riskLevel']) => <RiskTag value={value} /> },
    { title: '权限项', dataIndex: 'items', width: 90, render: (menus: AccessGrant['items']) => `${menus.length} 项` },
    dateTimeColumn('生效时间', 'startsAt'),
    dateTimeColumn('失效时间', 'expiresAt', { empty: '永久有效' }),
  ];
  const reviewColumns: ColumnProps<AccessReviewItem>[] = [
    { title: '权限', dataIndex: 'permissionCode', minWidth: 200, render: (value: string | null, row) => value ? `${value}${row.permissionLabel ? ` · ${row.permissionLabel}` : ''}` : (row.sourceLabel || EMPTY_PLACEHOLDER) },
    { title: '来源类型', dataIndex: 'sourceType', width: 120, render: (value: AccessReviewItem['sourceType']) => REVIEW_SOURCE_LABELS[value] },
    { title: '复核结果', dataIndex: 'decision', width: 100, render: (value: AccessReviewItem['decision']) => REVIEW_DECISION_LABELS[value] },
    dateTimeColumn('创建时间', 'createdAt'),
  ];
  return (
    <SideSheet title={`用户权限治理 · 用户 #${userId}`} visible onCancel={onClose} width={820} closeOnEsc footer={null}>
      <Spin spinning={overview.isFetching}>
        <Divider align="left" style={{ margin: '0 0 10px' }}>临时授权（{data?.grants.length ?? 0}）</Divider>
        <Table columns={singleLineColumns(grantColumns)} dataSource={data?.grants ?? []} rowKey="id" size="small" pagination={false} empty="暂无临时授权" />
        <Divider align="left" style={{ margin: '16px 0 10px' }}>权限复核（{data?.reviews.length ?? 0}）</Divider>
        <Table columns={singleLineColumns(reviewColumns)} dataSource={data?.reviews ?? []} rowKey="id" size="small" pagination={false} empty="暂无复核项" />
      </Spin>
    </SideSheet>
  );
}

/** 只读详情抽屉壳：查看详情统一走它，避免每个 Tab 重复 SideSheet 样板 */
function DetailSheet({ title, visible, onClose, width, children }: { readonly title: string; readonly visible: boolean; readonly onClose: () => void; readonly width: number; readonly children: ReactNode }) {
  return <SideSheet title={title} visible={visible} onCancel={onClose} width={width} closeOnEsc footer={null}>{children}</SideSheet>;
}

function RequestDetailSheet({ record, visible = record !== null, loading = false, onClose }: { readonly record: AccessRequest | null; readonly visible?: boolean; readonly loading?: boolean; readonly onClose: () => void }) {
  const { hasAnyPermission } = usePermission();
  // 流程实例详情与治理页权限码不同源，缺流程查看权限时降级为只读展示
  const canViewWorkflow = hasAnyPermission('workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor');
  const [workflowId, setWorkflowId] = useState<number | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  // 抽屉关闭后清空下钻引用，避免下次打开时残留上一次的流程/用户
  useEffect(() => {
    if (!visible) {
      setWorkflowId(null);
      setUserId(null);
    }
  }, [visible]);
  const itemColumns: ColumnProps<AccessRequest['items'][number]>[] = [
    { title: '来源', dataIndex: 'sourceRefs', width: 180, ellipsis: { showTitle: true }, render: (value: AccessRequest['items'][number]['sourceRefs']) => accessSourceLabel(value) },
    {
      title: '权限',
      dataIndex: 'permissionCode',
      minWidth: 240,
      render: (value: string | null, row) => {
        const label = row.permissionLabel ?? snapshotText(row.snapshot, ['menuTitle', 'roleName']);
        if (value) return label ? `${value} · ${label}` : value;
        return label ?? EMPTY_PLACEHOLDER;
      },
    },
    { title: '数据范围', dataIndex: 'dataScope', width: 150, render: (value: string | null) => dataScopeLabel(value) },
    { title: '部门范围', dataIndex: 'deptScopeIds', width: 100, render: (value: number[]) => deptScopeText(value) },
  ];
  return <>
    <DetailSheet title={record ? `权限申请详情 #${record.id}` : '权限申请详情'} visible={visible} onClose={onClose} width={760}>
      {!record ? (loading ? <Skeleton placeholder={<Skeleton.Paragraph rows={10} />} loading /> : null) : <>
        {record.failureReason && <Banner type="danger" closeIcon={null} description={record.failureReason} style={{ marginBottom: 12 }} />}
        <Descriptions
          align="plain"
          layout="horizontal"
          column={2}
          style={{ width: '100%' }}
          data={[
            { key: '申请人', value: <RefLink label={record.applicantName ?? EMPTY_PLACEHOLDER} onClick={() => setUserId(record.applicantUserId)} /> },
            { key: '目标用户', value: <RefLink label={record.targetUserName ?? EMPTY_PLACEHOLDER} onClick={() => setUserId(record.targetUserId)} /> },
            { key: '申请类型', value: REQUEST_TYPE_LABELS[record.requestType] },
            { key: '审批状态', value: STATUS_LABELS[record.status] },
            { key: '发放状态', value: ACCESS_PROVISION_STATUS_LABELS[record.provisionStatus] },
            { key: '审批策略', value: APPROVAL_LABELS[record.approvalPlan.approvalPolicy] },
            { key: 'MFA 要求', value: record.approvalPlan.mfaRequired ? '每名审批人验证本人身份' : '无需 MFA' },
            { key: '风险等级', value: <RiskTag value={record.riskLevel} /> },
            { key: '权限项', value: `${accessPermissionCount(record.items)} 项权限 · ${record.items.length} 条范围` },
            { key: '生效时间', value: <DateTimeText value={record.startsAt} mode="absolute" /> },
            { key: '失效时间', value: <DateTimeText value={record.expiresAt} empty="永久有效" mode="absolute" /> },
            { key: '工作流实例', value: record.workflowInstanceId != null ? <WorkflowInstanceCell instanceId={record.workflowInstanceId} showSub={false} onOpen={canViewWorkflow ? setWorkflowId : undefined} /> : EMPTY_PLACEHOLDER },
            { key: '申请时间', value: <DateTimeText value={record.createdAt} mode="absolute" /> },
            { key: '更新时间', value: <DateTimeText value={record.updatedAt} mode="absolute" /> },
            { key: '通过时间', value: <DateTimeText value={record.approvedAt} mode="absolute" /> },
            { key: '实际生效时间', value: <DateTimeText value={record.appliedAt} mode="absolute" /> },
            { key: '申请原因', value: <Text style={{ whiteSpace: 'pre-wrap' }}>{record.reason}</Text>, span: 2 },
          ]}
        />
        <Divider align="left" style={{ margin: '16px 0 10px' }}>申请权限（{accessPermissionCount(record.items)} 项 · {record.items.length} 条范围）</Divider>
        <Table columns={singleLineColumns(itemColumns)} dataSource={record.items} rowKey="id" size="small" pagination={false} empty="暂无权限项" />
      </>}
    </DetailSheet>
    {/* 流程实例不跳转流程中心，直接在治理页内以抽屉展开，保留审批上下文 */}
    <WorkflowInstanceDetailSheet instanceId={workflowId} visible={visible && workflowId !== null} onClose={() => setWorkflowId(null)} title="权限申请流程详情" />
    {visible && userId !== null && <UserGovernanceSheet userId={userId} onClose={() => setUserId(null)} />}
  </>;
}

/** 按 id 拉取申请后复用申请详情抽屉（临时授权详情的「关联申请」下钻） */
function RequestRefSheet({ id, onClose }: { readonly id: number; readonly onClose: () => void }) {
  const request = useAccessRequestDetail(id);
  return <RequestDetailSheet record={request.data ?? null} visible loading={request.isFetching} onClose={onClose} />;
}

function GrantDetailSheet({ record: suppliedRecord, visible = suppliedRecord !== null, loading = false, onClose }: { readonly record: AccessGrant | null; readonly visible?: boolean; readonly loading?: boolean; readonly onClose: () => void }) {
  const { hasPermission } = usePermission();
  const detailQuery = useAccessGrantDetail(suppliedRecord?.id, visible);
  const record = detailQuery.data ?? suppliedRecord;
  const revokeItem = useRevokeAccessGrantItem();
  const revokeModal = useEditModal<AccessGrant['items'][number], { reason: string }>({
    entityName: '授权项',
    save: { isPending: revokeItem.isPending, mutateAsync: async ({ id, values }) => {
      const grant = await revokeItem.mutateAsync({ params: { id: id! }, body: values });
      return grant.items.find(item => item.id === id)!;
    } },
    toValues: () => ({ reason: '' }),
    successMessage: () => '该授权项已撤销，其他授权项保留',
  });
  const [userId, setUserId] = useState<number | null>(null);
  const [requestId, setRequestId] = useState<number | null>(null);
  // 抽屉关闭后清空下钻引用，避免下次打开时残留上一次的用户/申请
  useEffect(() => {
    if (!visible) {
      setUserId(null);
      setRequestId(null);
    }
  }, [visible]);
  const menuColumns: ColumnProps<AccessGrant['items'][number]>[] = [
    { title: '权限码', dataIndex: 'permissionCode', minWidth: 220, render: (value: string | null) => value ?? EMPTY_PLACEHOLDER },
    { title: '权限名称', dataIndex: 'permissionLabel', width: 200, render: (value: string | null) => value ?? EMPTY_PLACEHOLDER },
    { title: '数据范围', dataIndex: 'dataScope', width: 130, render: (value: string) => dataScopeLabel(value) },
    { title: '部门范围', dataIndex: 'deptScopeIds', width: 110, render: (value: number[]) => deptScopeText(value) },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: AccessGrant['status']) => GRANT_STATUS_LABELS[value] },
    dateTimeColumn('生效时间', 'startsAt'),
    dateTimeColumn('失效时间', 'expiresAt', { empty: '永久有效' }),
    createOperationColumn<AccessGrant['items'][number]>({ width: 120, actions: row => [{ key: 'revoke', label: '撤销此项', danger: true, hidden: !hasPermission('system:access-governance:revoke') || !['active', 'scheduled'].includes(row.status), onClick: () => revokeModal.openEdit(row) }] }),
  ];
  return <>
    <DetailSheet title={record ? `授权详情 #${record.id}` : '授权详情'} visible={visible} onClose={onClose} width={1000}>
      {!record ? (loading ? <Skeleton placeholder={<Skeleton.Paragraph rows={8} />} loading /> : null) : <>
        <Descriptions
          align="plain"
          layout="horizontal"
          column={2}
          style={{ width: '100%' }}
          data={[
            { key: '用户', value: <RefLink label={record.userName ?? `用户 #${record.userId}`} onClick={() => setUserId(record.userId)} /> },
            { key: '来源', value: GRANT_SOURCE_LABELS[record.sourceType] },
            { key: '状态', value: GRANT_STATUS_LABELS[record.status] },
            { key: '风险等级', value: <RiskTag value={record.riskLevel} /> },
            { key: '授权范围', value: '按下方每项权限独立记录', span: 2 },
            { key: '生效时间', value: <DateTimeText value={record.startsAt} mode="absolute" /> },
            { key: '失效时间', value: <DateTimeText value={record.expiresAt} empty="永久有效" mode="absolute" /> },
            { key: '关联申请', value: record.requestId != null ? <RefLink label={`#${record.requestId}`} onClick={() => setRequestId(record.requestId ?? null)} /> : EMPTY_PLACEHOLDER },
            { key: '审批人', value: record.approvedByName ?? EMPTY_PLACEHOLDER },
            { key: '撤销人', value: record.revokedBy != null ? `用户 #${record.revokedBy}` : EMPTY_PLACEHOLDER },
            { key: '撤销时间', value: <DateTimeText value={record.revokedAt} mode="absolute" /> },
            { key: '创建时间', value: <DateTimeText value={record.createdAt} mode="absolute" /> },
            { key: '更新时间', value: <DateTimeText value={record.updatedAt} mode="absolute" /> },
            { key: '撤销原因', value: record.revokeReason ? <Text style={{ whiteSpace: 'pre-wrap' }}>{record.revokeReason}</Text> : EMPTY_PLACEHOLDER, span: 2 },
          ]}
        />
        <Divider align="left" style={{ margin: '16px 0 10px' }}>授权权限（{accessPermissionCount(record.items)} 项 · {record.items.length} 条范围）</Divider>
        <Table columns={singleLineColumns(menuColumns)} dataSource={record.items} rowKey="id" size="small" pagination={false} scroll={{ x: 1240 }} empty="暂无权限项" />
      </>}
    </DetailSheet>
    {visible && requestId !== null && <RequestRefSheet id={requestId} onClose={() => setRequestId(null)} />}
    {visible && userId !== null && <UserGovernanceSheet userId={userId} onClose={() => setUserId(null)} />}
    <EditFormModal modal={revokeModal} title="撤销单项授权" okText="撤销此项" width={560} header={<Banner type="warning" closeIcon={null} description={`仅撤销“${revokeModal.editing?.permissionLabel ?? revokeModal.editing?.permissionCode ?? ''}”，同一授权包中的其他权限及独立授权来源保留。`} />}>
      <Form.TextArea field="reason" label="撤销原因" rows={3} maxCount={1000} rules={[{ required: true, message: '请填写撤销原因' }, { min: 2, message: '至少填写两个字' }]} />
    </EditFormModal>
  </>;
}

/** 按 id 拉取临时授权后复用授权详情抽屉（权限复核详情的「来源授权」下钻） */
function GrantRefSheet({ id, onClose }: { readonly id: number; readonly onClose: () => void }) {
  const grant = useAccessGrantDetail(id);
  return <GrantDetailSheet record={grant.data ?? null} visible loading={grant.isFetching} onClose={onClose} />;
}

function ReviewDetailSheet({ record, visible = record !== null, loading = false, onClose }: { readonly record: AccessReviewItem | null; readonly visible?: boolean; readonly loading?: boolean; readonly onClose: () => void }) {
  const { hasPermission } = usePermission();
  const canViewRelations = hasPermission('system:access-governance:view');
  const [userId, setUserId] = useState<number | null>(null);
  const [grantId, setGrantId] = useState<number | null>(null);
  // 抽屉关闭后清空下钻引用，避免下次打开时残留上一次的用户/授权
  useEffect(() => {
    if (!visible) {
      setUserId(null);
      setGrantId(null);
    }
  }, [visible]);
  return <>
    <DetailSheet title={record ? `权限复核详情 #${record.id}` : '权限复核详情'} visible={visible} onClose={onClose} width={680}>
      {!record ? (loading ? <Skeleton placeholder={<Skeleton.Paragraph rows={8} />} loading /> : null) : <>
        <Descriptions
          align="plain"
          layout="horizontal"
          column={2}
          style={{ width: '100%' }}
          data={[
            { key: '用户', value: <RefLink label={record.userName ?? `用户 #${record.userId}`} onClick={canViewRelations ? () => setUserId(record.userId) : undefined} /> },
            { key: '复核批次', value: `#${record.campaignId}` },
            { key: '来源类型', value: REVIEW_SOURCE_LABELS[record.sourceType] },
            {
              key: '来源',
              value:               canViewRelations && record.sourceType === 'temporary_grant' && typeof record.snapshot.grantId === 'number'
                              ? <RefLink label={record.sourceLabel ?? `授权项 #${record.sourceId}`} onClick={() => setGrantId(Number(record.snapshot.grantId))} />
                : (record.sourceLabel ?? EMPTY_PLACEHOLDER),
            },
            { key: '权限', value: record.permissionCode ? `${record.permissionCode}${record.permissionLabel ? ` · ${record.permissionLabel}` : ''}` : (record.sourceLabel ?? EMPTY_PLACEHOLDER), span: 2 },
            { key: '风险等级', value: <RiskTag value={record.riskLevel} /> },
            { key: '复核结果', value: REVIEW_DECISION_LABELS[record.decision] },
            { key: '复核负责人', value: record.reviewerName ?? `用户 #${record.reviewerId}` },
            { key: '复核截止时间', value: <DateTimeText value={record.dueAt} mode="absolute" /> },
            { key: '下次复核', value: <DateTimeText value={record.nextReviewAt} mode="absolute" /> },
            { key: '例外截止时间', value: <DateTimeText value={record.exceptionUntil} mode="absolute" /> },
            { key: '处理人', value: record.decidedBy != null ? <RefLink label={`用户 #${record.decidedBy}`} onClick={canViewRelations ? () => setUserId(record.decidedBy ?? null) : undefined} /> : EMPTY_PLACEHOLDER },
            { key: '处理时间', value: <DateTimeText value={record.decidedAt} mode="absolute" /> },
            { key: '创建时间', value: <DateTimeText value={record.createdAt} mode="absolute" /> },
            { key: '备注', value: record.remark ? <Text style={{ whiteSpace: 'pre-wrap' }}>{record.remark}</Text> : EMPTY_PLACEHOLDER, span: 2 },
          ]}
        />
        {record.history.length > 0 && <><Divider align="left">处置历史</Divider><Table rowKey="decidedAt" size="small" pagination={false} dataSource={record.history} columns={singleLineColumns([
          { title: '处置', dataIndex: 'decision', width: 120, render: (value: AccessReviewItem['history'][number]['decision']) => REVIEW_DECISION_LABELS[value] },
          { title: '处理人', dataIndex: 'actorName', width: 120 },
          dateTimeColumn('处理时间', 'decidedAt'),
          { title: '处置依据', dataIndex: 'remark', minWidth: 180 },
        ])} /></>}
        {Object.keys(record.snapshot ?? {}).length > 0 && <>
          <Divider align="left" style={{ margin: '16px 0 10px' }}>复核快照</Divider>
          <JsonBlock value={record.snapshot} />
        </>}
      </>}
    </DetailSheet>
    {visible && canViewRelations && grantId !== null && <GrantRefSheet id={grantId} onClose={() => setGrantId(null)} />}
    {visible && canViewRelations && userId !== null && <UserGovernanceSheet userId={userId} onClose={() => setUserId(null)} />}
  </>;
}

function PolicyDetailSheet({ record, onClose }: { readonly record: PermissionPolicy | null; readonly onClose: () => void }) {
  return (
    <DetailSheet title={record ? `权限策略详情 · ${record.permissionCode}` : '权限策略详情'} visible={record !== null} onClose={onClose} width={600}>
      {record && <Descriptions
        align="plain"
        layout="horizontal"
        column={2}
        style={{ width: '100%' }}
        data={[
          { key: '权限码', value: record.permissionCode, span: 2 },
          { key: '风险等级', value: <RiskTag value={record.riskLevel} /> },
          { key: '状态', value: record.enabled ? <Tag color="green" size="small">启用</Tag> : <Tag color="grey" size="small">停用</Tag> },
          { key: '审批策略', value: APPROVAL_LABELS[record.approvalPolicy] },
          { key: '审批时要求 MFA', value: record.mfaRequired ? '是' : '否' },
          { key: '最大时长', value: record.maxDurationMinutes ? `${record.maxDurationMinutes} 分钟` : '不限制' },
          { key: '复核周期', value: record.reviewIntervalDays ? `${record.reviewIntervalDays} 天` : '不自动复核' },
          { key: '租户', value: record.tenantId != null ? `#${record.tenantId}` : '平台级' },
          { key: '更新时间', value: <DateTimeText value={record.updatedAt} mode="absolute" /> },
          { key: '创建时间', value: <DateTimeText value={record.createdAt} mode="absolute" /> },
        ]}
      />}
    </DetailSheet>
  );
}

function RequestsTab() {
  const { hasPermission } = usePermission();
  const page = useListPage({ op: accessGovernanceContract.requestList, useList: useAccessRequestList, table: { rowKey: 'id', empty: '暂无权限申请', loadingMode: 'initial' } });
  const retry = useRetryAccessProvision();
  const [detail, setDetail] = useState<AccessRequest | null>(null);
  const columns: ColumnProps<AccessRequest>[] = [
    { title: '申请人', dataIndex: 'applicantName', width: 180, render: (value) => value || EMPTY_PLACEHOLDER },
    { title: '目标用户', dataIndex: 'targetUserName', width: 180, render: (value) => value || EMPTY_PLACEHOLDER },
    { title: '风险等级', dataIndex: 'riskLevel', width: 100, render: (value: AccessRequest['riskLevel']) => <RiskTag value={value} /> },
    { title: '审批状态', dataIndex: 'status', width: 110, render: (value: AccessRequest['status']) => STATUS_LABELS[value] },
    { title: '发放状态', dataIndex: 'provisionStatus', width: 110, render: (value: AccessRequest['provisionStatus']) => ACCESS_PROVISION_STATUS_LABELS[value] },
    { title: '发放失败原因', dataIndex: 'failureReason', minWidth: 200, render: (value: string | null) => value ?? '—' },
    { title: '申请原因', dataIndex: 'reason', minWidth: 220, ellipsis: true },
    { title: '权限项', dataIndex: 'items', width: 90, render: (items: AccessRequest['items']) => `${accessPermissionCount(items)} 项` },
    dateTimeColumn('生效时间', 'startsAt'),
    dateTimeColumn('失效时间', 'expiresAt', { empty: '永久有效' }),
    dateTimeColumn('申请时间', 'createdAt'),
    createOperationColumn<AccessRequest>({ width: 220, actions: (row) => [
      { key: 'detail', label: '查看详情', onClick: () => setDetail(row) },
      { key: 'retry', label: '重试发放', hidden: !hasPermission('system:access-governance:grant') || row.provisionStatus !== 'failed' || row.status !== 'approved', loading: retry.isPending, onClick: () => void retry.mutateAsync({ params: { id: row.id } }) },
    ] }),
  ];
  return <><ListSearchToolbar page={page} filters={['keyword', 'status', 'provisionStatus', 'riskLevel', 'targetUserId', ['startTime', 'endTime']]} actions={<RefreshButton onClick={() => void page.listQuery.refetch()} loading={page.listQuery.isFetching} />} /><ConfigurableTable columns={singleLineColumns(columns)} {...page.tableProps} /><RequestDetailSheet record={page.listQuery.data?.list.find(row => row.id === detail?.id) ?? detail} onClose={() => setDetail(null)} /></>;
}

function GrantsTab() {
  const { hasPermission } = usePermission();
  const page = useListPage({ op: accessGovernanceContract.grantList, useList: useAccessGrantList, table: { rowKey: 'id', empty: '暂无审批授权' } });
  const revoke = useRevokeAccessGrant();
  const revokeModal = useEditModal<AccessGrant, { reason: string }>({
    entityName: '授权包',
    save: { isPending: revoke.isPending, mutateAsync: ({ id, values }) => revoke.mutateAsync({ params: { id: id! }, body: values }) },
    toValues: () => ({ reason: '' }),
    successMessage: () => '授权包中的有效权限已全部撤销',
  });
  const [detail, setDetail] = useState<AccessGrant | null>(null);
  const columns: ColumnProps<AccessGrant>[] = [
    { title: '用户', dataIndex: 'userName', minWidth: 120, render: (value) => value || EMPTY_PLACEHOLDER },
    { title: '风险等级', dataIndex: 'riskLevel', width: 100, render: (value: AccessGrant['riskLevel']) => <RiskTag value={value} /> },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: AccessGrant['status']) => value === 'active' ? <Tag color="green" size="small">{GRANT_STATUS_LABELS[value]}</Tag> : GRANT_STATUS_LABELS[value] },
    { title: '权限项', dataIndex: 'items', width: 90, render: (menus: AccessGrant['items']) => `${menus.length} 项` },
    { title: '数据范围', dataIndex: 'items', width: 170, render: (items: AccessGrant['items']) => [...new Set(items.map(item => dataScopeLabel(item.dataScope)))].join('、') },
    dateTimeColumn('生效时间', 'startsAt'),
    dateTimeColumn('失效时间', 'expiresAt', { empty: '永久有效' }),
    createOperationColumn<AccessGrant>({ width: 210, actions: (row) => [
      { key: 'detail', label: '查看详情', onClick: () => setDetail(row) },
      { key: 'revoke', label: '撤销整包', danger: true, hidden: !hasPermission('system:access-governance:revoke') || !['scheduled', 'active'].includes(row.status), loading: revoke.isPending, onClick: () => revokeModal.openEdit(row) },
    ] }),
  ];
  return <><ListSearchToolbar page={page} filters={['keyword', 'status', 'riskLevel', 'userId']} actions={<RefreshButton onClick={() => void page.listQuery.refetch()} loading={page.listQuery.isFetching} />} /><ConfigurableTable columns={singleLineColumns(columns)} {...page.tableProps} /><GrantDetailSheet record={page.listQuery.data?.list.find(row => row.id === detail?.id) ?? detail} onClose={() => setDetail(null)} /><EditFormModal modal={revokeModal} title="撤销整个授权包" okText="撤销整包" width={580} header={<Banner type="warning" closeIcon={null} description="这会立即回收该授权包中的全部有效权限。只需回收某一项时，请在授权详情中选择“撤销此项”。其他独立授权来源保留。" />}><Form.TextArea field="reason" label="撤销原因" rows={3} maxCount={1000} rules={[{ required: true, message: '请填写撤销原因' }, { min: 2, message: '至少填写两个字' }]} /></EditFormModal></>;
}

function ReviewsTab() {
  const [detail, setDetail] = useState<AccessReviewItem | null>(null);
  return <><AccessReviews onDetail={setDetail} /><ReviewDetailSheet record={detail} onClose={() => setDetail(null)} /></>;
}

function PoliciesTab() {
  const page = useListPage({ op: accessGovernanceContract.policyList, useList: usePermissionPolicyList, table: { rowKey: 'permissionCode', empty: '暂无权限策略' } });
  const save = useSavePermissionPolicy();
  const [detail, setDetail] = useState<PermissionPolicy | null>(null);
  const modal = useEditModal<PermissionPolicy, UpdatePermissionPolicyInput & { permissionCode: string }>({
    entityName: '权限策略',
    save,
    toValues: (record) => ({ permissionCode: record.permissionCode, riskLevel: record.riskLevel, approvalPolicy: record.approvalPolicy, maxDurationMinutes: record.maxDurationMinutes ?? null, reviewIntervalDays: record.reviewIntervalDays, mfaRequired: record.mfaRequired, enabled: record.enabled, permanentAllowed: record.permanentAllowed, emergencyAllowed: record.emergencyAllowed, maxEmergencyMinutes: record.maxEmergencyMinutes }),
    beforeSave: values => ({ ...values, maxDurationMinutes: values.maxDurationMinutes ?? null }),
  });
  const columns: ColumnProps<PermissionPolicy>[] = [
    { title: '权限码', dataIndex: 'permissionCode', minWidth: 260, ellipsis: { showTitle: true } },
    { title: '风险等级', dataIndex: 'riskLevel', width: 100, render: (value: PermissionPolicy['riskLevel']) => <RiskTag value={value} /> },
    { title: '审批策略', dataIndex: 'approvalPolicy', width: 170, ellipsis: { showTitle: true }, render: (value: UpdatePermissionPolicyInput['approvalPolicy']) => APPROVAL_LABELS[value] },
    { title: '最大时长', dataIndex: 'maxDurationMinutes', width: 110, render: (value) => value ? `${value} 分钟` : '不限制' },
    { title: '复核周期', dataIndex: 'reviewIntervalDays', width: 140, ellipsis: { showTitle: true }, render: (value) => value ? `${value} 天` : '不自动复核' },
    { title: '状态', dataIndex: 'enabled', width: 80, render: (value) => value ? <Tag color="green">启用</Tag> : <Tag color="grey">停用</Tag> },
    createOperationColumn<PermissionPolicy>({ width: 210, actions: (row) => [
      { key: 'detail', label: '查看详情', onClick: () => setDetail(row) },
      { key: 'edit', label: '编辑策略', onClick: () => modal.openEdit(row) },
    ] }),
  ];
  return <><div style={{ marginBottom: 12 }}><Text type="tertiary">权限策略由共享权限目录生成，租户管理员可以调整审批方式、最长时长和复核周期。</Text></div><ListSearchToolbar page={page} filters={['keyword', 'riskLevel', 'approvalPolicy']} actions={<RefreshButton onClick={() => void page.listQuery.refetch()} loading={page.listQuery.isFetching} />} /><ConfigurableTable columns={singleLineColumns(columns)} {...page.tableProps} /><PolicyDetailSheet record={detail} onClose={() => setDetail(null)} /><EditFormModal modal={modal} width={620} header={<Banner type="info" closeIcon={null} description={`目录最低风险：${modal.editing ? RISK_LABELS[modal.editing.minimumRiskLevel] : '—'}。高危及极高危的审批、MFA 和复核要求不能低于目录底线；未覆盖时继承基线策略。`} />} formProps={{ onValueChange: next => {
      const values = next as Partial<UpdatePermissionPolicyInput>;
      const risk = values.riskLevel;
      if (!risk) return;
      const minimum = ACCESS_MINIMUM_APPROVAL[risk];
      if (values.approvalPolicy && stricterAccessApproval(values.approvalPolicy, minimum) !== values.approvalPolicy) modal.formApi.current?.setValue('approvalPolicy', minimum);
      if (risk === 'critical' && !values.mfaRequired) modal.formApi.current?.setValue('mfaRequired', true);
      if (risk !== 'low') {
        const limit = risk === 'critical' ? 30 : 90;
        if (!values.reviewIntervalDays || values.reviewIntervalDays > limit) modal.formApi.current?.setValue('reviewIntervalDays', limit);
      }
    } }}>
      {({ formState }) => {
        const values = formState.values as Partial<UpdatePermissionPolicyInput>;
        const risk = values.riskLevel ?? 'low';
        return <>
          <Form.Input field="permissionCode" label="权限码" disabled />
          <Form.Select field="riskLevel" label="风险等级" optionList={RISK_OPTIONS.map(option => ({ ...option, disabled: !!modal.editing && higherAccessRisk(option.value, modal.editing.minimumRiskLevel) !== option.value }))} />
          <Form.Select field="approvalPolicy" label="审批策略" optionList={APPROVAL_OPTIONS.map(option => ({ ...option, disabled: stricterAccessApproval(option.value, ACCESS_MINIMUM_APPROVAL[risk]) !== option.value }))} />
          <Form.InputNumber field="maxDurationMinutes" label="限时申请上限" min={1} suffix="分钟" extraText="选填，留空不限时长；不影响永久有效授权。" />
          <Form.InputNumber field="reviewIntervalDays" label="复核周期" min={risk === 'low' ? 0 : 1} max={risk === 'critical' ? 30 : risk === 'high' ? 90 : 3650} suffix="天" />
          <Form.Switch field="mfaRequired" label="审批时要求 MFA" disabled={risk === 'critical'} />
          <Form.Switch field="permanentAllowed" label="允许永久授权" />
          <Form.Switch field="emergencyAllowed" label="允许紧急授权" />
          <Form.InputNumber field="maxEmergencyMinutes" label="紧急授权上限" min={1} max={1440} suffix="分钟" />
          <Form.Switch field="enabled" label="允许本人申请" disabled={modal.editing?.selfRequestable === false} />
        </>;
      }}
    </EditFormModal></>;
}

export default function AccessGovernancePage() {
  const { hasPermission } = usePermission();
  const canView = hasPermission('system:access-governance:view');
  const canReview = hasPermission('system:access-governance:review');
  const canPolicy = hasPermission('system:access-governance:policy');
  const fallback = canView ? 'requests' : canReview ? 'reviews' : 'policies';
  const [activeTab, setActiveTab] = useUrlTabState(['requests', 'grants', 'reviews', 'policies'] as const, fallback);
  const allowed = activeTab === 'reviews' ? canReview : activeTab === 'policies' ? canPolicy : canView;
  const visibleTab = allowed ? activeTab : fallback;
  if (!canView && !canReview && !canPolicy) return <Banner type="warning" closeIcon={null} description="您没有权限治理的查看或办理权限，可到“我的权限”查看本人申请和授权。" />;
  return <div className="page-container page-tabs-page zx-flat-panels">
    <div style={{ marginBottom: 16 }}><Title heading={5} style={{ margin: 0 }}>权限治理</Title><Text type="tertiary" style={{ display: 'block', marginTop: 8 }}>管理申请、限时与永久授权、权限复核和有效策略。</Text></div>
    <Tabs activeKey={visibleTab} onChange={key => setActiveTab(key as typeof activeTab)} type="line" lazyRender keepDOM={false}>
      <TabPane tab="授权申请" itemKey="requests" disabled={!canView}>{canView && <RequestsTab />}</TabPane>
      <TabPane tab="审批授权" itemKey="grants" disabled={!canView}>{canView && <GrantsTab />}</TabPane>
      <TabPane tab="权限复核" itemKey="reviews" disabled={!canReview}>{canReview && <ReviewsTab />}</TabPane>
      <TabPane tab="策略配置" itemKey="policies" disabled={!canPolicy}>{canPolicy && <PoliciesTab />}</TabPane>
    </Tabs>
  </div>;
}
