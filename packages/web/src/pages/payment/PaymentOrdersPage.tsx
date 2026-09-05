import { useEffect, useMemo, useRef, useState } from 'react';
import { formatYuan, getPaymentQrInstruction, PAYMENT_CHANNEL_TAG_COLOR } from '@/utils/payment';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Col, Divider, Form, Input, InputNumber, Row, SideSheet, Tabs, TabPane, Toast, Tag, Timeline, Typography, Modal, Descriptions } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import ConfigurableTable from '@/components/ConfigurableTable';
// 本页无图表：直接引组件文件，避免经桶文件带入 ~2MB 的 vchart
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import PaymentStatsPanel from './PaymentStatsPanel';
import { formatDateTime, formatDateTimeRangeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { enumValueOf, type BodyOf } from '@zenith/shared/core';
import { createPaymentSchema, PAYMENT_CASHIER_METHODS, PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNEL_OPTIONS, PAYMENT_CHANNELS, PAYMENT_METHOD_CHANNEL, PAYMENT_METHOD_LABELS, PAYMENT_ORDER_STATUS_LABELS, PAYMENT_ORDER_STATUSES, PAYMENT_REFUND_STATUS_LABELS, PAYMENT_METHOD_OPTIONS, PAYMENT_ORDER_STATUS_OPTIONS, paymentOrderContract } from '@zenith/shared/payment';
import type { CreateRefundInput, PaymentApp, PaymentCashierMethod, PaymentChannel, PaymentMethod, PaymentOrder, PaymentOrderStatus, PaymentRefund, PaymentRefundResult, PaymentRefundStatus, CreatePaymentResult, PaymentStats } from '@zenith/shared/payment';
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
  invalidatePaymentOrders,
  type PaymentOrderListParams,
} from '@/hooks/queries/payment-orders';
import { usePaymentStats } from '@/hooks/queries/payment-stats';
import { useListSearch } from '@/hooks/useListSearch';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { useEditModal } from '@/hooks/useEditModal';
import { copyableNoColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { abortSubmit } from '@/lib/abort-submit';
import { usePaymentAppList } from '@/hooks/queries/payment-apps';
import { usePaymentCapabilities } from '@/hooks/queries/payment-capabilities';
import { usePaymentMethodList } from '@/hooks/queries/payment-methods';

import { useUrlTabState } from '@/hooks/useUrlTabState';
const STATUS_COLOR = {
  pending: 'grey', paying: 'blue', success: 'green', closed: 'grey', refunding: 'amber', refunded: 'orange', failed: 'red',
  unknown: 'amber',
} as const satisfies Record<PaymentOrderStatus, string>;
const REFUND_STATUS_COLOR = { pending: 'grey', processing: 'blue', success: 'green', failed: 'red', unknown: 'amber' } as const satisfies Record<PaymentRefundStatus, string>;
const yuan = formatYuan;
const PAYMENT_CREATE_METHODS = createPaymentSchema.shape.payMethod.options;

function paymentAppConfigId(app: PaymentApp, channel: PaymentChannel): number | null {
  if (channel === 'wechat') return app.wechatConfigId ?? null;
  if (channel === 'alipay') return app.alipayConfigId ?? null;
  return app.unionpayConfigId ?? null;
}

interface SearchParams {
  keyword: string;
  channel?: string;
  status?: string;
  payMethod?: string;
  bizType: string;
  minAmount: number | null;
  maxAmount: number | null;
  timeRange: [Date, Date] | null;
}
const defaultSearch: SearchParams = { keyword: '', channel: undefined, status: undefined, payMethod: undefined, bizType: '', minAmount: null, maxAmount: null, timeRange: null };
interface ManualOrderFormValues { applicationId: number; subject: string; amount: number; bizType: string; bizId: string; payMethod: PaymentCashierMethod; openId?: string; }
interface ManualOrderRecord { id: number; orderNo: string; payParams: CreatePaymentResult; payMethod: PaymentCashierMethod; }
type CreateOrderPayload = BodyOf<typeof paymentOrderContract.createOrder>;
type RefundPayload = CreateRefundInput & { idempotencyKey: string };
interface RefundFormValues { amountYuan: number; reason?: string; }

export default function PaymentOrdersPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canViewRefunds = hasPermission('payment:refund:list') || hasPermission('payment:order:refund');
  const canReadCapabilities = hasPermission('payment:channel:list');

  const appsQuery = usePaymentAppList({ page: 1, pageSize: 100 });
  const paymentApps = useMemo(() => appsQuery.data?.list ?? [], [appsQuery.data?.list]);
  const appNameById = useMemo(
    () => new Map(paymentApps.map((app) => [app.id, app.name])),
    [paymentApps],
  );
  const enabledAppOptions = useMemo(
    () => paymentApps
      .filter((app) => app.status === 'enabled')
      .map((app) => ({
        value: app.id,
        label: `${app.name}（${app.environment === 'sandbox' ? '沙箱' : '生产'}）`,
      })),
    [paymentApps],
  );
  const capabilitiesQuery = usePaymentCapabilities(
    { operation: 'payment.create', currency: 'CNY' },
    canReadCapabilities,
  );
  const paymentMethodQuery = usePaymentMethodList();
  const enabledPaymentMethods = useMemo(
    () => paymentMethodQuery.data
      ? new Set(paymentMethodQuery.data.filter((config) => config.enabled).map((config) => config.method))
      : null,
    [paymentMethodQuery.data],
  );

  const [activeTab, setActiveTab] = useUrlTabState(['list', 'stats'] as const, 'list');
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: paymentOrderKeys.lists });

  const [detail, setDetail] = useState<PaymentOrder | null>(null);
  const [refundCheckTarget, setRefundCheckTarget] = useState<PaymentOrder | null>(null);
  const [refundedAmount, setRefundedAmount] = useState(0); // 已锁定退款总额（分）
  const [payResult, setPayResult] = useState<CreatePaymentResult | null>(null);
  const [payResultMethod, setPayResultMethod] = useState<PaymentMethod | null>(null);
  const [selectedApplicationId, setSelectedApplicationId] = useState<number>();
  const latestRefundResult = useRef<PaymentRefundResult | null>(null);
  const refundIdempotencyKey = useRef<string | null>(null);

  const selectedPaymentApp = paymentApps.find((app) => app.id === selectedApplicationId);
  const paymentMethodOptions = useMemo(() => {
    if (!selectedPaymentApp || !enabledPaymentMethods) return [];

    const appEnvironment = selectedPaymentApp.environment === 'sandbox' ? 'sandbox' : 'live';
    if (capabilitiesQuery.data) {
      const boundConfigIds = new Set(
        (['wechat', 'alipay', 'unionpay'] as const)
          .map((channel) => paymentAppConfigId(selectedPaymentApp, channel))
          .filter((id): id is number => id != null),
      );
      const supportedMethods = new Set<PaymentMethod>();
      for (const config of capabilitiesQuery.data.configs) {
        if (!boundConfigIds.has(config.channelConfigId) || config.environment !== appEnvironment) continue;
        for (const capability of config.capabilities) {
          if (capability.supported && capability.paymentMethod) supportedMethods.add(capability.paymentMethod);
        }
      }
      return PAYMENT_CREATE_METHODS
        .filter((method) => enabledPaymentMethods.has(method) && supportedMethods.has(method))
        .map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }));
    }

    // 无渠道能力查询权限或能力接口暂时不可用时，退化为应用已绑定渠道；服务端下单仍会做最终能力校验。
    if (!canReadCapabilities || capabilitiesQuery.isError) {
      return PAYMENT_CREATE_METHODS
        .filter((method) => enabledPaymentMethods.has(method) && paymentAppConfigId(selectedPaymentApp, PAYMENT_METHOD_CHANNEL[method]) != null)
        .map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }));
    }
    return [];
  }, [canReadCapabilities, capabilitiesQuery.data, capabilitiesQuery.isError, enabledPaymentMethods, selectedPaymentApp]);

  function buildQuery(active: SearchParams): Omit<PaymentOrderListParams, 'page' | 'pageSize'> {
    return {
      keyword: active.keyword || undefined,
      channel: enumValueOf(PAYMENT_CHANNELS, active.channel),
      status: enumValueOf(PAYMENT_ORDER_STATUSES, active.status),
      payMethod: enumValueOf(PAYMENT_CASHIER_METHODS, active.payMethod),
      bizType: active.bizType || undefined,
      minAmount: active.minAmount == null ? undefined : Math.round(active.minAmount * 100),
      maxAmount: active.maxAmount == null ? undefined : Math.round(active.maxAmount * 100),
      ...formatDateTimeRangeForApi(active.timeRange),
    };
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
  const refundSaveMutation = {
    mutateAsync: async ({ values }: { id?: number; values: RefundPayload }) => {
      const { idempotencyKey, ...body } = values;
      latestRefundResult.current = null;
      latestRefundResult.current = await createRefundMutation.mutateAsync({ headers: { 'x-idempotency-key': idempotencyKey }, body });
      return { id: 0 } as PaymentOrder;
    },
    isPending: createRefundMutation.isPending,
  };
  const refundModal = useEditModal<PaymentOrder, RefundFormValues, RefundPayload>({
    save: refundSaveMutation,
    toValues: (order) => ({ amountYuan: (order.amount - refundedAmount) / 100 }),
    beforeSave: (values, { editing }) => {
      if (!editing) abortSubmit('validation');
      if (!refundIdempotencyKey.current) {
        Toast.error('退款请求标识已失效，请关闭弹窗后重新发起');
        abortSubmit('validation');
      }
      return {
        orderNo: editing.orderNo,
        refundAmount: Math.round(values.amountYuan * 100),
        reason: values.reason?.trim(),
        idempotencyKey: refundIdempotencyKey.current,
      };
    },
    successMessage: () => null,
    onSaved: () => {
      const result = latestRefundResult.current;
      if (result?.status === 'pending') Toast.info('退款申请已提交，等待审批');
      else if (result?.status === 'success') Toast.success('退款已完成');
      else if (result?.status === 'processing') Toast.info('退款已提交渠道处理');
      else if (result?.status === 'unknown') Toast.warning('退款结果待确认，系统将继续查单');
      else if (result?.status === 'failed') Toast.error('退款渠道执行失败，请在退款记录查看原因');
      else Toast.success('退款申请已创建');
      refundIdempotencyKey.current = null;
    },
  });
  const openRefundEdit = refundModal.openEdit;
  const orderSaveMutation = {
    mutateAsync: async ({ values }: { id?: number; values: CreateOrderPayload }) => {
      const res = await createOrderMutation.mutateAsync({ body: values });
      return { id: 0, orderNo: res.orderNo, payParams: res.payParams, payMethod: values.payMethod };
    },
    isPending: createOrderMutation.isPending,
  };
  const createOrderModal = useEditModal<ManualOrderRecord, ManualOrderFormValues, CreateOrderPayload>({
    save: orderSaveMutation,
    defaults: { amount: 1 },
    beforeSave: (values) => {
      if (values.payMethod === 'wechat_jsapi' && !values.openId?.trim()) {
        Toast.error('微信 JSAPI 支付需要填写 OpenID');
        abortSubmit('validation');
      }
      return {
        applicationId: values.applicationId,
        bizType: values.bizType,
        bizId: values.bizId,
        subject: values.subject,
        amount: Math.round(values.amount * 100),
        payMethod: values.payMethod,
        openId: values.openId?.trim() || undefined,
      };
    },
    onSaved: (saved) => {
      setPayResultMethod(saved.payMethod);
      setPayResult(saved.payParams);
    },
    successMessage: () => '下单成功',
  });

  // ─── 支付状态轮询（QR 展示时每 3s 查单，付款成功/失败自动关闭）────────────────
  useEffect(() => {
    if (!payResult || !payStatusQuery.data) return;
    const { status } = payStatusQuery.data;
    if (status === 'success') {
      Toast.success('支付成功！');
      setPayResult(null);
      setPayResultMethod(null);
      invalidatePaymentOrders(queryClient);
    } else if (status === 'failed' || status === 'closed') {
      Toast.error(`支付${status === 'closed' ? '已关闭' : '失败'}`);
      setPayResult(null);
      setPayResultMethod(null);
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
      setRefundCheckTarget(null);
      return;
    }
    setRefundedAmount(locked);
    refundIdempotencyKey.current = crypto.randomUUID();
    openRefundEdit(refundCheckTarget);
    setRefundCheckTarget(null);
  }, [canViewRefunds, refundCheckQuery.data, refundCheckQuery.isFetching, refundCheckTarget, openRefundEdit]);

  function openDetail(order: PaymentOrder) {
    setDetail(order);
  }

  async function handleQuery(record: PaymentOrder) {
    const order = await queryOrderMutation.mutateAsync({ params: { id: record.id } });
    Toast.success(`最新状态：${PAYMENT_ORDER_STATUS_LABELS[order.status]}`);
  }
  async function handleSimulate(record: PaymentOrder) {
    await simulateMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('已模拟支付成功');
  }
  function handleClose(record: PaymentOrder) {
    Modal.confirm({
      title: '确认关闭订单', content: `确认关闭订单 ${record.orderNo}？`,
      onOk: async () => {
        await closeMutation.mutateAsync({ params: { id: record.id } });
        Toast.success('订单已关闭');
      },
    });
  }

  function openRefundModal(order: PaymentOrder) {
    setRefundedAmount(0);
    setRefundCheckTarget(order);
  }

  const columns: ColumnProps<PaymentOrder>[] = [
    copyableNoColumn('订单号', 'orderNo'),
    { title: '标题', dataIndex: 'subject', minWidth: 240, render: renderEllipsis },
    { title: '支付应用', dataIndex: 'appId', width: 200, render: (value: number) => renderEllipsis(appNameById.get(value) ?? `应用 #${value}`) },
    { title: '金额', dataIndex: 'amount', width: 110, align: 'right', render: (v: number) => yuan(v) },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={PAYMENT_CHANNEL_TAG_COLOR[v]}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '方式', dataIndex: 'payMethod', width: 150, render: (v: PaymentMethod) => PAYMENT_METHOD_LABELS[v] },
    { title: '业务类型', dataIndex: 'bizType', width: 240, render: renderEllipsis },
    dateTimeColumn('支付时间', 'paidAt'),
    dateTimeColumn('创建时间', 'createdAt'),
    {
      title: '状态', dataIndex: 'status', width: 110, fixed: 'right',
      render: (v: PaymentOrderStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_ORDER_STATUS_LABELS[v]}</Tag>,
    },
    createOperationColumn<PaymentOrder>({
      width: 180,
      desktopInlineKeys: ['detail', 'refund'],
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
    copyableNoColumn('退款单号', 'refundNo'),
    { title: '金额', dataIndex: 'refundAmount', width: 90, align: 'right', render: (v: number) => yuan(v) },
    { title: '状态', dataIndex: 'status', width: 110, render: (v: PaymentRefundStatus) => <Tag color={REFUND_STATUS_COLOR[v]}>{PAYMENT_REFUND_STATUS_LABELS[v]}</Tag> },
    dateTimeColumn('退款时间', 'refundedAt'),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="订单号/标题..." value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} width={180} />
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
    <FilterSelect
      placeholder="全部渠道"
      items={PAYMENT_CHANNEL_OPTIONS}
      value={draftParams.channel}
      onChange={(v) => setDraftParams((p) => ({ ...p, channel: v }))}
    />
  );

  const renderPayMethodFilter = () => (
    <FilterSelect
      placeholder="全部支付方式"
      items={PAYMENT_METHOD_OPTIONS}
      value={draftParams.payMethod}
      onChange={(v) => setDraftParams((p) => ({ ...p, payMethod: v }))}
      width={140}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={PAYMENT_ORDER_STATUS_OPTIONS}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
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
    <DateRangeFilter placeholder={['创建开始', '创建结束']} value={draftParams.timeRange ?? undefined} onChange={(v) => setDraftParams((p) => ({ ...p, timeRange: v ? (v as [Date, Date]) : null }))} width={330} />
  );

  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const openCreateOrder = () => {
    setSelectedApplicationId(undefined);
    createOrderModal.openCreate();
  };
  const renderCreateButton = () => hasPermission('payment:order:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreateOrder}>手动下单</Button>
  ) : null;
  const renderExportButtons = () => <ExportButton entity="payment.orders" query={buildQuery(submittedParams)} />;
  const renderMobileExportActions = () => <ExportButton entity="payment.orders" query={buildQuery(submittedParams)} variant="flat" />;

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" activeKey={activeTab} onChange={(k) => setActiveTab(k as 'list' | 'stats')} type="line" lazyRender keepDOM={false}>
        <TabPane tab="支付订单" itemKey="list">
          {stats && (
            <StatGrid minItemWidth={150} style={{ marginBottom: 12 }}>
              <StatCard title="累计成功金额" value={yuan(stats.totalAmount)} />
              <StatCard title="今日成功金额" value={yuan(stats.todayAmount)} />
              <StatCard title="订单总数" value={String(stats.orderCount)} />
              <StatCard title="成功订单" value={String(stats.successCount)} />
              <StatCard title="累计退款" value={yuan(stats.refundAmount)} />
            </StatGrid>
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

      <SideSheet title="订单详情" visible={!!detail} onCancel={() => setDetail(null)} width={560} closeOnEsc>
        {detailOrder && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24 }}>
            {/* 摘要头：金额 + 状态一眼定位，标题弱化随行 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
                  {yuan(detailOrder.paidAmount ?? detailOrder.amount)}
                </span>
                <Tag color={STATUS_COLOR[detailOrder.status]} size="large">{PAYMENT_ORDER_STATUS_LABELS[detailOrder.status]}</Tag>
              </div>
              <Typography.Text type="tertiary" style={{ marginTop: 4, display: 'block' }}>{detailOrder.subject}</Typography.Text>
            </div>

            {/* 金额构成微指标：仅在产生费用/差异时有信息量，占一行不占块 */}
            <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              {[
                { label: '订单金额', value: yuan(detailOrder.amount) },
                { label: '手续费', value: detailOrder.feeAmount == null ? '—' : yuan(detailOrder.feeAmount) },
                { label: '净额', value: detailOrder.netAmount == null ? '—' : yuan(detailOrder.netAmount) },
              ].map((it) => (
                <div key={it.label}>
                  <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>{it.label}</Typography.Text>
                  <Typography.Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{it.value}</Typography.Text>
                </div>
              ))}
            </div>

            {detailOrder.errorMessage && (
              <Banner type="danger" closeIcon={null} description={detailOrder.errorMessage} />
            )}

            <div>
              <Divider align="left" style={{ margin: '4px 0 10px' }}>单号</Divider>
              <Descriptions
                align="plain"
                layout="horizontal"
                column={1}
                size="small"
                data={[
                  { key: '订单号', value: <Typography.Text copyable={{ content: detailOrder.orderNo }}>{detailOrder.orderNo}</Typography.Text> },
                  { key: '商户单号', value: <Typography.Text copyable={{ content: detailOrder.outTradeNo }}>{detailOrder.outTradeNo}</Typography.Text> },
                  ...(detailOrder.channelTradeNo ? [{ key: '渠道交易号', value: <Typography.Text copyable={{ content: detailOrder.channelTradeNo }}>{detailOrder.channelTradeNo}</Typography.Text> }] : []),
                ]}
              />
            </div>

            <div>
              <Divider align="left" style={{ margin: '4px 0 10px' }}>业务与渠道</Divider>
              <Descriptions
                align="plain"
                layout="horizontal"
                column={2}
                size="small"
                data={[
                  { key: '支付应用', value: appNameById.get(detailOrder.appId) ?? `应用 #${detailOrder.appId}` },
                  { key: '渠道', value: PAYMENT_CHANNEL_LABELS[detailOrder.channel] },
                  { key: '方式', value: PAYMENT_METHOD_LABELS[detailOrder.payMethod] },
                  { key: '业务类型', value: detailOrder.bizType },
                  { key: '业务ID', value: detailOrder.bizId },
                ]}
              />
            </div>

            <div>
              <Divider align="left" style={{ margin: '4px 0 10px' }}>时间</Divider>
              <Descriptions
                align="plain"
                layout="horizontal"
                column={2}
                size="small"
                data={[
                  { key: '创建时间', value: formatDateTime(detailOrder.createdAt) },
                  { key: '过期时间', value: detailOrder.expiredAt ? formatDateTime(detailOrder.expiredAt) : '—' },
                  ...(detailOrder.paidAt ? [{ key: '支付时间', value: formatDateTime(detailOrder.paidAt) }] : []),
                ]}
              />
            </div>

            <div>
              <Divider align="left" style={{ margin: '4px 0 10px' }}>交易时间轴</Divider>
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
            </div>

            {detailRefunds.length > 0 && (
              <div>
                <Divider align="left" style={{ margin: '4px 0 10px' }}>关联退款（{detailRefunds.length}）</Divider>
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
              </div>
            )}
          </div>
        )}
      </SideSheet>

      <AppModal
        {...refundModal.modalProps}
        title="发起退款"
        onCancel={() => {
          refundIdempotencyKey.current = null;
          refundModal.close();
        }}
        okButtonProps={{ ...refundModal.modalProps.okButtonProps, type: 'danger' }}
        width={480}
      >
        {refundModal.editing && (
          <Form key={refundModal.formKey} {...refundModal.formProps}>
            <Form.Slot label="订单号">{refundModal.editing.orderNo}</Form.Slot>
            <Form.Slot label="订单金额">{yuan(refundModal.editing.amount)}</Form.Slot>
            {refundedAmount > 0 && <Form.Slot label="已退金额"><Typography.Text type="warning">{yuan(refundedAmount)}</Typography.Text></Form.Slot>}
            <Form.Slot label="剩余可退"><Typography.Text type="success">{yuan(refundModal.editing.amount - refundedAmount)}</Typography.Text></Form.Slot>
            <Form.InputNumber field="amountYuan" label="退款金额(元)" min={0.01} max={(refundModal.editing.amount - refundedAmount) / 100} precision={2} style={{ width: '100%' }} rules={[{ required: true, message: '请输入退款金额' }]} />
            <Form.TextArea
              field="reason"
              label="退款原因"
              autosize
              rows={2}
              maxCount={256}
              placeholder="请填写退款背景和依据"
              rules={[
                { required: true, message: '请填写退款原因' },
                { validator: (_rule: unknown, value: unknown) => Boolean(String(value ?? '').trim()), message: '退款原因不能只包含空格' },
              ]}
            />
          </Form>
        )}
      </AppModal>

      <AppModal {...createOrderModal.modalProps} title="手动下单" width={660}>
        <Form key={createOrderModal.formKey} {...createOrderModal.formProps}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select
                field="applicationId"
                label="支付应用"
                placeholder="请选择启用的支付应用"
                style={{ width: '100%' }}
                optionList={enabledAppOptions}
                loading={appsQuery.isFetching}
                filter
                onChange={(value) => {
                  setSelectedApplicationId(value as number | undefined);
                  createOrderModal.formApi.current?.setValue('payMethod', undefined);
                }}
                rules={[{ required: true, message: '请选择支付应用' }]}
              />
            </Col>
            <Col span={12}>
              <Form.Select
                field="payMethod"
                label="支付方式"
                placeholder={selectedPaymentApp ? '请选择应用支持的支付方式' : '请先选择支付应用'}
                style={{ width: '100%' }}
                optionList={paymentMethodOptions}
                loading={canReadCapabilities && capabilitiesQuery.isFetching}
                disabled={!selectedPaymentApp || (canReadCapabilities && capabilitiesQuery.isFetching) || paymentMethodOptions.length === 0}
                rules={[{ required: true, message: '请选择支付方式' }]}
              />
            </Col>
          </Row>
          {selectedPaymentApp && (!canReadCapabilities || capabilitiesQuery.isError) && (
            <Banner
              type="warning"
              closeIcon={null}
              description="暂时无法读取渠道实时能力，支付方式按应用已绑定渠道展示，提交时仍由服务端校验。"
            />
          )}
          {selectedPaymentApp && capabilitiesQuery.data && paymentMethodOptions.length === 0 && (
            <Banner
              type="warning"
              closeIcon={null}
              description="该应用当前没有可用的支付下单能力，请先检查支付应用与商户渠道配置。"
            />
          )}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="subject" label="商品标题" placeholder="如 会员充值" rules={[{ required: true, message: '请输入标题' }]} />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="amount" label="金额(元)" min={0.01} precision={2} style={{ width: '100%' }} rules={[{ required: true, message: '请输入金额' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="bizType" label="业务类型" placeholder="如 membership" rules={[{ required: true, message: '请输入业务类型' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="bizId" label="业务ID" placeholder="业务方订单ID" rules={[{ required: true, message: '请输入业务ID' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="openId" label="OpenID" placeholder="仅微信 JSAPI 需要" />
            </Col>
          </Row>
        </Form>
      </AppModal>

      <AppModal title="支付下单结果" visible={!!payResult} onCancel={() => { setPayResult(null); setPayResultMethod(null); }} footer={null} width={420} closeOnEsc>
        {payResult && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 8 }}>订单号：{payResult.orderNo}</div>
            {payResult.codeUrl && (
              <>
                <QRCodeSVG value={payResult.codeUrl} size={200} style={{ margin: '12px auto', display: 'block' }} />
                <Typography.Text type="tertiary">{getPaymentQrInstruction(payResultMethod)}</Typography.Text>
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
