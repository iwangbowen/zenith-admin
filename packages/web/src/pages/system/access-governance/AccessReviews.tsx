import { useState } from 'react';
import { Banner, Button, Form, Space, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { createLabelOptionsFromMap } from '@zenith/shared/core';
import {
  accessGovernanceContract, ACCESS_REVIEW_DECISION_LABELS, ACCESS_REVIEW_SCOPE_LABELS, ACCESS_REVIEW_SOURCE_LABELS, ACCESS_REVIEW_STATUS_LABELS, ACCESS_RISK_LABELS,
  type AccessReviewCampaign, type AccessReviewItem, type AssignAccessReviewCampaignInput, type CreateAccessReviewCampaignInput, type DecideAccessReviewItemInput,
} from '@zenith/shared/identity';
import ConfigurableTable from '@/components/ConfigurableTable';
import { EditFormModal } from '@/components/EditFormModal';
import { ListSearchToolbar } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { RefreshButton } from '@/components/toolbar-controls';
import { useAuth } from '@/hooks/useAuth';
import { useEditModal } from '@/hooks/useEditModal';
import { useListPage } from '@/hooks/useListPage';
import {
  useAccessReviewCampaignList, useAccessReviewItemList, useAccessReviewOptions, useAssignAccessReviewCampaign,
  useCreateAccessReviewCampaign, useDecideAccessReviewItem, useRetryAccessReviewCampaign,
} from '@/hooks/queries/identity-access-governance';
import { formatDateTimeForApi } from '@/utils/date';
import { singleLineColumns, dateTimeColumn } from '@/utils/table-columns';

const SCOPE_OPTIONS = createLabelOptionsFromMap(ACCESS_REVIEW_SCOPE_LABELS);
const DECISION_OPTIONS = createLabelOptionsFromMap(ACCESS_REVIEW_DECISION_LABELS).filter(option => option.value !== 'pending');
type CampaignValues = Omit<CreateAccessReviewCampaignInput, 'dueAt'> & { dueAt: Date | string };
type DecisionValues = Omit<DecideAccessReviewItemInput, 'expiresAt' | 'dueAt'> & { expiresAt?: Date | string; dueAt?: Date | string };

export default function AccessReviews({ onDetail }: Readonly<{ onDetail: (item: AccessReviewItem) => void }>) {
  const { user } = useAuth();
  const [campaignId, setCampaignId] = useState<number | null>(() => {
    const raw = new URLSearchParams(globalThis.location.search).get('campaignId');
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  });
  const campaigns = useListPage({ op: accessGovernanceContract.reviewCampaignList, useList: useAccessReviewCampaignList, table: { rowKey: 'id', empty: '暂无复核批次', loadingMode: 'initial' } });
  const items = useListPage({ op: accessGovernanceContract.reviewItemList, useList: useAccessReviewItemList, params: { campaignId: campaignId ?? undefined }, table: { rowKey: 'id', empty: '所选范围没有复核项' } });
  const create = useCreateAccessReviewCampaign();
  const assign = useAssignAccessReviewCampaign();
  const retry = useRetryAccessReviewCampaign();
  const decide = useDecideAccessReviewItem();
  const createModal = useEditModal<AccessReviewCampaign, CampaignValues, CreateAccessReviewCampaignInput>({
    entityName: '复核批次',
    save: { isPending: create.isPending, mutateAsync: ({ values }) => create.mutateAsync({ body: values }) },
    defaults: () => ({ scopeType: 'tenant', scopeIds: [], dueAt: new Date(Date.now() + 7 * 86_400_000) }),
    beforeSave: values => ({ ...values, scopeIds: ['department', 'role', 'group', 'user'].includes(values.scopeType) ? values.scopeIds : [], dueAt: formatDateTimeForApi(values.dueAt) }),
    onSaved: campaign => { setCampaignId(campaign.id); items.setPage(1); },
    successMessage: () => '复核批次已创建，正在后台准备权限快照',
  });
  const assignModal = useEditModal<AccessReviewCampaign, AssignAccessReviewCampaignInput>({
    entityName: '复核负责人',
    save: { isPending: assign.isPending, mutateAsync: ({ id, values }) => assign.mutateAsync({ params: { id: id! }, body: values }) },
    toValues: campaign => ({ reviewerId: campaign.reviewerId }),
  });
  const decisionModal = useEditModal<AccessReviewItem, DecisionValues, DecideAccessReviewItemInput>({
    entityName: '复核处置',
    save: { isPending: decide.isPending, mutateAsync: ({ id, values }) => decide.mutateAsync({ params: { id: id! }, body: values }) },
    toValues: () => ({ decision: 'keep', remark: '' }),
    beforeSave: values => ({
      decision: values.decision, remark: values.remark,
      expiresAt: ['extend', 'exception'].includes(values.decision) ? formatDateTimeForApi(values.expiresAt) : undefined,
      dueAt: values.decision === 'escalate' ? formatDateTimeForApi(values.dueAt) : undefined,
      targetReviewerId: values.decision === 'escalate' ? values.targetReviewerId : undefined,
      exceptionOwnerId: values.decision === 'exception' ? values.exceptionOwnerId : undefined,
      mfaCode: ['keep', 'extend', 'exception'].includes(values.decision) ? values.mfaCode?.trim() || undefined : undefined,
    }),
    successMessage: () => '复核处置已执行',
  });
  const options = useAccessReviewOptions(createModal.visible || assignModal.visible || decisionModal.visible);
  const reviewers = (options.data?.reviewers ?? []).map(person => ({ value: person.id, label: person.name }));
  const batch = campaigns.listQuery.data?.list.find(campaign => campaign.id === campaignId);
  const canDecide = (row: AccessReviewItem) => row.decision === 'pending'
    && (row.reviewerId === user?.id || user?.roles?.some(role => role.code === 'super_admin'));
  const campaignColumns: ColumnProps<AccessReviewCampaign>[] = [
    { title: '批次名称', dataIndex: 'name', minWidth: 220 },
    { title: '范围', dataIndex: 'scopeType', width: 160, render: (value: AccessReviewCampaign['scopeType']) => ACCESS_REVIEW_SCOPE_LABELS[value] },
    { title: '负责人', dataIndex: 'reviewerName', width: 120 },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: AccessReviewCampaign['status']) => <Tag color={value === 'failed' || value === 'overdue' ? 'red' : value === 'completed' ? 'green' : 'blue'}>{ACCESS_REVIEW_STATUS_LABELS[value]}</Tag> },
    { title: '待办 / 总数', width: 120, render: (_, row) => `${row.pendingCount ?? 0} / ${row.itemCount ?? 0}` },
    dateTimeColumn('截止时间', 'dueAt'),
    createOperationColumn<AccessReviewCampaign>({ width: 240, actions: row => [
      { key: 'items', label: '查看复核项', onClick: () => { setCampaignId(row.id); items.setPage(1); } },
      { key: 'assign', label: '调整负责人', hidden: ['completed', 'preparing'].includes(row.status), onClick: () => assignModal.openEdit(row) },
      { key: 'retry', label: '重试准备', hidden: row.status !== 'failed', loading: retry.isPending, onClick: () => void retry.mutateAsync({ params: { id: row.id } }) },
    ] }),
  ];
  const itemColumns: ColumnProps<AccessReviewItem>[] = [
    { title: '用户', dataIndex: 'userName', width: 180 },
    { title: '权限 / 授权来源', minWidth: 230, render: (_, row) => row.permissionLabel ?? row.sourceLabel ?? row.permissionCode },
    { title: '处置范围', dataIndex: 'sourceType', width: 150, render: (value: AccessReviewItem['sourceType']) => ACCESS_REVIEW_SOURCE_LABELS[value] },
    { title: '风险', dataIndex: 'riskLevel', width: 90, render: (value: AccessReviewItem['riskLevel']) => ACCESS_RISK_LABELS[value] },
    { title: '负责人', dataIndex: 'reviewerName', width: 110 },
    { title: '结果', dataIndex: 'decision', width: 110, render: (value: AccessReviewItem['decision']) => ACCESS_REVIEW_DECISION_LABELS[value] },
    dateTimeColumn('截止时间', 'dueAt'),
    createOperationColumn<AccessReviewItem>({ width: 180, actions: row => [
      { key: 'detail', label: '查看详情', onClick: () => onDetail(row) },
      { key: 'decide', label: '处置', hidden: !canDecide(row) || batch?.status === 'preparing', onClick: () => decisionModal.openEdit(row) },
    ] }),
  ];
  return <>
    <Space style={{ marginBottom: 12 }}><Button theme="solid" onClick={createModal.openCreate}>新建复核批次</Button><RefreshButton onClick={() => { void campaigns.listQuery.refetch(); void items.listQuery.refetch(); }} loading={campaigns.listQuery.isFetching || items.listQuery.isFetching} /></Space>
    <ConfigurableTable columns={singleLineColumns(campaignColumns)} {...campaigns.tableProps} />
    <div style={{ marginTop: 24, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Typography.Title heading={6} style={{ margin: 0 }}>{campaignId ? `复核项 · ${batch?.name ?? `批次 #${campaignId}`}` : '全部复核项'}</Typography.Title>
      {campaignId && <Button theme="borderless" onClick={() => { setCampaignId(null); items.setPage(1); }}>查看全部批次的复核项</Button>}
    </div>
    {batch?.status === 'preparing' && <Banner type="info" closeIcon={null} description="正在分批采集权限来源，列表会自动刷新；准备完成后即可处置。" style={{ marginBottom: 12 }} />}
    {batch?.failureReason && <Banner type="danger" closeIcon={null} description={batch.failureReason} style={{ marginBottom: 12 }} />}
    <ListSearchToolbar page={items} filters={['decision', 'riskLevel', 'sourceType', 'userId']} />
    <ConfigurableTable columns={singleLineColumns(itemColumns)} {...items.tableProps} />
    <EditFormModal modal={createModal} width={620}>
      {({ formState }) => {
        const scope = (formState.values as Partial<CampaignValues>).scopeType ?? 'tenant';
        const source = scope === 'department' ? options.data?.departments : scope === 'role' ? options.data?.roles : scope === 'group' ? options.data?.groups : options.data?.users;
        return <>
          <Form.Input field="name" label="批次名称" maxLength={128} rules={[{ required: true, message: '请填写批次名称' }]} />
          <Form.Select field="scopeType" label="复核范围" optionList={SCOPE_OPTIONS} style={{ width: '100%' }} />
          {['department', 'role', 'group', 'user'].includes(scope) && <Form.Select key={scope} field="scopeIds" label="具体范围" multiple filter style={{ width: '100%' }} maxTagCount={3} showRestTagsPopover optionList={(source ?? []).map(entry => ({ value: entry.id, label: entry.name }))} rules={[{ required: true, message: '请选择具体范围' }]} />}
          <Form.Select field="reviewerId" label="复核负责人" filter style={{ width: '100%' }} optionList={reviewers} rules={[{ required: true, message: '请选择复核负责人' }]} extraText="复核人不能保留自己的权限；可将自有权限升级给独立负责人处理。" />
          <Form.DatePicker field="dueAt" label="截止时间" type="dateTime" format="yyyy-MM-dd HH:mm:ss" style={{ width: '100%' }} rules={[{ required: true, message: '请选择截止时间' }]} />
          <Typography.Text type="tertiary">角色和用户组以整个绑定关系为复核单位；临时授权按单个操作权限处置。</Typography.Text>
          {options.error && <Banner type="danger" closeIcon={null} description={options.error.message} />}
        </>;
      }}
    </EditFormModal>
    <EditFormModal modal={assignModal} width={560} title="调整复核负责人">
      <Form.Select field="reviewerId" label="新负责人" filter optionList={reviewers} style={{ width: '100%' }} rules={[{ required: true, message: '请选择负责人' }]} />
      <Form.TextArea field="reason" label="调整原因" rows={3} rules={[{ required: true, message: '请填写调整原因' }, { min: 2, message: '至少填写两个字' }]} />
    </EditFormModal>
    <EditFormModal modal={decisionModal} width={640} title="处置权限复核项" header={<Banner type="warning" closeIcon={null} description={`本次处置范围：${decisionModal.editing ? ACCESS_REVIEW_SOURCE_LABELS[decisionModal.editing.sourceType] : ''}。撤销将实际移除此来源，其他独立授权来源仍保留。`} />}>
      {({ formState }) => {
        const decision = (formState.values as Partial<DecisionValues>).decision ?? 'keep';
        const record = decisionModal.editing;
        const needsMfa = ['keep', 'extend', 'exception'].includes(decision);
        const dynamic = record?.sourceType === 'group_membership' && record.snapshot.memberMode === 'dynamic';
        return <>
          <Form.Select field="decision" label="处置方式" style={{ width: '100%' }} optionList={DECISION_OPTIONS.filter(option => (option.value !== 'extend' || record?.sourceType === 'temporary_grant') && (option.value !== 'revoke' || !dynamic))} rules={[{ required: true }]} />
          {dynamic && <Banner type="info" closeIcon={null} description="动态用户组由规则维护，请升级给负责人调整成员规则，避免撤销后被自动恢复。" />}
          {['extend', 'exception'].includes(decision) && <Form.DatePicker field="expiresAt" label={decision === 'extend' ? '新失效时间' : '例外截止时间'} type="dateTime" format="yyyy-MM-dd HH:mm:ss" style={{ width: '100%' }} rules={[{ required: true }]} extraText={decision === 'extend' ? '仅延长此授权项，仍受当前风险策略及总时长上限约束。' : '到期将重新进入复核，例外不会永久免审。'} />}
          {decision === 'exception' && <Form.Select field="exceptionOwnerId" label="例外责任人" filter style={{ width: '100%' }} optionList={reviewers.filter(person => person.value !== record?.userId)} rules={[{ required: true }]} />}
          {decision === 'escalate' && <>
            <Form.Select field="targetReviewerId" label="新复核负责人" filter style={{ width: '100%' }} optionList={reviewers.filter(person => person.value !== user?.id && person.value !== record?.userId)} rules={[{ required: true }]} />
            <Form.DatePicker field="dueAt" label="新截止时间" type="dateTime" format="yyyy-MM-dd HH:mm:ss" style={{ width: '100%' }} rules={[{ required: true }]} />
          </>}
          {needsMfa && <Form.Input field="mfaCode" label="本人动态验证码" inputMode="numeric" autoComplete="one-time-code" maxLength={6} rules={record?.riskLevel === 'critical' ? [{ required: true }, { pattern: /^\d{6}$/, message: '请输入六位数字验证码' }] : []} extraText="极高危及策略要求 MFA 的保留、延期和例外操作必须验证本人身份；未绑定时请先到个人中心绑定认证器。" />}
          <Form.TextArea field="remark" label="处置依据" rows={4} maxCount={1000} rules={[{ required: true, message: '请填写处置依据' }, { min: 2, message: '至少填写两个字' }]} />
        </>;
      }}
    </EditFormModal>
  </>;
}
