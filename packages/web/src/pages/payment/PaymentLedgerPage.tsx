import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Button, DatePicker, Input, Row, Col, Select, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { request } from '@/utils/request';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_LEDGER_DIRECTION_LABELS, PAYMENT_LEDGER_TYPE_LABELS } from '@zenith/shared';
import type { PaginatedResponse, PaymentChannel, PaymentLedgerDirection, PaymentLedgerEntry, PaymentLedgerSummary, PaymentLedgerType } from '@zenith/shared';

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
const sectionStyle: CSSProperties = {
  background: 'var(--semi-color-bg-1)',
  border: '1px solid var(--semi-color-border)',
  borderRadius: 6,
  padding: '16px 20px',
};

interface StatCardProps {
  readonly title: string;
  readonly value: string | number;
  readonly sub?: string;
  readonly accent?: string;
}
function StatCard({ title, value, sub, accent }: StatCardProps) {
  return (
    <div style={{ ...sectionStyle, display: 'flex', flexDirection: 'column', gap: 2, height: '100%', minHeight: 92, boxSizing: 'border-box' }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent ?? 'var(--semi-color-text-0)', lineHeight: 1.2 }}>{String(value)}</div>
      <div style={{ fontSize: 11, color: 'var(--semi-color-text-2)', minHeight: 16 }}>{sub ?? ''}</div>
      <div style={{ fontSize: 13, color: 'var(--semi-color-text-1)', marginTop: 'auto' }}>{title}</div>
    </div>
  );
}

interface SearchParams {
  keyword: string;
  direction: string;
  type: string;
  channel: string;
  timeRange: [Date, Date] | null;
}
const defaultSearch: SearchParams = { keyword: '', direction: '', type: '', channel: '', timeRange: null };

export default function PaymentLedgerPage() {
  const { hasPermission } = usePermission();
  const canView = hasPermission('payment:ledger:list');
  const [data, setData] = useState<PaginatedResponse<PaymentLedgerEntry> | null>(null);
  const [summary, setSummary] = useState<PaymentLedgerSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = searchParams;

  function buildQuery(active: SearchParams): Record<string, string> {
    const q: Record<string, string> = {};
    if (active.keyword) q.keyword = active.keyword;
    if (active.direction) q.direction = active.direction;
    if (active.type) q.type = active.type;
    if (active.channel) q.channel = active.channel;
    if (active.timeRange) {
      q.startTime = formatDateTimeForApi(active.timeRange[0]);
      q.endTime = formatDateTimeForApi(active.timeRange[1]);
    }
    return q;
  }

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      if (!canView) return;
      const active = params ?? searchRef.current;
      setLoading(true);
      try {
        const filters = buildQuery(active);
        const listQuery = { page: String(p), pageSize: String(ps), ...filters };
        const [listRes, summaryRes] = await Promise.all([
          request.get<PaginatedResponse<PaymentLedgerEntry>>(`/api/payment/ledger/entries?${new URLSearchParams(listQuery)}`),
          request.get<PaymentLedgerSummary>(`/api/payment/ledger/summary?${new URLSearchParams(filters)}`),
        ]);
        if (listRes.code === 0) { setData(listRes.data); setPage(listRes.data.page); setPageSize(listRes.data.pageSize); }
        if (summaryRes.code === 0) setSummary(summaryRes.data);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, pageSize, canView],
  );

  useEffect(() => {
    void fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() { setPage(1); void fetchList(1, pageSize); }
  function handleReset() { setSearchParams(defaultSearch); setPage(1); void fetchList(1, pageSize, defaultSearch); }

  const columns: ColumnProps<PaymentLedgerEntry>[] = [
    { title: '流水号', dataIndex: 'entryNo', width: 190, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 170 }}>{v}</Typography.Text> },
    { title: '方向', dataIndex: 'direction', width: 90, render: (v: PaymentLedgerDirection) => <Tag color={v === 'in' ? 'green' : 'red'}>{PAYMENT_LEDGER_DIRECTION_LABELS[v]}</Tag> },
    { title: '类型', dataIndex: 'type', width: 100, render: (v: PaymentLedgerType) => PAYMENT_LEDGER_TYPE_LABELS[v] },
    { title: '金额', dataIndex: 'amount', width: 120, render: (v: number, r: PaymentLedgerEntry) => <Typography.Text type={r.direction === 'in' ? 'success' : 'danger'}>{yuan(v)}</Typography.Text> },
    { title: '订单号', dataIndex: 'orderNo', width: 180, render: (v: string | null) => v || '-' },
    { title: '退款单号', dataIndex: 'refundNo', width: 180, render: (v: string | null) => v || '-' },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel | null) => (v ? <Tag color={v === 'wechat' ? 'green' : 'blue'}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> : '-') },
    { title: '业务类型', dataIndex: 'bizType', width: 120, render: (v: string | null) => v || '-' },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
  ];

  return (
    <div className="page-container">
      <div style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]} type="flex">
          <Col xs={24} sm={12} xl={6}>
            <StatCard title="收入" value={summary ? yuan(summary.inAmount) : '—'} accent="#10b981" />
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <StatCard title="支出" value={summary ? yuan(summary.outAmount) : '—'} accent="#f97316" />
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <StatCard title="净额" value={summary ? yuan(summary.netAmount) : '—'} accent={summary && summary.netAmount < 0 ? '#ef4444' : '#3b82f6'} />
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <StatCard title="笔数" value={summary?.count ?? '—'} />
          </Col>
        </Row>
      </div>

      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="订单号..." value={searchParams.keyword} onChange={(v) => setSearchParams((p) => ({ ...p, keyword: v }))} showClear style={{ width: 200 }} onEnterPress={handleSearch} />
        <Select placeholder="收支方向" value={searchParams.direction || undefined} onChange={(v) => setSearchParams((p) => ({ ...p, direction: (v as string) ?? '' }))} showClear style={{ width: 120 }}
          optionList={Object.entries(PAYMENT_LEDGER_DIRECTION_LABELS).map(([value, label]) => ({ value, label }))} />
        <Select placeholder="流水类型" value={searchParams.type || undefined} onChange={(v) => setSearchParams((p) => ({ ...p, type: (v as string) ?? '' }))} showClear style={{ width: 120 }}
          optionList={Object.entries(PAYMENT_LEDGER_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
        <Select placeholder="全部渠道" value={searchParams.channel || undefined} onChange={(v) => setSearchParams((p) => ({ ...p, channel: (v as string) ?? '' }))} showClear style={{ width: 120 }}
          optionList={[{ value: 'wechat', label: '微信支付' }, { value: 'alipay', label: '支付宝' }]} />
        <DatePicker type="dateTimeRange" placeholder={['开始时间', '结束时间']} value={searchParams.timeRange ?? undefined} onChange={(v) => setSearchParams((p) => ({ ...p, timeRange: v ? (v as [Date, Date]) : null }))} style={{ width: 330 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch} disabled={!canView}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset} disabled={!canView}>重置</Button>
      </SearchToolbar>

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)}
      />
    </div>
  );
}
