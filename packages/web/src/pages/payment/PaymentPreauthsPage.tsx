import { useMemo, useState, useRef } from 'react';
import { formatYuan } from '@/utils/payment';
import { Banner, Button, Col, Form, Input, Modal, Row, Select, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { copyableNoColumn, createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { usePaymentAppList } from '@/hooks/queries/payment-apps';
import {
  paymentPreauthKeys,
  useCapturePaymentPreauth,
  useCreatePaymentPreauth,
  usePaymentPreauthList,
  useRecoverPaymentPreauth,
  useReleasePaymentPreauth,
} from '@/hooks/queries/payment-preauths';
import { enumValueOf } from '@zenith/shared/core';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNELS, PAYMENT_PREAUTH_STATUS_LABELS, PAYMENT_PREAUTH_STATUS_OPTIONS, PAYMENT_PREAUTH_STATUSES, PAYMENT_CHANNEL_OPTIONS } from '@zenith/shared/payment';
import type { CreatePaymentPreauthInput, PaymentChannel, PaymentPreauth, PaymentPreauthMethod, PaymentPreauthStatus } from '@zenith/shared/payment';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';

const yuan = formatYuan;
const STATUS_COLOR = { pending: 'grey', unknown: 'orange', frozen: 'blue', captured: 'green', released: 'teal', failed: 'red' } as const satisfies Record<PaymentPreauthStatus, string>;
const channelOptions = PAYMENT_CHANNEL_OPTIONS;
const PREAUTH_METHOD_OPTIONS = [
  { value: 'wechat_preauth', label: '微信预授权' },
  { value: 'alipay_preauth', label: '支付宝预授权' },
];

interface PreauthFormValues { applicationId: number; payMethod: PaymentPreauthMethod; currency: 'CNY'; payerAccount: string; subject: string; amountYuan: number; bizType?: string; bizId: string; remark?: string; }

interface SearchParams { keyword: string; status?: string; channel?: string }
const defaultSearchParams: SearchParams = { keyword: '', status: undefined, channel: '' };

export default function PaymentPreauthsPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('payment:preauth:manage');
  const latestCreateResult = useRef<PaymentPreauth | null>(null);
  const {
    page, pageSize, setPage, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch({ defaults: defaultSearchParams, listKey: paymentPreauthKeys.lists });
  const [captureTarget, setCaptureTarget] = useState<PaymentPreauth | null>(null);
  const [captureAmountYuan, setCaptureAmountYuan] = useState('');
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const [preauthAppId, setPreauthAppId] = useState<number | null>(null);

  const appsQuery = usePaymentAppList({ page: 1, pageSize: 100, status: 'enabled' });
  const paymentApps = useMemo(() => appsQuery.data?.list ?? [], [appsQuery.data?.list]);
  const appById = useMemo(() => new Map(paymentApps.map((app) => [app.id, app])), [paymentApps]);
  const appOptions = useMemo(
    () => paymentApps.map((app) => ({ value: app.id, label: `${app.name} · ${app.environment === 'sandbox' ? '沙箱' : '生产'}` })),
    [paymentApps],
  );
  const effectivePreauthAppId = preauthAppId ?? paymentApps[0]?.id;

  const listQuery = usePaymentPreauthList({
    applicationId: effectivePreauthAppId ?? 0,
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(PAYMENT_PREAUTH_STATUSES, submittedParams.status),
    channel: enumValueOf(PAYMENT_CHANNELS, submittedParams.channel),
  }, effectivePreauthAppId != null);
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const preauthMethodOptions = useMemo(() => {
    const app = selectedAppId == null ? null : appById.get(selectedAppId);
    return PREAUTH_METHOD_OPTIONS.filter((option) => option.value === 'wechat_preauth' ? app?.wechatConfigId != null : app?.alipayConfigId != null);
  }, [appById, selectedAppId]);
  const createMutation = useCreatePaymentPreauth();
  const captureMutation = useCapturePaymentPreauth();
  const releaseMutation = useReleasePaymentPreauth();
  const recoverMutation = useRecoverPaymentPreauth();

  const createSaveMutation = {
    mutateAsync: async ({ values }: { id?: number; values: CreatePaymentPreauthInput }) => {
      const res = await createMutation.mutateAsync({ body: values });
      latestCreateResult.current = res;
      setPreauthAppId(res.appId);
      return res;
    },
    isPending: createMutation.isPending,
  };
  const createModal = useEditModal<PaymentPreauth, PreauthFormValues, CreatePaymentPreauthInput>({
    save: createSaveMutation,
    defaults: { currency: 'CNY' },
    beforeSave: (values) => ({
      applicationId: values.applicationId,
      payMethod: values.payMethod,
      currency: values.currency,
      payerAccount: values.payerAccount,
      subject: values.subject,
      frozenAmount: Math.round(values.amountYuan * 100),
      bizType: values.bizType || undefined,
      bizId: values.bizId,
      remark: values.remark || undefined,
    }),
    successMessage: () => {
      const res = latestCreateResult.current;
      if (res?.status === 'frozen') return '冻结成功';
      if (res?.status === 'failed') return `冻结失败：${res.errorMessage ?? '未知原因'}`;
      return '冻结请求已受理';
    },
    labelWidth: 110,
  });

  function openCapture(r: PaymentPreauth) {
    setCaptureAmountYuan('');
    setCaptureTarget(r);
  }

  async function handleCaptureOk() {
    if (!captureTarget) return;
    const amount = captureAmountYuan.trim() ? Math.round(Number(captureAmountYuan) * 100) : undefined;
    if (captureAmountYuan.trim() && (!Number.isFinite(amount) || (amount as number) <= 0)) {
      Toast.warning('转支付金额格式不正确');
      return;
    }
    if (amount != null && amount > captureTarget.frozenAmount) {
      Toast.warning('转支付金额不能超过冻结金额');
      return;
    }
    const res = await captureMutation.mutateAsync({ params: { id: captureTarget.id }, query: { applicationId: captureTarget.appId }, body: { captureAmount: amount } });
    Toast.success(`转支付成功（订单 ${res.captureOrderNo}）`);
    setCaptureTarget(null);
  }

  function handleRelease(r: PaymentPreauth) {
    Modal.confirm({
      title: '解冻该预授权？',
      content: `将全额释放冻结资金 ${yuan(r.frozenAmount)}`,
      onOk: async () => {
        await releaseMutation.mutateAsync({ params: { id: r.id }, query: { applicationId: r.appId } });
        Toast.success('已解冻');
      },
    });
  }

  async function handleRecover(record: PaymentPreauth) {
    const result = await recoverMutation.mutateAsync({ params: { id: record.id }, query: { applicationId: record.appId } });
    Toast.info(`查询完成：${PAYMENT_PREAUTH_STATUS_LABELS[result.status]}`);
  }

  const columns: ColumnProps<PaymentPreauth>[] = [
    copyableNoColumn('预授权单号', 'preauthNo'),
    { title: '支付应用', dataIndex: 'appId', width: 200, render: (value: number) => renderEllipsis(appById.get(value)?.name ?? `应用 #${value}`) },
    { title: '渠道', dataIndex: 'channel', width: 90, render: (v: PaymentChannel) => PAYMENT_CHANNEL_LABELS[v] },
    { title: '冻结事由', dataIndex: 'subject', minWidth: 180, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{v}</Typography.Text> },
    { title: '付款人', dataIndex: 'payerAccount', width: 150, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 130 }}>{v}</Typography.Text> },
    { title: '冻结金额', dataIndex: 'frozenAmount', width: 110, align: 'right', render: (v: number) => yuan(v) },
    { title: '转支付金额', dataIndex: 'capturedAmount', width: 110, align: 'right', render: (v: number | null) => (v == null ? '-' : yuan(v)) },
    copyableNoColumn('转支付订单', 'captureOrderNo'),
    { title: '币种/版本', width: 100, render: (_: unknown, record: PaymentPreauth) => `${record.currency} · v${record.version}` },
    dateTimeColumn('冻结时间', 'frozenAt'),
    createdAtColumn as ColumnProps<PaymentPreauth>,
    { title: '状态', dataIndex: 'status', width: 110, fixed: 'right', render: (v: PaymentPreauthStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_PREAUTH_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentPreauth>({
      width: 170,
      actions: (r) => canManage ? [
        ...(r.status === 'frozen' ? [{
          key: 'capture',
          label: '转支付',
          onClick: () => openCapture(r),
        }, {
          key: 'release',
          label: '解冻',
          danger: true,
          onClick: () => handleRelease(r),
        }] : []),
        ...(r.status === 'pending' || r.status === 'unknown' ? [{
          key: 'recover',
          label: '查单恢复',
          loading: recoverMutation.isPending && recoverMutation.variables?.params.id === r.id,
          onClick: () => { void handleRecover(r); },
        }] : []),
      ] : [],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="预授权单号/付款人/事由..." value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
  );
  const renderAppFilter = () => (
    <Select
      placeholder="支付应用"
      value={effectivePreauthAppId}
      onChange={(value) => {
        setPreauthAppId(value as number);
        setPage(1);
      }}
      optionList={appOptions}
      filter
      loading={appsQuery.isFetching}
      style={{ width: 180 }}
    />
  );
  const renderStatusFilter = () => (
    <StatusSelect items={PAYMENT_PREAUTH_STATUS_OPTIONS} value={draftParams.status} onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))} />
  );
  const renderChannelFilter = () => (
    <FilterSelect
      placeholder="全部渠道"
      items={channelOptions}
      value={draftParams.channel}
      onChange={(v) => setDraftParams((p) => ({ ...p, channel: v }))}
    />
  );
  const renderSearchButton = () => <SearchButton onClick={handleSearch} disabled={effectivePreauthAppId == null} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const renderCreateButton = () => canManage ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={() => { setSelectedAppId(null); createModal.openCreate(); }}>发起冻结</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderAppFilter()}
            {renderStatusFilter()}
            {renderChannelFilter()}
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
            {renderStatusFilter()}
            {renderChannelFilter()}
          </>
        )}
        filterTitle="预授权筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data} loading={appsQuery.isFetching || listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(total)}
      />

      <AppModal {...createModal.modalProps} title="发起预授权冻结" width={660}>
        <Banner type="warning" closeIcon={null} style={{ marginBottom: 16 }}
          description="资金冻结操作（押金场景）：冻结成功计入渠道账户冻结余额，可转支付或解冻；沙箱渠道即时生效。" />
        <Form key={createModal.formKey} {...createModal.formProps}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="applicationId" label="支付应用" style={{ width: '100%' }} optionList={appOptions} filter loading={appsQuery.isFetching}
                onChange={(value) => { setSelectedAppId((value as number | undefined) ?? null); createModal.formApi.current?.setValue('payMethod', undefined); }} rules={[{ required: true, message: '请选择支付应用' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="payMethod" label="预授权方式" style={{ width: '100%' }} optionList={preauthMethodOptions} disabled={selectedAppId == null} rules={[{ required: true, message: '请选择方式' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="currency" label="币种" style={{ width: '100%' }} optionList={[{ value: 'CNY', label: 'CNY · 人民币' }]} disabled rules={[{ required: true, message: '请选择币种' }]} />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="amountYuan" label="冻结金额(元)" min={0.01} step={0.01} precision={2} style={{ width: '100%' }} rules={[{ required: true, message: '请输入冻结金额' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="payerAccount" label="付款人账号" placeholder="微信 openid / 支付宝账号" rules={[{ required: true, message: '付款人账号不能为空' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="subject" label="冻结事由" placeholder="如：民宿押金" rules={[{ required: true, message: '冻结事由不能为空' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="bizType" label="业务类型" placeholder="可选，默认 admin_preauth" />
            </Col>
            <Col span={12}>
              <Form.Input field="bizId" label="业务单号" placeholder="业务侧唯一单号" rules={[{ required: true, message: '请输入业务单号' }]} />
            </Col>
          </Row>
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>

      <AppModal title="预授权转支付" visible={captureTarget != null} onOk={handleCaptureOk} onCancel={() => setCaptureTarget(null)} okButtonProps={{ loading: captureMutation.isPending }} width={460} closeOnEsc>
        {captureTarget && (
          <>
            <Typography.Paragraph style={{ marginBottom: 12 }}>
              冻结金额 <strong>{yuan(captureTarget.frozenAmount)}</strong>，转支付后剩余部分自动解冻，并生成正式交易订单。
            </Typography.Paragraph>
            <Input placeholder={`转支付金额(元)，留空 = 全额 ${(captureTarget.frozenAmount / 100).toFixed(2)}`} value={captureAmountYuan} onChange={setCaptureAmountYuan} />
          </>
        )}
      </AppModal>
    </div>
  );
}
