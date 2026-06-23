import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Form, Popconfirm, Select, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { request } from '@/utils/request';
import { formatDateTime, formatDateForApi } from '@/utils/date';
import { createdAtColumn } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_SETTLEMENT_STATUS_LABELS } from '@zenith/shared';
import type { PaginatedResponse, PaymentChannel, PaymentSettlementBatch, PaymentSettlementStatus } from '@zenith/shared';

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
const channelOptions = Object.entries(PAYMENT_CHANNEL_LABELS).map(([value, label]) => ({ value, label }));
const STATUS_COLOR = { pending: 'grey', settling: 'blue', settled: 'green', failed: 'red' } as const satisfies Record<PaymentSettlementStatus, string>;

interface SearchParams { channel: string; status: string; }
const defaultSearch: SearchParams = { channel: '', status: '' };

interface GenerateFormValues { channel: PaymentChannel; period: [Date, Date]; remark?: string; }

export default function PaymentSettlementsPage() {
  const { hasPermission } = usePermission();
  const canSettle = hasPermission('payment:settlement:settle');
  const formApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<PaginatedResponse<PaymentSettlementBatch> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [search, setSearch] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = search;

  const [genVisible, setGenVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [transitioningIds, setTransitioningIds] = useState<Set<number>>(new Set());

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const active = params ?? searchRef.current;
      setLoading(true);
      try {
        const query: Record<string, string> = { page: String(p), pageSize: String(ps) };
        if (active.channel) query.channel = active.channel;
        if (active.status) query.status = active.status;
        const res = await request.get<PaginatedResponse<PaymentSettlementBatch>>(`/api/payment/settlements?${new URLSearchParams(query)}`);
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
  function handleReset() { setSearch(defaultSearch); setPage(1); void fetchList(1, pageSize, defaultSearch); }

  async function handleGenerate() {
    let values: GenerateFormValues;
    try { values = (await formApi.current?.validate()) as GenerateFormValues; } catch { throw new Error('validation'); }
    setSubmitting(true);
    try {
      const res = await request.post<PaymentSettlementBatch>('/api/payment/settlements/generate', {
        channel: values.channel,
        periodStart: formatDateForApi(values.period[0]),
        periodEnd: formatDateForApi(values.period[1]),
        remark: values.remark || undefined,
      });
      if (res.code === 0) { Toast.success('生成成功'); setGenVisible(false); void fetchList(); }
      else throw new Error(res.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleTransition(record: PaymentSettlementBatch, status: PaymentSettlementStatus) {
    setTransitioningIds((prev) => new Set(prev).add(record.id));
    request
      .post<PaymentSettlementBatch>(`/api/payment/settlements/${record.id}/status`, { status })
      .then((res) => { if (res.code === 0) { Toast.success('操作成功'); void fetchList(); } else Toast.error(res.message); })
      .finally(() => setTransitioningIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; }));
  }

  const columns: ColumnProps<PaymentSettlementBatch>[] = [
    { title: '批次号', dataIndex: 'batchNo', width: 190, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 170 }}>{v}</Typography.Text> },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={v === 'wechat' ? 'green' : 'blue'}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '账期', dataIndex: 'periodStart', width: 200, render: (_: unknown, r: PaymentSettlementBatch) => `${r.periodStart} ~ ${r.periodEnd}` },
    { title: '订单数', dataIndex: 'orderCount', width: 80 },
    { title: '收款', dataIndex: 'grossAmount', width: 110, render: (v: number) => yuan(v) },
    { title: '手续费', dataIndex: 'feeAmount', width: 100, render: (v: number) => yuan(v) },
    { title: '退款', dataIndex: 'refundAmount', width: 100, render: (v: number) => yuan(v) },
    { title: '净额', dataIndex: 'netAmount', width: 120, render: (v: number) => <Typography.Text strong type={v < 0 ? 'danger' : 'success'}>{yuan(v)}</Typography.Text> },
    { title: '到账时间', dataIndex: 'settledAt', width: 170, render: (v: string | null) => (v ? formatDateTime(v) : '-') },
    createdAtColumn as ColumnProps<PaymentSettlementBatch>,
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentSettlementStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_SETTLEMENT_STATUS_LABELS[v]}</Tag> },
    {
      title: '操作', fixed: 'right', width: 180,
      render: (_: unknown, r: PaymentSettlementBatch) => {
        if (!canSettle || r.status === 'settled' || r.status === 'failed') return <Typography.Text type="tertiary">—</Typography.Text>;
        const busy = transitioningIds.has(r.id);
        return (
          <Space>
            {r.status === 'pending' && <Button theme="borderless" size="small" loading={busy} onClick={() => handleTransition(r, 'settling')}>开始结算</Button>}
            {r.status === 'settling' && (
              <Popconfirm title="确认该批次已到账？" onConfirm={() => handleTransition(r, 'settled')}>
                <Button theme="borderless" size="small" loading={busy}>标记到账</Button>
              </Popconfirm>
            )}
            <Popconfirm title="确认标记为结算失败？" onConfirm={() => handleTransition(r, 'failed')}>
              <Button theme="borderless" type="danger" size="small" loading={busy}>标记失败</Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Select placeholder="全部渠道" value={search.channel || undefined} onChange={(v) => setSearch((p) => ({ ...p, channel: (v as string) ?? '' }))} showClear style={{ width: 130 }} optionList={channelOptions} />
        <Select placeholder="全部状态" value={search.status || undefined} onChange={(v) => setSearch((p) => ({ ...p, status: (v as string) ?? '' }))} showClear style={{ width: 120 }}
          optionList={Object.entries(PAYMENT_SETTLEMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('payment:settlement:generate') && <Button type="primary" icon={<Plus size={14} />} onClick={() => setGenVisible(true)}>生成结算</Button>}
      </SearchToolbar>

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)}
      />

      <AppModal title="生成结算批次" visible={genVisible} onOk={handleGenerate} onCancel={() => setGenVisible(false)} okButtonProps={{ loading: submitting }} width={520} closeOnEsc>
        <Form key={genVisible ? 'gen' : 'closed'} getFormApi={(api) => { formApi.current = api; }} initValues={{ channel: 'wechat' }} labelPosition="left" labelWidth={90}>
          <Form.Select field="channel" label="渠道" style={{ width: '100%' }} optionList={channelOptions} rules={[{ required: true, message: '请选择渠道' }]} />
          <Form.DatePicker
            field="period"
            label="账期"
            type="dateRange"
            style={{ width: '100%' }}
            rules={[
              { required: true, message: '请选择账期' },
              {
                validator: (_rule: unknown, value: unknown) => {
                  if (!Array.isArray(value) || value.length !== 2) return false;
                  const [start, end] = value as [Date, Date];
                  return start <= end;
                },
                message: '账期开始不能晚于结束',
              },
            ]}
          />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginLeft: 90 }}>将聚合该渠道账期内成功订单，净额 = 收款 - 手续费 - 退款</Typography.Text>
        </Form>
      </AppModal>
    </div>
  );
}
