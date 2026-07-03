import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Form, Input, Select, Tag, Toast, Typography, Descriptions } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_REFUND_STATUS_LABELS, PAYMENT_REFUND_APPROVAL_STATUS_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentRefund, PaymentRefundStatus, PaymentRefundApprovalStatus } from '@zenith/shared';
import {
  paymentRefundKeys,
  useApprovePaymentRefund,
  usePaymentRefundDetail,
  usePaymentRefundList,
  useQueryPaymentRefund,
  useRejectPaymentRefund,
} from '@/hooks/queries/payment-refunds';

const STATUS_COLOR = { pending: 'grey', processing: 'blue', success: 'green', failed: 'red' } as const satisfies Record<PaymentRefundStatus, string>;
const APPROVAL_COLOR = { none: 'grey', pending: 'amber', approved: 'green', rejected: 'red' } as const satisfies Record<PaymentRefundApprovalStatus, string>;
const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

interface SearchParams { keyword: string; channel: string; status: string; approvalStatus: string; timeRange: [Date, Date] | null; }
const defaultSearch: SearchParams = { keyword: '', channel: '', status: '', approvalStatus: '', timeRange: null };

export default function PaymentRefundsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);
  const [detail, setDetail] = useState<PaymentRefund | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PaymentRefund | null>(null);
  const [rejectRemark, setRejectRemark] = useState('');

  function buildQuery(active: SearchParams): Record<string, string> {
    const q: Record<string, string> = {};
    if (active.keyword) q.keyword = active.keyword;
    if (active.channel) q.channel = active.channel;
    if (active.status) q.status = active.status;
    if (active.approvalStatus) q.approvalStatus = active.approvalStatus;
    if (active.timeRange) {
      q.startTime = formatDateTimeForApi(active.timeRange[0]);
      q.endTime = formatDateTimeForApi(active.timeRange[1]);
    }
    return q;
  }

  const listQuery = usePaymentRefundList({ page, pageSize, ...buildQuery(submittedParams) });
  const data = listQuery.data ?? null;
  const detailQuery = usePaymentRefundDetail(detail?.id, !!detail);
  const refundDetail = detail ? (detailQuery.data ?? detail) : null;
  const queryMutation = useQueryPaymentRefund();
  const approveMutation = useApprovePaymentRefund();
  const rejectMutation = useRejectPaymentRefund();
  const queryingId = queryMutation.isPending ? (queryMutation.variables ?? null) : null;
  const approvingId = approveMutation.isPending ? (approveMutation.variables ?? null) : null;

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: paymentRefundKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearch); setSubmittedParams(defaultSearch); setPage(1); void queryClient.invalidateQueries({ queryKey: paymentRefundKeys.lists }); }

  function handleRefundQuery(record: PaymentRefund) {
    queryMutation.mutate(record.id, {
      onSuccess: (refund) => Toast.success(`最新状态：${PAYMENT_REFUND_STATUS_LABELS[refund.status]}`),
    });
  }

  function handleApprove(record: PaymentRefund) {
    approveMutation.mutate(record.id, { onSuccess: () => Toast.success('已审批通过，退款执行中') });
  }

  function openReject(record: PaymentRefund) { setRejectTarget(record); setRejectRemark(''); }
  async function submitReject() {
    if (!rejectTarget) return;
    if (!rejectRemark.trim()) { Toast.warning('请填写驳回原因'); return; }
    await rejectMutation.mutateAsync({ id: rejectTarget.id, remark: rejectRemark.trim() });
    Toast.success('已驳回');
    setRejectTarget(null);
  }

  const columns: ColumnProps<PaymentRefund>[] = [
    { title: '退款单号', dataIndex: 'refundNo', width: 200, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 180 }}>{v}</Typography.Text> },
    { title: '原订单号', dataIndex: 'orderNo', width: 200, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 180 }}>{v}</Typography.Text> },
    { title: '退款金额', dataIndex: 'refundAmount', width: 110, render: (v: number) => yuan(v) },
    { title: '原单金额', dataIndex: 'totalAmount', width: 110, render: (v: number) => yuan(v) },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={v === 'wechat' ? 'green' : 'blue'}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '退款时间', dataIndex: 'refundedAt', width: 170, render: (t: string | null) => (t ? formatDateTime(t) : '-') },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    {
      title: '审批', dataIndex: 'approvalStatus', width: 100, fixed: 'right',
      render: (v: PaymentRefundApprovalStatus) => (v === 'none' ? <Typography.Text type="tertiary">-</Typography.Text> : <Tag color={APPROVAL_COLOR[v]}>{PAYMENT_REFUND_APPROVAL_STATUS_LABELS[v]}</Tag>),
    },
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentRefundStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_REFUND_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentRefund>({
      width: 200,
      actions: (r) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => setDetail(r),
        },
        ...((r.status === 'processing' || r.status === 'pending') && r.approvalStatus !== 'pending' ? [{
          key: 'query',
          label: '查单',
          loading: queryingId === r.id,
          onClick: () => handleRefundQuery(r),
        }] : []),
        ...(r.approvalStatus === 'pending' && hasPermission('payment:refund:approve') ? [{
          key: 'approve',
          label: '通过',
          type: 'primary' as const,
          loading: approvingId === r.id,
          onClick: () => handleApprove(r),
        }, {
          key: 'reject',
          label: '驳回',
          danger: true,
          onClick: () => openReject(r),
        }] : []),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="退款单号/订单号..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      showClear
      style={{ width: 200 }}
      onEnterPress={handleSearch}
    />
  );

  const renderChannelFilter = () => (
    <Select
      placeholder="全部渠道"
      value={draftParams.channel || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, channel: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={[{ value: 'wechat', label: '微信支付' }, { value: 'alipay', label: '支付宝' }]}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={Object.entries(PAYMENT_REFUND_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );

  const renderApprovalFilter = () => (
    <Select
      placeholder="审批状态"
      value={draftParams.approvalStatus || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, approvalStatus: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={Object.entries(PAYMENT_REFUND_APPROVAL_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
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
  const renderExportButtons = () => <ExportButton entity="payment.refunds" query={buildQuery(submittedParams)} />;
  const renderMobileExportActions = () => <ExportButton entity="payment.refunds" query={buildQuery(submittedParams)} variant="flat" />;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderChannelFilter()}
            {renderStatusFilter()}
            {renderApprovalFilter()}
            {renderTimeRangeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        actions={renderExportButtons()}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderChannelFilter()}
            {renderStatusFilter()}
            {renderApprovalFilter()}
            {renderTimeRangeFilter()}
          </>
        )}
        mobileActions={renderMobileExportActions()}
        filterTitle="退款记录筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal title="退款详情" visible={!!detail} onCancel={() => setDetail(null)} footer={null} width={560} closeOnEsc>
        {refundDetail && (
          <Descriptions
            row
            data={[
              { key: '退款单号', value: refundDetail.refundNo },
              { key: '渠道退款号', value: refundDetail.channelRefundNo ?? '-' },
              { key: '原订单号', value: refundDetail.orderNo },
              { key: '退款金额', value: yuan(refundDetail.refundAmount) },
              { key: '原单金额', value: yuan(refundDetail.totalAmount) },
              { key: '渠道', value: PAYMENT_CHANNEL_LABELS[refundDetail.channel] },
              { key: '状态', value: <Tag color={STATUS_COLOR[refundDetail.status]}>{PAYMENT_REFUND_STATUS_LABELS[refundDetail.status]}</Tag> },
              { key: '退款原因', value: refundDetail.reason ?? '-' },
              { key: '审批状态', value: <Tag color={APPROVAL_COLOR[refundDetail.approvalStatus]}>{PAYMENT_REFUND_APPROVAL_STATUS_LABELS[refundDetail.approvalStatus]}</Tag> },
              { key: '审批意见', value: refundDetail.approvalRemark ?? '-' },
              { key: '审批时间', value: refundDetail.approvedAt ? formatDateTime(refundDetail.approvedAt) : '-' },
              { key: '退款时间', value: refundDetail.refundedAt ? formatDateTime(refundDetail.refundedAt) : '-' },
              { key: '创建时间', value: formatDateTime(refundDetail.createdAt) },
              { key: '错误信息', value: refundDetail.errorMessage ?? '-' },
            ]}
          />
        )}
      </AppModal>

      <AppModal title="驳回退款" visible={!!rejectTarget} onOk={submitReject} onCancel={() => setRejectTarget(null)} okButtonProps={{ loading: rejectMutation.isPending, type: 'danger' }} width={460} closeOnEsc>
        {rejectTarget && (
          <Form labelPosition="left" labelWidth={90}>
            <Form.Slot label="退款单号">{rejectTarget.refundNo}</Form.Slot>
            <Form.Slot label="退款金额"><Typography.Text type="danger">{yuan(rejectTarget.refundAmount)}</Typography.Text></Form.Slot>
            <Form.Slot label="驳回原因">
              <Input value={rejectRemark} onChange={setRejectRemark} placeholder="请填写驳回原因（必填）" maxLength={256} showClear />
            </Form.Slot>
          </Form>
        )}
      </AppModal>
    </div>
  );
}
