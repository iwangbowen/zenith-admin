import { useState, useEffect, useCallback, useRef } from 'react';
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
import { request } from '@/utils/request';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_ORDER_STATUS_LABELS, PAYMENT_REFUND_STATUS_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentMethod, PaymentOrder, PaymentOrderStatus, PaymentRefund, PaymentRefundStatus, CreatePaymentResult, PaginatedResponse } from '@zenith/shared';

const STATUS_COLOR = {
  pending: 'grey', paying: 'blue', success: 'green', closed: 'grey', refunding: 'amber', refunded: 'orange', failed: 'red',
} as const satisfies Record<PaymentOrderStatus, string>;
const REFUND_STATUS_COLOR = { pending: 'grey', processing: 'blue', success: 'green', failed: 'red' } as const satisfies Record<PaymentRefundStatus, string>;
const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

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

interface PaymentStatsData {
  totalAmount: number; todayAmount: number; orderCount: number; successCount: number; refundAmount: number; refundRate: number;
}

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
  const canViewRefunds = hasPermission('payment:refund:list') || hasPermission('payment:order:refund');
  const refundFormApi = useRef<FormApi | null>(null);

  const [activeTab, setActiveTab] = useState<'list' | 'stats'>('list');
  const [data, setData] = useState<PaginatedResponse<PaymentOrder> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = searchParams;

  const [detail, setDetail] = useState<PaymentOrder | null>(null);
  const [detailRefunds, setDetailRefunds] = useState<PaymentRefund[]>([]);
  const [refundTarget, setRefundTarget] = useState<PaymentOrder | null>(null);
  const [refundedAmount, setRefundedAmount] = useState(0); // 已锁定退款总额（分）
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [stats, setStats] = useState<PaymentStatsData | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [payResult, setPayResult] = useState<CreatePaymentResult | null>(null);
  const createFormApi = useRef<FormApi | null>(null);

  function buildQuery(active: SearchParams): Record<string, string> {
    const q: Record<string, string> = {};
    if (active.keyword) q.keyword = active.keyword;
    if (active.channel) q.channel = active.channel;
    if (active.status) q.status = active.status;
    if (active.payMethod) q.payMethod = active.payMethod;
    if (active.bizType) q.bizType = active.bizType;
    if (active.minAmount != null) q.minAmount = String(Math.round(active.minAmount * 100));
    if (active.maxAmount != null) q.maxAmount = String(Math.round(active.maxAmount * 100));
    if (active.timeRange) {
      q.startTime = formatDateTimeForApi(active.timeRange[0]);
      q.endTime = formatDateTimeForApi(active.timeRange[1]);
    }
    return q;
  }

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const active = params ?? searchRef.current;
      setLoading(true);
      try {
        const query = { page: String(p), pageSize: String(ps), ...buildQuery(active) };
        const res = await request.get<PaginatedResponse<PaymentOrder>>(`/api/payment/orders?${new URLSearchParams(query)}`);
        if (res.code === 0) { setData(res.data); setPage(res.data.page); setPageSize(res.data.pageSize); }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, pageSize],
  );

  const fetchStats = useCallback(async () => {
    const res = await request.get<PaymentStatsData>('/api/payment/stats');
    if (res.code === 0) setStats(res.data);
  }, []);

  useEffect(() => {
    void fetchList();
    void fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 支付状态轮询（QR 展示时每 3s 查单，付款成功/失败自动关闭）────────────────
  useEffect(() => {
    if (!payResult) return;
    const orderNo = payResult.orderNo;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      const res = await request.get<PaymentOrder>(`/api/payment/orders/by-no/${encodeURIComponent(orderNo)}`);
      if (stopped) return;
      if (res.code === 0) {
        const { status } = res.data;
        if (status === 'success') {
          Toast.success('支付成功！');
          setPayResult(null);
          void fetchList();
          void fetchStats();
        } else if (status === 'failed' || status === 'closed') {
          Toast.error(`支付${status === 'closed' ? '已关闭' : '失败'}`);
          setPayResult(null);
        } else {
          setTimeout(() => { void poll(); }, 3000);
        }
      } else {
        setTimeout(() => { void poll(); }, 3000);
      }
    };
    setTimeout(() => { void poll(); }, 3000);
    return () => { stopped = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payResult?.orderNo]);

  function handleSearch() { setPage(1); void fetchList(1, pageSize); }
  function handleReset() { setSearchParams(defaultSearch); setPage(1); void fetchList(1, pageSize, defaultSearch); }

  async function fetchOrderRefunds(orderId: number): Promise<PaymentRefund[]> {
    if (!canViewRefunds) return [];
    const res = await request.get<PaymentRefund[]>(`/api/payment/orders/${orderId}/refunds`);
    return res.code === 0 ? res.data : [];
  }

  async function openDetail(order: PaymentOrder) {
    setDetail(order);
    setDetailRefunds([]);
    setDetailRefunds(await fetchOrderRefunds(order.id));
  }

  async function handleQuery(record: PaymentOrder) {
    const res = await request.post<PaymentOrder>(`/api/payment/orders/${record.id}/query`);
    if (res.code === 0) { Toast.success(`最新状态：${PAYMENT_ORDER_STATUS_LABELS[res.data.status]}`); void fetchList(); void fetchStats(); }
  }
  async function handleSimulate(record: PaymentOrder) {
    const res = await request.post<PaymentOrder>(`/api/payment/ops/orders/${record.id}/simulate-paid`, {});
    if (res.code === 0) { Toast.success('已模拟支付成功'); void fetchList(); void fetchStats(); }
    else Toast.error(res.message);
  }
  function handleClose(record: PaymentOrder) {
    Modal.confirm({
      title: '确认关闭订单', content: `确认关闭订单 ${record.orderNo}？`,
      onOk: async () => {
        const res = await request.post(`/api/payment/orders/${record.id}/close`);
        if (res.code === 0) { Toast.success('订单已关闭'); void fetchList(); }
      },
    });
  }

  async function openRefundModal(order: PaymentOrder) {
    setRefundedAmount(0);
    const refunds = await fetchOrderRefunds(order.id);
    const locked = refunds
      .filter((r) => r.status === 'pending' || r.status === 'processing' || r.status === 'success')
      .reduce((s, r) => s + r.refundAmount, 0);
    if (order.amount - locked <= 0) {
      Toast.warning('该订单暂无可退余额');
      setRefundTarget(null);
      return;
    }
    setRefundedAmount(locked);
    setRefundTarget(order);
  }

  async function submitRefund() {
    if (!refundTarget) return;
    const api = refundFormApi.current;
    if (!api) return;
    let values: { amountYuan: number; reason?: string };
    try { values = await api.validate(); } catch { throw new Error('validation'); }
    setRefundSubmitting(true);
    try {
      const res = await request.post('/api/payment/refunds', {
        orderNo: refundTarget.orderNo,
        refundAmount: Math.round(values.amountYuan * 100),
        reason: values.reason,
      });
      if (res.code === 0) { Toast.success('退款已发起'); setRefundTarget(null); void fetchList(); void fetchStats(); }
      else throw new Error(res.message);
    } finally {
      setRefundSubmitting(false);
    }
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
    setCreateSubmitting(true);
    try {
      const res = await request.post<{ orderNo: string; payParams: CreatePaymentResult }>('/api/payment/orders', {
        bizType: values.bizType, bizId: values.bizId, subject: values.subject,
        amount: Math.round(values.amount * 100), payMethod: values.payMethod, openId: values.openId?.trim() || undefined,
      });
      if (res.code === 0) { Toast.success('下单成功'); setCreateVisible(false); setPayResult(res.data.payParams); void fetchList(); void fetchStats(); }
      else throw new Error(res.message);
    } finally {
      setCreateSubmitting(false);
    }
  }

  const columns: ColumnProps<PaymentOrder>[] = [
    { title: '订单号', dataIndex: 'orderNo', width: 200, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 180 }}>{v}</Typography.Text> },
    { title: '标题', dataIndex: 'subject', width: 180, render: (v: string) => v || '-' },
    { title: '金额', dataIndex: 'amount', width: 110, render: (v: number) => yuan(v) },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={v === 'wechat' ? 'green' : 'blue'}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
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
      value={searchParams.keyword}
      onChange={(v) => setSearchParams((p) => ({ ...p, keyword: v }))}
      showClear
      style={{ width: 180 }}
      onEnterPress={handleSearch}
    />
  );

  const renderBizTypeFilter = () => (
    <Input
      placeholder="业务类型"
      value={searchParams.bizType}
      onChange={(v) => setSearchParams((p) => ({ ...p, bizType: v }))}
      showClear
      style={{ width: 120 }}
      onEnterPress={handleSearch}
    />
  );

  const renderChannelFilter = () => (
    <Select
      placeholder="全部渠道"
      value={searchParams.channel || undefined}
      onChange={(v) => setSearchParams((p) => ({ ...p, channel: (v as string) ?? '' }))}
      showClear
      style={{ width: 110 }}
      optionList={[{ value: 'wechat', label: '微信支付' }, { value: 'alipay', label: '支付宝' }]}
    />
  );

  const renderPayMethodFilter = () => (
    <Select
      placeholder="支付方式"
      value={searchParams.payMethod || undefined}
      onChange={(v) => setSearchParams((p) => ({ ...p, payMethod: (v as string) ?? '' }))}
      showClear
      style={{ width: 130 }}
      optionList={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={searchParams.status || undefined}
      onChange={(v) => setSearchParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 110 }}
      optionList={Object.entries(PAYMENT_ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );

  const renderMinAmountFilter = () => (
    <InputNumber
      placeholder="金额≥(元)"
      value={searchParams.minAmount ?? undefined}
      onChange={(v) => setSearchParams((p) => ({ ...p, minAmount: v !== '' && v != null ? Number(v) : null }))}
      min={0}
      hideButtons
      style={{ width: 110 }}
    />
  );

  const renderMaxAmountFilter = () => (
    <InputNumber
      placeholder="金额≤(元)"
      value={searchParams.maxAmount ?? undefined}
      onChange={(v) => setSearchParams((p) => ({ ...p, maxAmount: v !== '' && v != null ? Number(v) : null }))}
      min={0}
      hideButtons
      style={{ width: 110 }}
    />
  );

  const renderTimeRangeFilter = () => (
    <DatePicker
      type="dateTimeRange"
      placeholder={['创建开始', '创建结束']}
      value={searchParams.timeRange ?? undefined}
      onChange={(v) => setSearchParams((p) => ({ ...p, timeRange: v ? (v as [Date, Date]) : null }))}
      style={{ width: 330 }}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => hasPermission('payment:order:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateVisible(true)}>手动下单</Button>
  ) : null;
  const renderExportButtons = () => <ExportButton entity="payment.orders" query={buildQuery(searchRef.current)} />;
  const renderMobileExportActions = () => <ExportButton entity="payment.orders" query={buildQuery(searchRef.current)} variant="flat" />;

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
            bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)}
          />
        </TabPane>
        <TabPane tab="统计分析" itemKey="stats">
          <PaymentStatsPanel />
        </TabPane>
      </Tabs>

      <AppModal title="订单详情" visible={!!detail} onCancel={() => setDetail(null)} footer={null} width={680} closeOnEsc>
        {detail && (
          <>
            <Descriptions
              row
              data={[
                { key: '订单号', value: <Typography.Text copyable={{ content: detail.orderNo }}>{detail.orderNo}</Typography.Text> },
                { key: '商户单号', value: <Typography.Text copyable={{ content: detail.outTradeNo }}>{detail.outTradeNo}</Typography.Text> },
                { key: '渠道交易号', value: detail.channelTradeNo ? <Typography.Text copyable={{ content: detail.channelTradeNo }}>{detail.channelTradeNo}</Typography.Text> : '-' },
                { key: '标题', value: detail.subject },
                { key: '金额', value: yuan(detail.amount) },
                { key: '实付', value: detail.paidAmount == null ? '-' : yuan(detail.paidAmount) },
                { key: '手续费', value: detail.feeAmount == null ? '-' : yuan(detail.feeAmount) },
                { key: '净额', value: detail.netAmount == null ? '-' : yuan(detail.netAmount) },
                { key: '渠道', value: PAYMENT_CHANNEL_LABELS[detail.channel] },
                { key: '方式', value: PAYMENT_METHOD_LABELS[detail.payMethod] },
                { key: '状态', value: <Tag color={STATUS_COLOR[detail.status]}>{PAYMENT_ORDER_STATUS_LABELS[detail.status]}</Tag> },
                { key: '业务类型', value: detail.bizType },
                { key: '业务ID', value: detail.bizId },
                { key: '支付时间', value: detail.paidAt ? formatDateTime(detail.paidAt) : '-' },
                { key: '过期时间', value: detail.expiredAt ? formatDateTime(detail.expiredAt) : '-' },
                { key: '创建时间', value: formatDateTime(detail.createdAt) },
                { key: '错误信息', value: detail.errorMessage ?? '-' },
              ]}
            />

            <Typography.Title heading={6} style={{ marginTop: 16, marginBottom: 8 }}>交易时间轴</Typography.Title>
            <Timeline mode="left">
              <Timeline.Item time={formatDateTime(detail.createdAt)} type="default">创建订单</Timeline.Item>
              {detail.paidAt && <Timeline.Item time={formatDateTime(detail.paidAt)} type="success">支付成功 {detail.paidAmount != null ? yuan(detail.paidAmount) : ''}</Timeline.Item>}
              {detailRefunds.map((r) => (
                <Timeline.Item key={r.id} time={r.refundedAt ? formatDateTime(r.refundedAt) : formatDateTime(r.createdAt)} type={r.status === 'success' ? 'warning' : r.status === 'failed' ? 'error' : 'ongoing'}>
                  退款 {yuan(r.refundAmount)}（{PAYMENT_REFUND_STATUS_LABELS[r.status]}）
                </Timeline.Item>
              ))}
              {(detail.status === 'closed' || detail.status === 'failed') && (
                <Timeline.Item time={formatDateTime(detail.updatedAt)} type="error">{PAYMENT_ORDER_STATUS_LABELS[detail.status]}</Timeline.Item>
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
                  onRefresh={() => { if (detail) void fetchOrderRefunds(detail.id).then(setDetailRefunds); }}
                  refreshLoading={false}
                />
              </>
            )}
          </>
        )}
      </AppModal>

      <AppModal title="发起退款" visible={!!refundTarget} onOk={submitRefund} onCancel={() => setRefundTarget(null)} okButtonProps={{ loading: refundSubmitting, type: 'danger' }} width={480} closeOnEsc>
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

      <AppModal title="手动下单" visible={createVisible} onOk={submitCreate} onCancel={() => setCreateVisible(false)} okButtonProps={{ loading: createSubmitting }} width={520} closeOnEsc>
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
