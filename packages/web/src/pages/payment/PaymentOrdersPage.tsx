import { useEffect, useState, useRef } from 'react';
import { formatYuan, PAYMENT_CHANNEL_TAG_COLOR } from '@/utils/payment';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, DatePicker, Form, Input, InputNumber, Select, Tabs, TabPane, Toast, Tag, Timeline, Typography, Modal, Descriptions } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import PaymentStatsPanel from './PaymentStatsPanel';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNEL_OPTIONS, PAYMENT_METHOD_LABELS, PAYMENT_ORDER_STATUS_LABELS, PAYMENT_REFUND_STATUS_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentMethod, PaymentOrder, PaymentOrderStatus, PaymentRefund, PaymentRefundStatus, CreatePaymentResult, PaymentStats } from '@zenith/shared';
import {
  paymentOrderKeys,
  useClosePaymentOrder,
  useCreatePaymentOrder,
  useCreatePaymentRefund,
  usePaymentOrderByNo,
  usePaymentOrderDetail,
  usePaymentOrderList,
  usePaymentOrderRefunds,
  useQueryPaymentOrder,
  useSimulatePaymentOrderPaid,
} from '@/hooks/queries/payment-orders';
import { usePaymentStats } from '@/hooks/queries/payment-stats';

const STATUS_COLOR = {
  pending: 'grey', paying: 'blue', success: 'green', closed: 'grey', refunding: 'amber', refunded: 'orange', failed: 'red',
} as const satisfies Record<PaymentOrderStatus, string>;
const REFUND_STATUS_COLOR = { pending: 'grey', processing: 'blue', success: 'green', failed: 'red' } as const satisfies Record<PaymentRefundStatus, string>;
const yuan = formatYuan;

interface SearchParams {
  keyword: string;
  channel: string;
  status: string;
  payMethod: string;
  bizType: string;
  minAmount: number | null;
  maxAmount: number | null;
  timeRange: [Date, Date] | null;
}
const defaultSearch: SearchParams = { keyword: '', channel: '', status: '', payMethod: '', bizType: '', minAmount: null, maxAmount: null, timeRange: null };

function StatCard({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Card style={{ flex: '1 1 150px', minWidth: 130 }} bodyStyle={{ padding: '10px 14px' }}>
      <Typography.Text type="tertiary" size="small">{label}</Typography.Text>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </Card>
  );
}

export default function PaymentOrdersPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canViewRefunds = hasPermission('payment:refund:list') || hasPermission('payment:order:refund');
  const refundFormApi = useRef<FormApi | null>(null);

  const [activeTab, setActiveTab] = useState<'list' | 'stats'>('list');
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);

  const [detail, setDetail] = useState<PaymentOrder | null>(null);
  const [refundTarget, setRefundTarget] = useState<PaymentOrder | null>(null);
  const [refundCheckTarget, setRefundCheckTarget] = useState<PaymentOrder | null>(null);
  const [refundedAmount, setRefundedAmount] = useState(0); // 已锁定退款总额（分）
  const [createVisible, setCreateVisible] = useState(false);
  const [payResult, setPayResult] = useState<CreatePaymentResult | null>(null);
  const createFormApi = useRef<FormApi | null>(null);

  function buildQuery(active: SearchParams): Record<string, string | number> {
    const q: Record<string, string | number> = {};
    if (active.keyword) q.keyword = active.keyword;
    if (active.channel) q.channel = active.channel;
    if (active.status) q.status = active.status;
    if (active.payMethod) q.payMethod = active.payMethod;
    if (active.bizType) q.bizType = active.bizType;
    if (active.minAmount != null) q.minAmount = Math.round(active.minAmount * 100);
    if (active.maxAmount != null) q.maxAmount = Math.round(active.maxAmount * 100);
    if (active.timeRange) {
      q.startTime = formatDateTimeForApi(active.timeRange[0]);
      q.endTime = formatDateTimeForApi(active.timeRange[1]);
    }
    return q;
  }

  const listQuery = usePaymentOrderList({ page, pageSize, ...buildQuery(submittedParams) });
  const data = listQuery.data ?? null;
  const statsQuery = usePaymentStats();
  const stats: PaymentStats | null = statsQuery.data ?? null;
  const detailQuery = usePaymentOrderDetail(detail?.id, !!detail);
  const detailOrder = detail ? (detailQuery.data ?? detail) : null;
  const detailRefundsQuery = usePaymentOrderRefunds(detail?.id, !!detail && canViewRefunds);
  const detailRefunds = detailRefundsQuery.data ?? [];
  const refundCheckQuery = usePaymentOrderRefunds(refundCheckTarget?.id, !!refundCheckTarget && canViewRefunds);
  const createOrderMutation = useCreatePaymentOrder();
  const queryOrderMutation = useQueryPaymentOrder();
  const simulateMutation = useSimulatePaymentOrderPaid();
  const closeMutation = useClosePaymentOrder();
  const createRefundMutation = useCreatePaymentRefund();
  const payStatusQuery = usePaymentOrderByNo(payResult?.orderNo, !!payResult?.orderNo);

  // ─── 支付状态轮询（QR 展示时每 3s 查单，付款成功/失败自动关闭）────────────────
  useEffect(() => {
    if (!payResult || !payStatusQuery.data) return;
    const { status } = payStatusQuery.data;
    if (status === 'success') {
      Toast.success('支付成功！');
      setPayResult(null);
      void queryClient.invalidateQueries({ queryKey: paymentOrderKeys.all });
    } else if (status === 'failed' || status === 'closed') {
      Toast.error(`支付${status === 'closed' ? '已关闭' : '失败'}`);
      setPayResult(null);
    }
  }, [payResult, payStatusQuery.data, queryClient]);

  useEffect(() => {
    if (!refundCheckTarget) return;
    if (canViewRefunds && refundCheckQuery.isFetching) return;
    const refunds = canViewRefunds ? (refundCheckQuery.data ?? []) : [];
    const locked = refunds
      .filter((r) => r.status === 'pending' || r.status === 'processing' || r.status === 'success')
      .reduce((s, r) => s + r.refundAmount, 0);
    if (refundCheckTarget.amount - locked <= 0) {
      Toast.warning('该订单暂无可退余额');
      setRefundTarget(null);
      setRefundCheckTarget(null);
      return;
    }
    setRefundedAmount(locked);
    setRefundTarget(refundCheckTarget);
    setRefundCheckTarget(null);
  }, [canViewRefunds, refundCheckQuery.data, refundCheckQuery.isFetching, refundCheckTarget]);

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: paymentOrderKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearch); setSubmittedParams(defaultSearch); setPage(1); void queryClient.invalidateQueries({ queryKey: paymentOrderKeys.lists }); }

  function openDetail(order: PaymentOrder) {
    setDetail(order);
  }

  async function handleQuery(record: PaymentOrder) {
    const order = await queryOrderMutation.mutateAsync(record.id);
    Toast.success(`最新状态：${PAYMENT_ORDER_STATUS_LABELS[order.status]}`);
  }
  async function handleSimulate(record: PaymentOrder) {
    await simulateMutation.mutateAsync(record.id);
    Toast.success('已模拟支付成功');
  }
  function handleClose(record: PaymentOrder) {
    Modal.confirm({
      title: '确认关闭订单', content: `确认关闭订单 ${record.orderNo}？`,
      onOk: async () => {
        await closeMutation.mutateAsync(record.id);
        Toast.success('订单已关闭');
      },
    });
  }

  function openRefundModal(order: PaymentOrder) {
    setRefundedAmount(0);
    setRefundTarget(null);
    setRefundCheckTarget(order);
  }

  async function submitRefund() {
    if (!refundTarget) return;
    const api = refundFormApi.current;
    if (!api) return;
    let values: { amountYuan: number; reason?: string };
    try { values = await api.validate(); } catch { throw new Error('validation'); }
    await createRefundMutation.mutateAsync({
      orderNo: refundTarget.orderNo,
      refundAmount: Math.round(values.amountYuan * 100),
      reason: values.reason,
    });
    Toast.success('退款已发起');
    setRefundTarget(null);
  }

  async function submitCreate() {
    const api = createFormApi.current;
    if (!api) return;
    let values: { subject: string; amount: number; bizType: string; bizId: string; payMethod: PaymentMethod; openId?: string };
    try { values = await api.validate(); } catch { throw new Error('validation'); }
    if (values.payMethod === 'wechat_jsapi' && !values.openId?.trim()) {
      Toast.error('微信 JSAPI 支付需要填写 OpenID');
      return;
    }
    const res = await createOrderMutation.mutateAsync({
      bizType: values.bizType, bizId: values.bizId, subject: values.subject,
      amount: Math.round(values.amount * 100), payMethod: values.payMethod, openId: values.openId?.trim() || undefined,
    });
    Toast.success('下单成功');
    setCreateVisible(false);
    setPayResult(res.payParams);
  }

  const columns: ColumnProps<PaymentOrder>[] = [
    { title: '订单号', dataIndex: 'orderNo', width: 200, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 180 }}>{v}</Typography.Text> },
    { title: '标题', dataIndex: 'subject', width: 180, render: (v: string) => v || '-' },
    { title: '金额', dataIndex: 'amount', width: 110, render: (v: number) => yuan(v) },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={PAYMENT_CHANNEL_TAG_COLOR[v]}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '方式', dataIndex: 'payMethod', width: 130, render: (v: PaymentMethod) => PAYMENT_METHOD_LABELS[v] },
    { title: '业务类型', dataIndex: 'bizType', width: 120, render: (v: string) => v || '-' },
    { title: '支付时间', dataIndex: 'paidAt', width: 170, render: (t: string | null) => (t ? formatDateTime(t) : '-') },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: PaymentOrderStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_ORDER_STATUS_LABELS[v]}</Tag>,
    },
    createOperationColumn<PaymentOrder>({
      width: 250,
      actions: (r) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => void openDetail(r),
        },
        ...(hasPermission('payment:order:list') && (r.status === 'paying' || r.status === 'pending') ? [{
          key: 'query',
          label: '查单',
          onClick: () => handleQuery(r),
        }] : []),
        ...(hasPermission('payment:ops:manage') && (r.status === 'paying' || r.status === 'pending') ? [{
          key: 'simulate',
          label: '模拟支付',
          type: 'warning' as const,
          onClick: () => void handleSimulate(r),
        }] : []),
        ...(hasPermission('payment:order:close') && (r.status === 'paying' || r.status === 'pending') ? [{
          key: 'close',
          label: '关闭',
          onClick: () => handleClose(r),
        }] : []),
        ...(hasPermission('payment:order:refund') && (r.status === 'success' || r.status === 'refunding') ? [{
          key: 'refund',
          label: '退款',
          danger: true,
          onClick: () => void openRefundModal(r),
        }] : []),
      ],
    }),
  ];

  const detailRefundColumns: ColumnProps<PaymentRefund>[] = [
    { title: '退款单号', dataIndex: 'refundNo', width: 180, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 160 }}>{v}</Typography.Text> },
    { title: '金额', dataIndex: 'refundAmount', width: 90, render: (v: number) => yuan(v) },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: PaymentRefundStatus) => <Tag color={REFUND_STATUS_COLOR[v]}>{PAYMENT_REFUND_STATUS_LABELS[v]}</Tag> },
    { title: '退款时间', dataIndex: 'refundedAt', width: 160, render: (t: string | null) => (t ? formatDateTime(t) : '-') },
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="订单号/标题..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      showClear
      style={{ width: 180 }}
      onEnterPress={handleSearch}
    />
  );

  const renderBizTypeFilter = () => (
    <Input
      placeholder="业务类型"
      value={draftParams.bizType}
      onChange={(v) => setDraftParams((p) => ({ ...p, bizType: v }))}
      showClear
      style={{ width: 120 }}
      onEnterPress={handleSearch}
    />
  );

  const renderChannelFilter = () => (
    <Select
      placeholder="全部渠道"
      value={draftParams.channel || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, channel: (v as string) ?? '' }))}
      showClear
      style={{ width: 110 }}
      optionList={PAYMENT_CHANNEL_OPTIONS}
    />
  );

  const renderPayMethodFilter = () => (
    <Select
      placeholder="支付方式"
      value={draftParams.payMethod || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, payMethod: (v as string) ?? '' }))}
      showClear
      style={{ width: 130 }}
      optionList={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 110 }}
      optionList={Object.entries(PAYMENT_ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );

  const renderMinAmountFilter = () => (
    <InputNumber
      placeholder="金额≥(元)"
      value={draftParams.minAmount ?? undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, minAmount: v !== '' && v != null ? Number(v) : null }))}
      min={0}
      hideButtons
      style={{ width: 110 }}
    />
  );

  const renderMaxAmountFilter = () => (
    <InputNumber
      placeholder="金额≤(元)"
      value={draftParams.maxAmount ?? undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, maxAmount: v !== '' && v != null ? Number(v) : null }))}
      min={0}
      hideButtons
      style={{ width: 110 }}
    />
  );

  const renderTimeRangeFilter = () => (
    <DatePicker
      type="dateTimeRange"
      placeholder={['创建开始', '创建结束']}
      value={draftParams.timeRange ?? undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, timeRange: v ? (v as [Date, Date]) : null }))}
      style={{ width: 330 }}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => hasPermission('payment:order:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateVisible(true)}>手动下单</Button>
  ) : null;
  const renderExportButtons = () => <ExportButton entity="payment.orders" query={buildQuery(submittedParams)} />;
  const renderMobileExportActions = () => <ExportButton entity="payment.orders" query={buildQuery(submittedParams)} variant="flat" />;

  return (
    <div className="page-container page-tabs-page">
      <Tabs activeKey={activeTab} onChange={(k) => setActiveTab(k as 'list' | 'stats')} type="line" lazyRender keepDOM={false}>
        <TabPane tab="支付订单" itemKey="list">
          {stats && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <StatCard label="累计成功金额" value={yuan(stats.totalAmount)} />
              <StatCard label="今日成功金额" value={yuan(stats.todayAmount)} />
              <StatCard label="订单总数" value={String(stats.orderCount)} />
              <StatCard label="成功订单" value={String(stats.successCount)} />
              <StatCard label="累计退款" value={yuan(stats.refundAmount)} />
            </div>
          )}
          <SearchToolbar
            primary={(
              <>
                {renderKeywordSearch()}
                {renderBizTypeFilter()}
                {renderChannelFilter()}
                {renderPayMethodFilter()}
                {renderStatusFilter()}
                {renderMinAmountFilter()}
                {renderMaxAmountFilter()}
                {renderTimeRangeFilter()}
                {renderSearchButton()}
                {renderResetButton()}
              </>
            )}
            actions={(
              <>
                {renderExportButtons()}
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
                {renderBizTypeFilter()}
                {renderChannelFilter()}
                {renderPayMethodFilter()}
                {renderStatusFilter()}
                {renderMinAmountFilter()}
                {renderMaxAmountFilter()}
                {renderTimeRangeFilter()}
              </>
            )}
            mobileActions={renderMobileExportActions()}
            filterTitle="支付订单筛选"
            onFilterApply={handleSearch}
            onFilterReset={handleReset}
          />

          <ConfigurableTable
            bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(data?.total ?? 0)}
          />
        </TabPane>
        <TabPane tab="统计分析" itemKey="stats">
          <PaymentStatsPanel />
        </TabPane>
      </Tabs>

      <AppModal title="订单详情" visible={!!detail} onCancel={() => setDetail(null)} footer={null} width={680} closeOnEsc>
        {detailOrder && (
          <>
            <Descriptions
              row
              data={[
                { key: '订单号', value: <Typography.Text copyable={{ content: detailOrder.orderNo }}>{detailOrder.orderNo}</Typography.Text> },
                { key: '商户单号', value: <Typography.Text copyable={{ content: detailOrder.outTradeNo }}>{detailOrder.outTradeNo}</Typography.Text> },
                { key: '渠道交易号', value: detailOrder.channelTradeNo ? <Typography.Text copyable={{ content: detailOrder.channelTradeNo }}>{detailOrder.channelTradeNo}</Typography.Text> : '-' },
                { key: '标题', value: detailOrder.subject },
                { key: '金额', value: yuan(detailOrder.amount) },
                { key: '实付', value: detailOrder.paidAmount == null ? '-' : yuan(detailOrder.paidAmount) },
                { key: '手续费', value: detailOrder.feeAmount == null ? '-' : yuan(detailOrder.feeAmount) },
                { key: '净额', value: detailOrder.netAmount == null ? '-' : yuan(detailOrder.netAmount) },
                { key: '渠道', value: PAYMENT_CHANNEL_LABELS[detailOrder.channel] },
                { key: '方式', value: PAYMENT_METHOD_LABELS[detailOrder.payMethod] },
                { key: '状态', value: <Tag color={STATUS_COLOR[detailOrder.status]}>{PAYMENT_ORDER_STATUS_LABELS[detailOrder.status]}</Tag> },
                { key: '业务类型', value: detailOrder.bizType },
                { key: '业务ID', value: detailOrder.bizId },
                { key: '支付时间', value: detailOrder.paidAt ? formatDateTime(detailOrder.paidAt) : '-' },
                { key: '过期时间', value: detailOrder.expiredAt ? formatDateTime(detailOrder.expiredAt) : '-' },
                { key: '创建时间', value: formatDateTime(detailOrder.createdAt) },
                { key: '错误信息', value: detailOrder.errorMessage ?? '-' },
              ]}
            />

            <Typography.Title heading={6} style={{ marginTop: 16, marginBottom: 8 }}>交易时间轴</Typography.Title>
            <Timeline mode="left">
              <Timeline.Item time={formatDateTime(detailOrder.createdAt)} type="default">创建订单</Timeline.Item>
              {detailOrder.paidAt && <Timeline.Item time={formatDateTime(detailOrder.paidAt)} type="success">支付成功 {detailOrder.paidAmount != null ? yuan(detailOrder.paidAmount) : ''}</Timeline.Item>}
              {detailRefunds.map((r) => (
                <Timeline.Item key={r.id} time={r.refundedAt ? formatDateTime(r.refundedAt) : formatDateTime(r.createdAt)} type={r.status === 'success' ? 'warning' : r.status === 'failed' ? 'error' : 'ongoing'}>
                  退款 {yuan(r.refundAmount)}（{PAYMENT_REFUND_STATUS_LABELS[r.status]}）
                </Timeline.Item>
              ))}
              {(detailOrder.status === 'closed' || detailOrder.status === 'failed') && (
                <Timeline.Item time={formatDateTime(detailOrder.updatedAt)} type="error">{PAYMENT_ORDER_STATUS_LABELS[detailOrder.status]}</Timeline.Item>
              )}
            </Timeline>

            {detailRefunds.length > 0 && (
              <>
                <Typography.Title heading={6} style={{ marginTop: 8, marginBottom: 8 }}>关联退款（{detailRefunds.length}）</Typography.Title>
                <ConfigurableTable
                  bordered
                  columns={detailRefundColumns}
                  dataSource={detailRefunds}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  onRefresh={() => { void detailRefundsQuery.refetch(); }}
                  refreshLoading={detailRefundsQuery.isFetching}
                />
              </>
            )}
          </>
        )}
      </AppModal>

      <AppModal title="发起退款" visible={!!refundTarget} onOk={submitRefund} onCancel={() => setRefundTarget(null)} okButtonProps={{ loading: createRefundMutation.isPending, type: 'danger' }} width={480} closeOnEsc>
        {refundTarget && (
          <Form key={refundTarget.id} getFormApi={(api) => { refundFormApi.current = api; }} labelPosition="left" labelWidth={90} initValues={{ amountYuan: (refundTarget.amount - refundedAmount) / 100 }}>
            <Form.Slot label="订单号">{refundTarget.orderNo}</Form.Slot>
            <Form.Slot label="订单金额">{yuan(refundTarget.amount)}</Form.Slot>
            {refundedAmount > 0 && <Form.Slot label="已退金额"><Typography.Text type="warning">{yuan(refundedAmount)}</Typography.Text></Form.Slot>}
            <Form.Slot label="剩余可退"><Typography.Text type="success">{yuan(refundTarget.amount - refundedAmount)}</Typography.Text></Form.Slot>
            <Form.InputNumber field="amountYuan" label="退款金额(元)" min={0.01} max={(refundTarget.amount - refundedAmount) / 100} precision={2} style={{ width: '100%' }} rules={[{ required: true, message: '请输入退款金额' }]} />
            <Form.TextArea field="reason" label="退款原因" autosize rows={2} maxCount={256} placeholder="可选" />
          </Form>
        )}
      </AppModal>

      <AppModal title="手动下单" visible={createVisible} onOk={submitCreate} onCancel={() => setCreateVisible(false)} okButtonProps={{ loading: createOrderMutation.isPending }} width={520} closeOnEsc>
        <Form key={createVisible ? 'c' : 'x'} getFormApi={(api) => { createFormApi.current = api; }} labelPosition="left" labelWidth={90} initValues={{ payMethod: 'wechat_native', amount: 1 }}>
          <Form.Input field="subject" label="商品标题" placeholder="如 会员充值" rules={[{ required: true, message: '请输入标题' }]} />
          <Form.InputNumber field="amount" label="金额(元)" min={0.01} precision={2} style={{ width: '100%' }} rules={[{ required: true, message: '请输入金额' }]} />
          <Form.Select field="payMethod" label="支付方式" style={{ width: '100%' }} optionList={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }))} rules={[{ required: true }]} />
          <Form.Input field="bizType" label="业务类型" placeholder="如 membership" rules={[{ required: true, message: '请输入业务类型' }]} />
          <Form.Input field="bizId" label="业务ID" placeholder="业务方订单ID" rules={[{ required: true, message: '请输入业务ID' }]} />
          <Form.Input field="openId" label="OpenID" placeholder="仅微信 JSAPI 需要" />
        </Form>
      </AppModal>

      <AppModal title="支付下单结果" visible={!!payResult} onCancel={() => setPayResult(null)} footer={null} width={420} closeOnEsc>
        {payResult && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 8 }}>订单号：{payResult.orderNo}</div>
            {payResult.codeUrl && (
              <>
                <QRCodeSVG value={payResult.codeUrl} size={200} style={{ margin: '12px auto', display: 'block' }} />
                <Typography.Text type="tertiary">请使用微信扫码支付</Typography.Text>
              </>
            )}
            {payResult.payUrl && (
              <div style={{ margin: '16px 0' }}>
                <Button type="primary" onClick={() => window.open(payResult.payUrl, '_blank', 'noopener')}>打开支付页</Button>
                <div style={{ marginTop: 8, wordBreak: 'break-all', fontSize: 12 }}><Typography.Text type="tertiary">{payResult.payUrl}</Typography.Text></div>
              </div>
            )}
            {payResult.appOrderStr && (
              <div style={{ margin: '12px 0', wordBreak: 'break-all', fontSize: 12, textAlign: 'left' }}>
                <Typography.Text type="tertiary">APP 调起参数（复制给客户端 SDK）：</Typography.Text>
                <div style={{ marginTop: 4 }}>{payResult.appOrderStr}</div>
              </div>
            )}
          </div>
        )}
      </AppModal>
    </div>
  );
}
