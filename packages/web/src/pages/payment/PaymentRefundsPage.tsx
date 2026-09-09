import { useState } from 'react';
import { formatYuan, PAYMENT_CHANNEL_TAG_COLOR } from '@/utils/payment';
import { Form, Input, Tag, Toast, Typography, Descriptions } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import { formatDateTime, formatDateTimeRangeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { enumValueOf } from '@zenith/shared/core';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNEL_OPTIONS, PAYMENT_CHANNELS, PAYMENT_REFUND_APPROVAL_STATUSES, PAYMENT_REFUND_STATUS_LABELS, PAYMENT_REFUND_APPROVAL_STATUS_LABELS, PAYMENT_REFUND_STATUS_OPTIONS, PAYMENT_REFUND_STATUSES, PAYMENT_REFUND_APPROVAL_STATUS_OPTIONS } from '@zenith/shared/payment';
import type { PaymentChannel, PaymentRefund, PaymentRefundStatus, PaymentRefundApprovalStatus } from '@zenith/shared/payment';
import {
  paymentRefundKeys,
  useApprovePaymentRefund,
  usePaymentRefundDetail,
  usePaymentRefundList,
  useQueryPaymentRefund,
  useRejectPaymentRefund,
  type PaymentRefundListParams,
} from '@/hooks/queries/payment-refunds';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { copyableNoColumn, dateTimeColumn } from '@/utils/table-columns';

const STATUS_COLOR = { pending: 'grey', processing: 'blue', unknown: 'amber', success: 'green', failed: 'red' } as const satisfies Record<PaymentRefundStatus, string>;
const APPROVAL_COLOR = { none: 'grey', pending: 'amber', approved: 'green', rejected: 'red' } as const satisfies Record<PaymentRefundApprovalStatus, string>;
const yuan = formatYuan;

interface SearchParams { keyword: string; channel?: string; status?: string; approvalStatus?: string; timeRange: [Date, Date] | null; }
const defaultSearch: SearchParams = { keyword: '', channel: undefined, status: undefined, approvalStatus: undefined, timeRange: null };

export default function PaymentRefundsPage() {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: paymentRefundKeys.lists });
  const [detail, setDetail] = useState<PaymentRefund | null>(null);
  const [approveTarget, setApproveTarget] = useState<PaymentRefund | null>(null);
  const [approveRemark, setApproveRemark] = useState('');
  const [rejectTarget, setRejectTarget] = useState<PaymentRefund | null>(null);
  const [rejectRemark, setRejectRemark] = useState('');

  function buildQuery(active: SearchParams): Omit<PaymentRefundListParams, 'page' | 'pageSize'> {
    return {
      keyword: active.keyword || undefined,
      channel: enumValueOf(PAYMENT_CHANNELS, active.channel),
      status: enumValueOf(PAYMENT_REFUND_STATUSES, active.status),
      approvalStatus: enumValueOf(PAYMENT_REFUND_APPROVAL_STATUSES, active.approvalStatus),
      ...formatDateTimeRangeForApi(active.timeRange),
    };
  }

  const listQuery = usePaymentRefundList({ page, pageSize, ...buildQuery(submittedParams) });
  const detailQuery = usePaymentRefundDetail(detail?.id, !!detail);
  const refundDetail = detail ? (detailQuery.data ?? detail) : null;
  const queryMutation = useQueryPaymentRefund();
  const approveMutation = useApprovePaymentRefund();
  const rejectMutation = useRejectPaymentRefund();
  const queryingId = queryMutation.isPending ? (queryMutation.variables?.params.id ?? null) : null;
  const approvingId = approveMutation.isPending ? (approveMutation.variables?.params.id ?? null) : null;

  function handleRefundQuery(record: PaymentRefund) {
    queryMutation.mutate({ params: { id: record.id } }, {
      onSuccess: (refund) => Toast.success(`最新状态：${PAYMENT_REFUND_STATUS_LABELS[refund.status]}`),
    });
  }

  // 审批通过是资金流出操作：与驳回一致走确认弹窗（展示金额并支持审批意见），禁止单击直发
  function openApprove(record: PaymentRefund) { setApproveTarget(record); setApproveRemark(''); }
  async function submitApprove() {
    if (!approveTarget) return;
    await approveMutation.mutateAsync({ params: { id: approveTarget.id }, body: { remark: approveRemark.trim() || undefined } });
    Toast.success('已审批通过，退款执行中');
    setApproveTarget(null);
  }

  function openReject(record: PaymentRefund) { setRejectTarget(record); setRejectRemark(''); }
  async function submitReject() {
    if (!rejectTarget) return;
    if (!rejectRemark.trim()) { Toast.warning('请填写驳回原因'); return; }
    await rejectMutation.mutateAsync({ params: { id: rejectTarget.id }, body: { remark: rejectRemark.trim() } });
    Toast.success('已驳回');
    setRejectTarget(null);
  }

  const columns: ColumnProps<PaymentRefund>[] = [
    copyableNoColumn('退款单号', 'refundNo', { flex: true }),
    copyableNoColumn('原订单号', 'orderNo'),
    { title: '退款金额', dataIndex: 'refundAmount', width: 110, align: 'right', render: (v: number) => yuan(v) },
    { title: '原单金额', dataIndex: 'totalAmount', width: 110, align: 'right', render: (v: number) => yuan(v) },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={PAYMENT_CHANNEL_TAG_COLOR[v]}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    dateTimeColumn('退款时间', 'refundedAt'),
    dateTimeColumn('创建时间', 'createdAt'),
    {
      title: '审批', dataIndex: 'approvalStatus', width: 100, fixed: 'right',
      render: (v: PaymentRefundApprovalStatus) => (v === 'none' ? <Typography.Text type="tertiary">-</Typography.Text> : <Tag color={APPROVAL_COLOR[v]}>{PAYMENT_REFUND_APPROVAL_STATUS_LABELS[v]}</Tag>),
    },
    { title: '状态', dataIndex: 'status', width: 110, fixed: 'right', render: (v: PaymentRefundStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_REFUND_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentRefund>({
      width: 120,
      desktopInlineKeys: ['detail'],
      actions: (r) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => setDetail(r),
        },
        ...((r.status === 'processing' || r.status === 'pending' || r.status === 'unknown') && r.approvalStatus !== 'pending' ? [{
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
          onClick: () => openApprove(r),
        }, {
          key: 'reject',
          label: '驳回',
          danger: true,
          onClick: () => openReject(r),
        }] : []),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="退款单号/订单号..." {...bindKeyword('keyword')} width={200} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部渠道"
              items={PAYMENT_CHANNEL_OPTIONS}
              {...bind('channel')}
            />
            <StatusSelect
              items={PAYMENT_REFUND_STATUS_OPTIONS}
              {...bind('status')}
            />
            <FilterSelect
              placeholder="全部审批状态"
              items={PAYMENT_REFUND_APPROVAL_STATUS_OPTIONS}
              {...bind('approvalStatus')}
              width={140}
            />
            <DateRangeFilter placeholder={['创建开始', '创建结束']} {...bind('timeRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={<ExportButton entity="payment.refunds" query={buildQuery(submittedParams)} />}
        mobileActions={<ExportButton entity="payment.refunds" query={buildQuery(submittedParams)} variant="flat" />}
        filterTitle="退款记录筛选"
      />

      <ConfigurableTable
        columns={columns}
        empty="暂无数据"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal title="退款详情" visible={!!detail} onCancel={() => setDetail(null)} footer={null} width={560} closeOnEsc>
        {refundDetail && (
          <Descriptions
            align="plain"
            layout="horizontal"
            column={2}
            style={{ width: '100%' }}
            data={[
              { key: '退款单号', value: refundDetail.refundNo },
              { key: '渠道退款号', value: refundDetail.channelRefundNo ?? '-' },
              { key: '原订单号', value: refundDetail.orderNo },
              { key: '渠道', value: PAYMENT_CHANNEL_LABELS[refundDetail.channel] },
              { key: '退款金额', value: yuan(refundDetail.refundAmount) },
              { key: '原单金额', value: yuan(refundDetail.totalAmount) },
              { key: '状态', value: <Tag color={STATUS_COLOR[refundDetail.status]}>{PAYMENT_REFUND_STATUS_LABELS[refundDetail.status]}</Tag> },
              { key: '审批状态', value: <Tag color={APPROVAL_COLOR[refundDetail.approvalStatus]}>{PAYMENT_REFUND_APPROVAL_STATUS_LABELS[refundDetail.approvalStatus]}</Tag> },
              { key: '审批时间', value: refundDetail.approvedAt ? formatDateTime(refundDetail.approvedAt) : '-' },
              { key: '退款时间', value: refundDetail.refundedAt ? formatDateTime(refundDetail.refundedAt) : '-' },
              { key: '创建时间', value: formatDateTime(refundDetail.createdAt) },
              { key: '退款原因', value: refundDetail.reason ?? '-', span: 2 },
              { key: '审批意见', value: refundDetail.approvalRemark ?? '-', span: 2 },
              { key: '错误信息', value: refundDetail.errorMessage ?? '-', span: 2 },
            ]}
          />
        )}
      </AppModal>

      <AppModal title="审批通过退款" visible={!!approveTarget} onOk={submitApprove} onCancel={() => setApproveTarget(null)} okText="确认通过" okButtonProps={{ loading: approveMutation.isPending }} width={460} closeOnEsc>
        {approveTarget && (
          <Form labelPosition="left" labelWidth={90}>
            <Form.Slot label="退款单号">{approveTarget.refundNo}</Form.Slot>
            <Form.Slot label="原订单号">{approveTarget.orderNo}</Form.Slot>
            <Form.Slot label="退款金额"><Typography.Text type="danger">{yuan(approveTarget.refundAmount)}</Typography.Text></Form.Slot>
            <Form.Slot label="审批意见">
              <Input value={approveRemark} onChange={setApproveRemark} placeholder="可选" maxLength={256} showClear />
            </Form.Slot>
          </Form>
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
