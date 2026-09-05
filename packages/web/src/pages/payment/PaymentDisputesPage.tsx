import { useState } from 'react';
import { formatYuan } from '@/utils/payment';
import { Banner, Button, Input, Modal, SideSheet, Spin, Tag, TextArea, Timeline, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { FlaskConical } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { copyableNoColumn, createdAtColumn } from '@/utils/table-columns';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import {
  paymentDisputeKeys,
  usePaymentDisputeDetail,
  usePaymentDisputeList,
  usePaymentDisputeStats,
  useRefundPaymentDispute,
  useReplyPaymentDispute,
  useResolvePaymentDispute,
  useSimulatePaymentDispute,
} from '@/hooks/queries/payment-disputes';
import { enumValueOf } from '@zenith/shared/core';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNELS, PAYMENT_DISPUTE_ROUTE_LABELS, PAYMENT_DISPUTE_ROUTE_OPTIONS, PAYMENT_DISPUTE_ROUTES, PAYMENT_DISPUTE_STATUS_LABELS, PAYMENT_DISPUTE_STATUS_OPTIONS, PAYMENT_DISPUTE_STATUSES, PAYMENT_DISPUTE_TYPE_LABELS, PAYMENT_DISPUTE_TYPE_OPTIONS, PAYMENT_DISPUTE_TYPES, PAYMENT_ORDER_STATUS_LABELS, PAYMENT_CHANNEL_OPTIONS } from '@zenith/shared/payment';
import type { PaymentChannel, PaymentDispute, PaymentDisputeRoute, PaymentDisputeStatus, PaymentDisputeType } from '@zenith/shared/payment';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDanger } from '@/utils/confirm';

const yuan = formatYuan;
const STATUS_COLOR = { pending: 'red', processing: 'blue', resolved: 'green', refunded: 'purple' } as const satisfies Record<PaymentDisputeStatus, string>;
const ROUTE_COLOR = { urgent: 'red', manual: 'grey', auto_refund_suggest: 'orange' } as const satisfies Record<PaymentDisputeRoute, string>;
const channelOptions = PAYMENT_CHANNEL_OPTIONS;
const REPLY_AUTHOR_LABELS = { merchant: '商户', user: '投诉人', system: '系统' } as const;

interface SearchParams { keyword: string; status?: string; type?: string; channel?: string; route?: string }
const defaultSearchParams: SearchParams = { keyword: '', status: undefined, type: undefined, channel: undefined, route: '' };

export default function PaymentDisputesPage() {
  const { hasPermission } = usePermission();
  const canHandle = hasPermission('payment:dispute:handle');
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch({ defaults: defaultSearchParams, listKey: paymentDisputeKeys.lists });
  const [detailId, setDetailId] = useState<number | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [refundAmountYuan, setRefundAmountYuan] = useState<string>('');

  const listQuery = usePaymentDisputeList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(PAYMENT_DISPUTE_STATUSES, submittedParams.status),
    type: enumValueOf(PAYMENT_DISPUTE_TYPES, submittedParams.type),
    channel: enumValueOf(PAYMENT_CHANNELS, submittedParams.channel),
    route: enumValueOf(PAYMENT_DISPUTE_ROUTES, submittedParams.route),
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const statsQuery = usePaymentDisputeStats();
  const stats = statsQuery.data ?? null;
  const detailQuery = usePaymentDisputeDetail(detailId ?? undefined);
  const detail = detailQuery.data ?? null;

  const replyMutation = useReplyPaymentDispute();
  const resolveMutation = useResolvePaymentDispute();
  const refundMutation = useRefundPaymentDispute();
  const simulateMutation = useSimulatePaymentDispute();

  async function handleSimulate() {
    const d = await simulateMutation.mutateAsync({ body: {} });
    Toast.success(`已生成模拟投诉 ${d.disputeNo}`);
  }

  function openDetail(id: number) {
    setReplyContent('');
    setRefundAmountYuan('');
    setDetailId(id);
  }

  async function handleReply() {
    if (!detailId || !replyContent.trim()) {
      Toast.warning('请输入回复内容');
      return;
    }
    await replyMutation.mutateAsync({ params: { id: detailId }, body: { content: replyContent.trim() } });
    setReplyContent('');
    Toast.success('回复成功');
  }

  function handleResolve() {
    if (!detailId) return;
    Modal.confirm({
      title: '完结该投诉？',
      content: '确认已与投诉人协商解决，无需退款',
      onOk: async () => {
        await resolveMutation.mutateAsync({ params: { id: detailId }, body: {} });
        Toast.success('已完结');
      },
    });
  }

  function handleRefund() {
    if (!detailId || !detail) return;
    const amount = refundAmountYuan.trim() ? Math.round(Number(refundAmountYuan) * 100) : undefined;
    if (refundAmountYuan.trim() && (!Number.isFinite(amount) || (amount as number) <= 0)) {
      Toast.warning('退款金额格式不正确');
      return;
    }
    confirmDanger({
      title: '发起投诉退款？',
      content: `将退款 ${yuan(amount ?? detail.amount)}（大额退款自动进入审批），退款成功后工单自动完结`,
      onOk: async () => {
        const updated = await refundMutation.mutateAsync({ params: { id: detailId }, body: { refundAmount: amount } });
        if (updated.status === 'refunded') {
          Toast.success('退款成功，投诉工单已完结');
        } else {
          Toast.info('退款申请已提交，工单将在退款成功后自动完结');
        }
      },
    });
  }

  const columns: ColumnProps<PaymentDispute>[] = [
    copyableNoColumn('投诉单号', 'disputeNo'),
    copyableNoColumn('订单号', 'orderNo'),
    { title: '渠道', dataIndex: 'channel', width: 90, render: (v: PaymentChannel) => PAYMENT_CHANNEL_LABELS[v] },
    { title: '类型', dataIndex: 'type', width: 100, render: (v: PaymentDisputeType) => PAYMENT_DISPUTE_TYPE_LABELS[v] },
    { title: '涉诉金额', dataIndex: 'amount', width: 100, align: 'right', render: (v: number) => yuan(v) },
    { title: '投诉人', dataIndex: 'complainant', minWidth: 140, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{v || '-'}</Typography.Text> },
    {
      title: '分流', dataIndex: 'route', width: 140,
      render: (v: string | null, r) => {
        if (!v) return <Typography.Text type="tertiary">默认队列</Typography.Text>;
        const label = PAYMENT_DISPUTE_ROUTE_LABELS[v as PaymentDisputeRoute] ?? v;
        const color = ROUTE_COLOR[v as PaymentDisputeRoute] ?? 'grey';
        return <Tag color={color}>{label}{r.priority != null ? ` P${r.priority}` : ''}</Tag>;
      },
    },
    {
      title: '处理时效', dataIndex: 'deadline', width: 180,
      render: (v: string | null, r) => {
        if (!v) return '-';
        return r.overdue ? <Tag color="red">已超时 {v}</Tag> : <span>{v}</span>;
      },
    },
    createdAtColumn as ColumnProps<PaymentDispute>,
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentDisputeStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_DISPUTE_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentDispute>({
      width: 100,
      actions: (r) => [{
        key: 'detail',
        label: r.status === 'pending' || r.status === 'processing' ? '处理' : '详情',
        onClick: () => openDetail(r.id),
      }],
    }),
  ];

  const exportQuery = {
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    type: submittedParams.type || undefined,
    channel: submittedParams.channel || undefined,
    route: submittedParams.route || undefined,
  };

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="投诉单号/订单号/投诉人..." value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
  );
  const renderStatusFilter = () => (
    <StatusSelect items={PAYMENT_DISPUTE_STATUS_OPTIONS} value={draftParams.status} onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))} />
  );
  const renderTypeFilter = () => (
    <FilterSelect
      placeholder="全部类型"
      items={PAYMENT_DISPUTE_TYPE_OPTIONS}
      value={draftParams.type}
      onChange={(v) => setDraftParams((p) => ({ ...p, type: v }))}
    />
  );
  const renderChannelFilter = () => (
    <FilterSelect
      placeholder="全部渠道"
      items={channelOptions}
      value={draftParams.channel}
      onChange={(v) => setDraftParams((p) => ({ ...p, channel: v }))}
    />
  );
  const renderRouteFilter = () => (
    <FilterSelect
      placeholder="全部分流"
      items={PAYMENT_DISPUTE_ROUTE_OPTIONS}
      value={draftParams.route}
      onChange={(v) => setDraftParams((p) => ({ ...p, route: v }))}
    />
  );
  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const renderSimulateButton = () => canHandle ? (
    <Button type="primary" icon={<FlaskConical size={14} />} loading={simulateMutation.isPending} onClick={() => void handleSimulate()}>模拟投诉</Button>
  ) : null;

  const statsText = stats
    ? `未完结 ${stats.open} 单（超时 ${stats.overdue}） · 近30天投诉 ${stats.last30dCount} 单 · 投诉率 ${stats.last30dRate}% · 平均处理 ${stats.avgResolveHours} 小时`
    : '';

  const canAct = detail && (detail.status === 'pending' || detail.status === 'processing');

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderStatusFilter()}
            {renderTypeFilter()}
            {renderChannelFilter()}
            {renderRouteFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            <ExportButton entity="payment.disputes" query={exportQuery} />
            {renderSimulateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderSimulateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderStatusFilter()}
            {renderTypeFilter()}
            {renderChannelFilter()}
            {renderRouteFilter()}
          </>
        )}
        filterTitle="投诉筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
        mobileActions={<ExportButton entity="payment.disputes" query={exportQuery} variant="flat" />}
      />

      {statsText && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Text type="tertiary">{statsText}</Typography.Text>
        </div>
      )}

      <ConfigurableTable
        bordered columns={columns} dataSource={data} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => { void listQuery.refetch(); void statsQuery.refetch(); }} refreshLoading={listQuery.isFetching} pagination={buildPagination(total)}
      />

      <SideSheet
        title={detail ? `投诉工单 ${detail.disputeNo}` : '投诉工单'}
        visible={detailId != null}
        onCancel={() => setDetailId(null)}
        width={560}
        closeOnEsc
      >
        {detailQuery.isLoading || !detail ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spin /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {detail.overdue && <Banner type="danger" closeIcon={null} description={`该工单已超过处理时效（${detail.deadline}），请尽快处理`} />}
            {detail.route === 'auto_refund_suggest' && canAct && (
              <Banner
                type="warning" closeIcon={null}
                description={`智能分流建议自动退款（小额退款诉求）：请核实后使用下方「退款并完结」，默认全额 ${yuan(detail.amount)}。退款仍需人工确认，不会自动执行。`}
              />
            )}

            <div style={{ fontSize: 13, lineHeight: 2 }}>
              <div>
                状态：<Tag color={STATUS_COLOR[detail.status]}>{PAYMENT_DISPUTE_STATUS_LABELS[detail.status]}</Tag>{'　'}
                分流：{detail.route
                  ? <Tag color={ROUTE_COLOR[detail.route as PaymentDisputeRoute] ?? 'grey'}>{PAYMENT_DISPUTE_ROUTE_LABELS[detail.route as PaymentDisputeRoute] ?? detail.route}{detail.priority != null ? ` P${detail.priority}` : ''}{detail.slaHours != null ? ` · SLA ${detail.slaHours}h` : ''}</Tag>
                  : <Typography.Text type="tertiary">默认队列</Typography.Text>}{'　'}
                类型：{PAYMENT_DISPUTE_TYPE_LABELS[detail.type]}{'　'}渠道：{PAYMENT_CHANNEL_LABELS[detail.channel]}
              </div>
              <div>投诉人：{detail.complainant ?? '-'}（{detail.complainantPhone ?? '-'}）{'　'}涉诉金额：{yuan(detail.amount)}</div>
              <div>渠道投诉号：{detail.channelDisputeNo ?? '-'}</div>
              {detail.refundNo && <div>关联退款单：{detail.refundNo}</div>}
              {detail.order && (
                <div style={{ background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)', padding: '8px 12px', marginTop: 4 }}>
                  关联订单：{detail.order.orderNo}{'　'}{detail.order.subject}{'　'}{yuan(detail.order.amount)}{'　'}
                  {PAYMENT_ORDER_STATUS_LABELS[detail.order.status]}{'　'}{detail.order.paidAt ? `支付于 ${detail.order.paidAt}` : ''}
                </div>
              )}
            </div>

            <div>
              <Typography.Title heading={6} style={{ marginBottom: 12 }}>处理时间线</Typography.Title>
              <Timeline>
                {detail.replies.map((r) => (
                  <Timeline.Item key={r.id} time={r.createdAt} type={r.author === 'user' ? 'warning' : r.author === 'system' ? 'success' : 'default'}>
                    <div style={{ fontSize: 13 }}>
                      <strong>{REPLY_AUTHOR_LABELS[r.author]}{r.operatorName ? `（${r.operatorName}）` : ''}</strong>：{r.content}
                    </div>
                  </Timeline.Item>
                ))}
              </Timeline>
            </div>

            {canAct && canHandle && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--semi-color-border)', paddingTop: 14 }}>
                <TextArea rows={3} maxLength={1000} placeholder="输入商户回复内容..." value={replyContent} onChange={setReplyContent} />
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Button theme="solid" type="primary" loading={replyMutation.isPending} onClick={() => void handleReply()}>回复投诉人</Button>
                  <Button type="secondary" loading={resolveMutation.isPending} onClick={handleResolve}>协商完结</Button>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Input placeholder={`退款金额(元)，默认 ${(detail.amount / 100).toFixed(2)}`} value={refundAmountYuan} onChange={setRefundAmountYuan} style={{ width: 190 }} />
                    <Button type="danger" loading={refundMutation.isPending} onClick={handleRefund}>退款并完结</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </SideSheet>
    </div>
  );
}
