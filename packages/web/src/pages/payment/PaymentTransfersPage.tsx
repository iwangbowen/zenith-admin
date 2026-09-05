import { useMemo, useRef, useState } from 'react';
import { formatYuan, PAYMENT_CHANNEL_TAG_COLOR } from '@/utils/payment';
import { Banner, Button, Col, Form, Input, Row, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { SendHorizontal } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { copyableNoColumn, createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useAuth } from '@/hooks/useAuth';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import { usePaymentAppList } from '@/hooks/queries/payment-apps';
import {
  paymentTransferKeys,
  useApprovePaymentTransfer,
  useCreatePaymentTransfer,
  usePaymentTransferList,
  usePaymentTransferSummary,
  useQueryPaymentTransfer,
  useRejectPaymentTransfer,
} from '@/hooks/queries/payment-transfers';
import { enumValueOf } from '@zenith/shared/core';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNEL_OPTIONS, PAYMENT_CHANNELS, PAYMENT_TRANSFER_APPROVAL_STATUS_LABELS, PAYMENT_TRANSFER_APPROVAL_STATUSES, PAYMENT_TRANSFER_STATUS_LABELS, PAYMENT_TRANSFER_STATUS_OPTIONS, PAYMENT_TRANSFER_STATUSES, PAYMENT_TRANSFER_APPROVAL_STATUS_OPTIONS } from '@zenith/shared/payment';
import type {
  CreatePaymentTransferInput,
  PaymentChannel,
  PaymentTransfer,
  PaymentTransferApprovalStatus,
  PaymentTransferStatus,
} from '@zenith/shared/payment';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';

const yuan = formatYuan;
const STATUS_COLOR = { pending: 'grey', processing: 'blue', unknown: 'orange', success: 'green', failed: 'red' } as const satisfies Record<PaymentTransferStatus, string>;
const APPROVAL_COLOR = { none: 'grey', pending: 'orange', approved: 'green', rejected: 'red' } as const satisfies Record<PaymentTransferApprovalStatus, string>;

interface SearchParams { keyword: string; channel?: string; status?: string; approvalStatus?: string; }
const defaultSearch: SearchParams = { keyword: '', channel: undefined, status: undefined, approvalStatus: '' };

interface TransferFormValues {
  applicationId: number;
  channel: PaymentChannel;
  currency: 'CNY';
  receiverAccount: string;
  receiverName?: string;
  amountYuan: number;
  remark: string;
  bizType?: string;
  bizId?: string;
}

export default function PaymentTransfersPage() {
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const canCreate = hasPermission('payment:transfer:create');
  const latestTransfer = useRef<PaymentTransfer | null>(null);
  const transferIdempotencyKey = useRef<string | null>(null);
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const [approveTarget, setApproveTarget] = useState<PaymentTransfer | null>(null);
  const [approveRemark, setApproveRemark] = useState('');
  const [rejectTarget, setRejectTarget] = useState<PaymentTransfer | null>(null);
  const [rejectRemark, setRejectRemark] = useState('');
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: paymentTransferKeys.lists });

  const listQuery = usePaymentTransferList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    channel: enumValueOf(PAYMENT_CHANNELS, submittedParams.channel),
    status: enumValueOf(PAYMENT_TRANSFER_STATUSES, submittedParams.status),
    approvalStatus: enumValueOf(PAYMENT_TRANSFER_APPROVAL_STATUSES, submittedParams.approvalStatus),
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const summaryQuery = usePaymentTransferSummary();
  const summary = summaryQuery.data ?? null;
  const appsQuery = usePaymentAppList({ page: 1, pageSize: 100, status: 'enabled' });
  const paymentApps = useMemo(() => appsQuery.data?.list ?? [], [appsQuery.data?.list]);
  const appById = useMemo(() => new Map(paymentApps.map((app) => [app.id, app])), [paymentApps]);
  const appOptions = useMemo(
    () => paymentApps.map((app) => ({ value: app.id, label: `${app.name} · ${app.environment === 'sandbox' ? '沙箱' : '生产'}` })),
    [paymentApps],
  );
  const createChannelOptions = useMemo(() => {
    const app = selectedAppId == null ? null : appById.get(selectedAppId);
    return [
      ...(app?.wechatConfigId ? [{ value: 'wechat', label: '微信支付（零钱）' }] : []),
      ...(app?.alipayConfigId ? [{ value: 'alipay', label: '支付宝（账户）' }] : []),
      ...(app?.unionpayConfigId ? [{ value: 'unionpay', label: '云闪付' }] : []),
    ];
  }, [appById, selectedAppId]);
  const createMutation = useCreatePaymentTransfer();
  const queryMutation = useQueryPaymentTransfer();
  const approveMutation = useApprovePaymentTransfer();
  const rejectMutation = useRejectPaymentTransfer();

  const transferSaveMutation = {
    // 幂等键按一次表单提交意图生成：校验失败重试沿用同一个键，成功后清空，下一笔转账换新键
    mutateAsync: async ({ values }: { id?: number; values: CreatePaymentTransferInput }) => {
      const idempotencyKey = transferIdempotencyKey.current ?? (transferIdempotencyKey.current = crypto.randomUUID());
      const transfer = await createMutation.mutateAsync({ headers: { 'x-idempotency-key': idempotencyKey }, body: values });
      latestTransfer.current = transfer;
      transferIdempotencyKey.current = null;
      return transfer;
    },
    isPending: createMutation.isPending,
  };
  const transferModal = useEditModal<PaymentTransfer, TransferFormValues, CreatePaymentTransferInput>({
    save: transferSaveMutation,
    defaults: { currency: 'CNY' },
    beforeSave: (values) => ({
      applicationId: values.applicationId,
      channel: values.channel,
      currency: values.currency,
      receiverAccount: values.receiverAccount,
      receiverName: values.receiverName || undefined,
      amount: Math.round(values.amountYuan * 100),
      remark: values.remark.trim(),
      bizType: values.bizType || undefined,
      bizId: values.bizId || undefined,
    }),
    successMessage: () => {
      const transfer = latestTransfer.current;
      if (transfer?.status === 'failed') return `渠道转账失败：${transfer.failReason ?? '未知原因'}，请重新发起转账`;
      if (transfer?.approvalStatus === 'pending') return '转账申请已提交，资金已预占并等待审批';
      return transfer?.status === 'success' ? '转账成功' : '转账已受理，处理中';
    },
    labelWidth: 110,
  });

  async function handleQuery(id: number) {
    const t = await queryMutation.mutateAsync({ params: { id } });
    Toast.info(`当前状态：${PAYMENT_TRANSFER_STATUS_LABELS[t.status]}`);
  }

  function openApprove(record: PaymentTransfer) {
    setApproveTarget(record);
    setApproveRemark('');
  }

  async function submitApprove() {
    if (!approveTarget) return;
    const remark = approveRemark.trim();
    if (!remark) { Toast.warning('请填写审批意见'); return; }
    const transfer = await approveMutation.mutateAsync({ params: { id: approveTarget.id }, body: { remark } });
    Toast.success(transfer.status === 'success' ? '审批通过，转账已成功' : '审批通过，转账已提交渠道处理');
    setApproveTarget(null);
  }

  function openReject(record: PaymentTransfer) {
    setRejectTarget(record);
    setRejectRemark('');
  }

  async function submitReject() {
    if (!rejectTarget) return;
    const remark = rejectRemark.trim();
    if (!remark) { Toast.warning('请填写驳回原因'); return; }
    await rejectMutation.mutateAsync({ params: { id: rejectTarget.id }, body: { remark } });
    Toast.success('转账已驳回，资金预占已释放');
    setRejectTarget(null);
  }

  const columns: ColumnProps<PaymentTransfer>[] = [
    copyableNoColumn('转账单号', 'transferNo'),
    { title: '支付应用', dataIndex: 'appId', width: 200, render: (value: number) => renderEllipsis(appById.get(value)?.name ?? `应用 #${value}`) },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={PAYMENT_CHANNEL_TAG_COLOR[v]}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '收款账号', dataIndex: 'receiverAccount', width: 180, render: (v: string, r: PaymentTransfer) => (
      <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{r.receiverName ? `${r.receiverName}（${v}）` : v}</Typography.Text>
    ) },
    { title: '金额', dataIndex: 'amount', width: 110, align: 'right', render: (v: number) => <Typography.Text type="danger">{yuan(v)}</Typography.Text> },
    copyableNoColumn('资金预占 ID', 'fundReservationId', { width: 130 }),
    copyableNoColumn('渠道单号', 'channelTransferNo', { width: 300 }),
    { title: '失败原因', dataIndex: 'failReason', minWidth: 180, render: (v: string | null) => (v ? <Typography.Text type="danger" ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{v}</Typography.Text> : '-') },
    { title: '审批意见', dataIndex: 'approvalRemark', width: 180, render: (v: string | null) => (v ? <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{v}</Typography.Text> : '-') },
    { title: '备注', dataIndex: 'remark', width: 140, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{v || '-'}</Typography.Text> },
    { title: '操作人', dataIndex: 'operatorName', width: 110, render: renderEllipsis },
    { title: '币种/版本', width: 100, render: (_: unknown, record: PaymentTransfer) => `${record.currency} · v${record.version}` },
    dateTimeColumn('完成时间', 'finishedAt'),
    createdAtColumn as ColumnProps<PaymentTransfer>,
    {
      title: '审批', dataIndex: 'approvalStatus', width: 100, fixed: 'right',
      render: (v: PaymentTransferApprovalStatus) => (v === 'none'
        ? <Typography.Text type="tertiary">-</Typography.Text>
        : <Tag color={APPROVAL_COLOR[v]}>{PAYMENT_TRANSFER_APPROVAL_STATUS_LABELS[v]}</Tag>),
    },
    { title: '状态', dataIndex: 'status', width: 110, fixed: 'right', render: (v: PaymentTransferStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_TRANSFER_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentTransfer>({
      width: 120,
      desktopInlineKeys: ['approve'],
      actions: (r) => [
        ...(r.status === 'processing' || r.status === 'unknown' ? [{
          key: 'query',
          label: '查单',
          onClick: () => void handleQuery(r.id),
        }] : []),
        ...(r.approvalStatus === 'pending' && hasPermission('payment:transfer:approve') ? [{
          key: 'approve',
          label: '通过',
          type: 'primary' as const,
          loading: approveMutation.isPending && approveMutation.variables?.params.id === r.id,
          disabled: r.appliedById != null && r.appliedById === user?.id,
          disabledReason: '转账申请人与审批人必须为不同用户',
          onClick: () => openApprove(r),
        }, {
          key: 'reject',
          label: '驳回',
          danger: true,
          loading: rejectMutation.isPending && rejectMutation.variables?.params.id === r.id,
          onClick: () => openReject(r),
        }] : []),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="转账单号 / 收款账号..." value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
  );
  const renderChannelFilter = () => (
    <FilterSelect
      placeholder="全部渠道"
      items={PAYMENT_CHANNEL_OPTIONS}
      value={draftParams.channel}
      onChange={(v) => setDraftParams((p) => ({ ...p, channel: v }))}
    />
  );
  const renderStatusFilter = () => (
    <StatusSelect
      items={PAYMENT_TRANSFER_STATUS_OPTIONS}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );
  const renderApprovalFilter = () => (
    <FilterSelect
      placeholder="全部审批状态"
      items={PAYMENT_TRANSFER_APPROVAL_STATUS_OPTIONS}
      value={draftParams.approvalStatus}
      onChange={(v) => setDraftParams((p) => ({ ...p, approvalStatus: v }))}
      width={140}
    />
  );
  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const renderCreateButton = () => canCreate ? (
    <Button type="primary" icon={<SendHorizontal size={14} />} onClick={() => { setSelectedAppId(null); transferIdempotencyKey.current = crypto.randomUUID(); transferModal.openCreate(); }}>发起转账</Button>
  ) : null;

  const summaryText = summary
    ? `累计转出 ${yuan(summary.totalAmount)}（成功 ${summary.successCount} 笔 · 处理中 ${summary.processingCount} 笔 · 失败 ${summary.failedCount} 笔）`
    : '';

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderChannelFilter()}
            {renderStatusFilter()}
            {renderApprovalFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderChannelFilter()}
            {renderStatusFilter()}
            {renderApprovalFilter()}
          </>
        )}
        filterTitle="转账单筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {summaryText && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text type="tertiary">{summaryText}</Typography.Text>
        </div>
      )}

      <ConfigurableTable
        bordered columns={columns} dataSource={data} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => { void listQuery.refetch(); void summaryQuery.refetch(); }} refreshLoading={listQuery.isFetching} pagination={buildPagination(total)}
      />

      <AppModal
        {...transferModal.modalProps}
        title="发起转账"
        width={660}
        onCancel={() => {
          if (createMutation.isPending) return;
          transferIdempotencyKey.current = null;
          transferModal.modalProps.onCancel?.();
        }}
      >
        <Banner type="warning" closeIcon={null} style={{ marginBottom: 16 }}
          description="资金流出操作：微信渠道收款账号为用户 openid（转入零钱），支付宝渠道为登录账号。沙箱渠道为模拟转账。" />
        <Form key={transferModal.formKey} {...transferModal.formProps}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="applicationId" label="支付应用" style={{ width: '100%' }} optionList={appOptions} filter loading={appsQuery.isFetching}
                onChange={(value) => { setSelectedAppId((value as number | undefined) ?? null); transferModal.formApi.current?.setValue('channel', undefined); }} rules={[{ required: true, message: '请选择支付应用' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="channel" label="渠道" style={{ width: '100%' }}
                optionList={createChannelOptions} disabled={selectedAppId == null} rules={[{ required: true, message: '请选择渠道' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="currency" label="币种" style={{ width: '100%' }} optionList={[{ value: 'CNY', label: 'CNY · 人民币' }]} disabled rules={[{ required: true, message: '请选择币种' }]} />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="amountYuan" label="转账金额(元)" min={0.01} step={0.01} precision={2} style={{ width: '100%' }} rules={[{ required: true, message: '请输入转账金额' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="receiverAccount" label="收款账号" placeholder="微信 openid / 支付宝登录账号" rules={[{ required: true, message: '收款账号不能为空' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="receiverName" label="收款人姓名" placeholder="可选（支付宝大额建议填写校验）" />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="bizType" label="业务类型" placeholder="可选" />
            </Col>
            <Col span={12}>
              <Form.Input field="bizId" label="业务单号" placeholder="可选" />
            </Col>
          </Row>
          <Form.TextArea
            field="remark"
            label="转账原因"
            autosize
            rows={2}
            maxCount={256}
            placeholder="请填写资金用途和转账依据"
            rules={[
              { required: true, message: '请填写转账原因' },
              { validator: (_rule: unknown, value: unknown) => Boolean(String(value ?? '').trim()), message: '转账原因不能只包含空格' },
            ]}
          />
        </Form>
      </AppModal>

      <AppModal
        title="审批通过转账"
        visible={!!approveTarget}
        onOk={submitApprove}
        onCancel={() => { if (!approveMutation.isPending) setApproveTarget(null); }}
        okText="确认通过并转账"
        okButtonProps={{ loading: approveMutation.isPending }}
        width={480}
        closeOnEsc
      >
        {approveTarget && (
          <Form labelPosition="left" labelWidth={92}>
            <Form.Slot label="转账单号">{approveTarget.transferNo}</Form.Slot>
            <Form.Slot label="收款账号">{approveTarget.receiverName ? `${approveTarget.receiverName}（${approveTarget.receiverAccount}）` : approveTarget.receiverAccount}</Form.Slot>
            <Form.Slot label="转账金额"><Typography.Text type="danger" strong>{yuan(approveTarget.amount)}</Typography.Text></Form.Slot>
            <Form.Slot label="申请原因">{approveTarget.remark || '-'}</Form.Slot>
            <Form.Slot label="审批意见">
              <Input value={approveRemark} onChange={setApproveRemark} placeholder="请填写审批依据（必填）" maxLength={256} showClear />
            </Form.Slot>
          </Form>
        )}
      </AppModal>

      <AppModal
        title="驳回转账"
        visible={!!rejectTarget}
        onOk={submitReject}
        onCancel={() => { if (!rejectMutation.isPending) setRejectTarget(null); }}
        okText="确认驳回"
        okButtonProps={{ loading: rejectMutation.isPending, type: 'danger' }}
        width={480}
        closeOnEsc
      >
        {rejectTarget && (
          <Form labelPosition="left" labelWidth={92}>
            <Form.Slot label="转账单号">{rejectTarget.transferNo}</Form.Slot>
            <Form.Slot label="收款账号">{rejectTarget.receiverName ? `${rejectTarget.receiverName}（${rejectTarget.receiverAccount}）` : rejectTarget.receiverAccount}</Form.Slot>
            <Form.Slot label="转账金额"><Typography.Text type="danger" strong>{yuan(rejectTarget.amount)}</Typography.Text></Form.Slot>
            <Form.Slot label="申请原因">{rejectTarget.remark || '-'}</Form.Slot>
            <Form.Slot label="驳回原因">
              <Input value={rejectRemark} onChange={setRejectRemark} placeholder="请填写驳回原因（必填）" maxLength={256} showClear />
            </Form.Slot>
          </Form>
        )}
      </AppModal>
    </div>
  );
}
