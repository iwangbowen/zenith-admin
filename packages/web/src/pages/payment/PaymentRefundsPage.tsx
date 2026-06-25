import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, DatePicker, Dropdown, Form, Input, Modal, Select, SplitButtonGroup, Tag, Toast, Typography, Descriptions } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw, Download, ChevronDown } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { request } from '@/utils/request';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_REFUND_STATUS_LABELS, PAYMENT_REFUND_APPROVAL_STATUS_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentRefund, PaymentRefundStatus, PaymentRefundApprovalStatus, PaginatedResponse } from '@zenith/shared';

const STATUS_COLOR = { pending: 'grey', processing: 'blue', success: 'green', failed: 'red' } as const satisfies Record<PaymentRefundStatus, string>;
const APPROVAL_COLOR = { none: 'grey', pending: 'amber', approved: 'green', rejected: 'red' } as const satisfies Record<PaymentRefundApprovalStatus, string>;
const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

interface SearchParams { keyword: string; channel: string; status: string; approvalStatus: string; timeRange: [Date, Date] | null; }
const defaultSearch: SearchParams = { keyword: '', channel: '', status: '', approvalStatus: '', timeRange: null };

export default function PaymentRefundsPage() {
  const { hasPermission } = usePermission();
  const [data, setData] = useState<PaginatedResponse<PaymentRefund> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = searchParams;
  const [detail, setDetail] = useState<PaymentRefund | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportCsvLoading, setExportCsvLoading] = useState(false);
  const [queryingIds, setQueryingIds] = useState<Set<number>>(new Set());
  const [approvingIds, setApprovingIds] = useState<Set<number>>(new Set());
  const [rejectTarget, setRejectTarget] = useState<PaymentRefund | null>(null);
  const [rejectRemark, setRejectRemark] = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

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

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const active = params ?? searchRef.current;
      setLoading(true);
      try {
        const query = { page: String(p), pageSize: String(ps), ...buildQuery(active) };
        const res = await request.get<PaginatedResponse<PaymentRefund>>(`/api/payment/refunds?${new URLSearchParams(query)}`);
        if (res.code === 0) { setData(res.data); setPage(res.data.page); setPageSize(res.data.pageSize); }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, pageSize],
  );

  useEffect(() => {
    void fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() { setPage(1); void fetchList(1, pageSize); }
  function handleReset() { setSearchParams(defaultSearch); setPage(1); void fetchList(1, pageSize, defaultSearch); }

  function handleRefundQuery(record: PaymentRefund) {
    setQueryingIds((prev) => new Set(prev).add(record.id));
    request
      .post<PaymentRefund>(`/api/payment/refunds/${record.id}/query`, {})
      .then((res) => {
        if (res.code === 0) {
          Toast.success(`最新状态：${PAYMENT_REFUND_STATUS_LABELS[res.data.status]}`);
          void fetchList();
        } else {
          Toast.error(`查单失败：${res.message}`);
        }
      })
      .catch((err: unknown) => Toast.error(`查单异常：${err instanceof Error ? err.message : '未知错误'}`))
      .finally(() => setQueryingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; }));
  }

  function handleApprove(record: PaymentRefund) {
    setApprovingIds((prev) => new Set(prev).add(record.id));
    request
      .post(`/api/payment/refunds/${record.id}/approve`, {})
      .then((res) => {
        if (res.code === 0) { Toast.success('已审批通过，退款执行中'); void fetchList(); }
        else Toast.error(`审批失败：${res.message}`);
      })
      .catch((err: unknown) => Toast.error(`审批异常：${err instanceof Error ? err.message : '未知错误'}`))
      .finally(() => setApprovingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; }));
  }

  function openReject(record: PaymentRefund) { setRejectTarget(record); setRejectRemark(''); }
  async function submitReject() {
    if (!rejectTarget) return;
    if (!rejectRemark.trim()) { Toast.warning('请填写驳回原因'); return; }
    setRejectSubmitting(true);
    try {
      const res = await request.post(`/api/payment/refunds/${rejectTarget.id}/reject`, { remark: rejectRemark.trim() });
      if (res.code === 0) { Toast.success('已驳回'); setRejectTarget(null); void fetchList(); }
      else Toast.error(`驳回失败：${res.message}`);
    } finally { setRejectSubmitting(false); }
  }

  async function handleExport() {
    setExportLoading(true);
    try { await request.download(`/api/payment/refunds/export?${new URLSearchParams(buildQuery(searchRef.current))}`, '退款记录.xlsx'); } finally { setExportLoading(false); }
  }
  async function handleExportCsv() {
    setExportCsvLoading(true);
    try { await request.download(`/api/payment/refunds/export/csv?${new URLSearchParams(buildQuery(searchRef.current))}`, '退款记录.csv'); } finally { setExportCsvLoading(false); }
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
          loading: queryingIds.has(r.id),
          onClick: () => handleRefundQuery(r),
        }] : []),
        ...(r.approvalStatus === 'pending' && hasPermission('payment:refund:approve') ? [{
          key: 'approve',
          label: '通过',
          type: 'primary' as const,
          loading: approvingIds.has(r.id),
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
      value={searchParams.keyword}
      onChange={(v) => setSearchParams((p) => ({ ...p, keyword: v }))}
      showClear
      style={{ width: 200 }}
      onEnterPress={handleSearch}
    />
  );

  const renderChannelFilter = () => (
    <Select
      placeholder="全部渠道"
      value={searchParams.channel || undefined}
      onChange={(v) => setSearchParams((p) => ({ ...p, channel: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={[{ value: 'wechat', label: '微信支付' }, { value: 'alipay', label: '支付宝' }]}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={searchParams.status || undefined}
      onChange={(v) => setSearchParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={Object.entries(PAYMENT_REFUND_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );

  const renderApprovalFilter = () => (
    <Select
      placeholder="审批状态"
      value={searchParams.approvalStatus || undefined}
      onChange={(v) => setSearchParams((p) => ({ ...p, approvalStatus: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={Object.entries(PAYMENT_REFUND_APPROVAL_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
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
  const renderExportButtons = () => (
    <SplitButtonGroup>
      <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={handleExport}>导出</Button>
      <Dropdown trigger="click" position="bottomRight" clickToHide render={(
        <Dropdown.Menu>
          <Dropdown.Item onClick={handleExport}>导出 Excel</Dropdown.Item>
          <Dropdown.Item onClick={handleExportCsv}>导出 CSV</Dropdown.Item>
        </Dropdown.Menu>
      )}>
        <Button type="primary" icon={<ChevronDown size={14} />} loading={exportCsvLoading} />
      </Dropdown>
    </SplitButtonGroup>
  );
  const renderMobileExportActions = () => (
    <>
      <Button icon={<Download size={14} />} loading={exportLoading} onClick={handleExport}>导出 Excel</Button>
      <Button icon={<Download size={14} />} loading={exportCsvLoading} onClick={handleExportCsv}>导出 CSV</Button>
    </>
  );

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
        bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)}
      />

      <AppModal title="退款详情" visible={!!detail} onCancel={() => setDetail(null)} footer={null} width={560} closeOnEsc>
        {detail && (
          <Descriptions
            row
            data={[
              { key: '退款单号', value: detail.refundNo },
              { key: '渠道退款号', value: detail.channelRefundNo ?? '-' },
              { key: '原订单号', value: detail.orderNo },
              { key: '退款金额', value: yuan(detail.refundAmount) },
              { key: '原单金额', value: yuan(detail.totalAmount) },
              { key: '渠道', value: PAYMENT_CHANNEL_LABELS[detail.channel] },
              { key: '状态', value: <Tag color={STATUS_COLOR[detail.status]}>{PAYMENT_REFUND_STATUS_LABELS[detail.status]}</Tag> },
              { key: '退款原因', value: detail.reason ?? '-' },
              { key: '审批状态', value: <Tag color={APPROVAL_COLOR[detail.approvalStatus]}>{PAYMENT_REFUND_APPROVAL_STATUS_LABELS[detail.approvalStatus]}</Tag> },
              { key: '审批意见', value: detail.approvalRemark ?? '-' },
              { key: '审批时间', value: detail.approvedAt ? formatDateTime(detail.approvedAt) : '-' },
              { key: '退款时间', value: detail.refundedAt ? formatDateTime(detail.refundedAt) : '-' },
              { key: '创建时间', value: formatDateTime(detail.createdAt) },
              { key: '错误信息', value: detail.errorMessage ?? '-' },
            ]}
          />
        )}
      </AppModal>

      <Modal title="驳回退款" visible={!!rejectTarget} onOk={submitReject} onCancel={() => setRejectTarget(null)} okButtonProps={{ loading: rejectSubmitting, type: 'danger' }} width={460} closeOnEsc>
        {rejectTarget && (
          <Form labelPosition="left" labelWidth={90}>
            <Form.Slot label="退款单号">{rejectTarget.refundNo}</Form.Slot>
            <Form.Slot label="退款金额"><Typography.Text type="danger">{yuan(rejectTarget.refundAmount)}</Typography.Text></Form.Slot>
            <Form.Slot label="驳回原因">
              <Input value={rejectRemark} onChange={setRejectRemark} placeholder="请填写驳回原因（必填）" maxLength={256} showClear />
            </Form.Slot>
          </Form>
        )}
      </Modal>
    </div>
  );
}
