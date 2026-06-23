import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Banner, Button, DatePicker, Row, Col, Select, Spin } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Search, RotateCcw } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { request } from '@/utils/request';
import { formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_REPORT_GROUP_BY_LABELS } from '@zenith/shared';
import type { PaymentReportGroupBy, PaymentReportRow } from '@zenith/shared';

const yuan = (cents: number) => `¥${((Number(cents) || 0) / 100).toFixed(2)}`;
const groupByOptions = Object.entries(PAYMENT_REPORT_GROUP_BY_LABELS).map(([value, label]) => ({ value, label }));

const sectionStyle: CSSProperties = { background: 'var(--semi-color-bg-1)', border: '1px solid var(--semi-color-border)', borderRadius: 6, padding: '16px 20px' };
const tooltipStyle: CSSProperties = { backgroundColor: 'var(--semi-color-bg-2)', border: '1px solid var(--semi-color-border)', borderRadius: 6, fontSize: 12 };

interface StatCardProps { readonly title: string; readonly value: string | number; readonly accent?: string; }
function StatCard({ title, value, accent }: StatCardProps) {
  return (
    <div style={{ ...sectionStyle, display: 'flex', flexDirection: 'column', gap: 4, height: '100%', minHeight: 84, boxSizing: 'border-box' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? 'var(--semi-color-text-0)', lineHeight: 1.2 }}>{String(value)}</div>
      <div style={{ fontSize: 13, color: 'var(--semi-color-text-1)', marginTop: 'auto' }}>{title}</div>
    </div>
  );
}

interface ReportSummary {
  groupBy: PaymentReportGroupBy;
  rows: PaymentReportRow[];
  totalGross: number;
  totalFee: number;
  totalRefund: number;
  totalNet: number;
  totalCount: number;
}

export default function PaymentReportsPage() {
  const { hasPermission } = usePermission();
  const canView = hasPermission('payment:report:view');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [groupBy, setGroupBy] = useState<PaymentReportGroupBy>('bizType');
  const [timeRange, setTimeRange] = useState<[Date, Date] | null>(null);
  const stateRef = useRef({ groupBy, timeRange });
  stateRef.current = { groupBy, timeRange };

  const fetchSummary = useCallback(async () => {
    if (!canView) return;
    const { groupBy: gb, timeRange: tr } = stateRef.current;
    setLoading(true);
    try {
      const query: Record<string, string> = { groupBy: gb };
      if (tr) { query.startTime = formatDateTimeForApi(tr[0]); query.endTime = formatDateTimeForApi(tr[1]); }
      const res = await request.get<ReportSummary>(`/api/payment/reports/summary?${new URLSearchParams(query)}`);
      if (res.code === 0) setSummary(res.data);
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useEffect(() => {
    void fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleReset() { setGroupBy('bizType'); setTimeRange(null); stateRef.current = { groupBy: 'bizType', timeRange: null }; void fetchSummary(); }

  const chartData = (summary?.rows ?? []).map((r) => ({ name: r.label, 收款: Number((r.gross / 100).toFixed(2)), 净额: Number((r.net / 100).toFixed(2)) }));

  const columns: ColumnProps<PaymentReportRow>[] = [
    { title: PAYMENT_REPORT_GROUP_BY_LABELS[summary?.groupBy ?? 'bizType'], dataIndex: 'label', width: 160 },
    { title: '收款', dataIndex: 'gross', width: 130, render: (v: number) => yuan(v) },
    { title: '手续费', dataIndex: 'fee', width: 120, render: (v: number) => yuan(v) },
    { title: '退款', dataIndex: 'refund', width: 120, render: (v: number) => yuan(v) },
    { title: '净额', dataIndex: 'net', width: 130, render: (v: number) => yuan(v) },
    { title: '成功笔数', dataIndex: 'count', width: 100 },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Select value={groupBy} onChange={(v) => setGroupBy(v as PaymentReportGroupBy)} style={{ width: 140 }} optionList={groupByOptions} prefix="维度" />
        <DatePicker type="dateTimeRange" placeholder={['开始时间', '结束时间']} value={timeRange ?? undefined} onChange={(v) => setTimeRange(v ? (v as [Date, Date]) : null)} style={{ width: 330 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={() => void fetchSummary()} disabled={!canView}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset} disabled={!canView}>重置</Button>
      </SearchToolbar>

      {!canView && (
        <Banner
          type="warning"
          bordered
          closeIcon={null}
          description="当前账号缺少「payment:report:view」权限，无法查看财务报表。"
          style={{ marginBottom: 12 }}
        />
      )}

      <Spin spinning={loading}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Row gutter={[16, 16]} type="flex">
            <Col xs={24} sm={12} xl={5}><StatCard title="收款总额" value={summary ? yuan(summary.totalGross) : '—'} accent="#10b981" /></Col>
            <Col xs={24} sm={12} xl={5}><StatCard title="手续费总额" value={summary ? yuan(summary.totalFee) : '—'} accent="#f59e0b" /></Col>
            <Col xs={24} sm={12} xl={5}><StatCard title="退款总额" value={summary ? yuan(summary.totalRefund) : '—'} accent="#f97316" /></Col>
            <Col xs={24} sm={12} xl={5}><StatCard title="净额" value={summary ? yuan(summary.totalNet) : '—'} accent="#3b82f6" /></Col>
            <Col xs={24} sm={12} xl={4}><StatCard title="成功笔数" value={summary?.totalCount ?? '—'} /></Col>
          </Row>

          <div style={sectionStyle}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>收款 / 净额分布</div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ left: -6, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--semi-color-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} minTickGap={8} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => `¥${v}`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="收款" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="净额" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ConfigurableTable
            bordered columns={columns} dataSource={summary?.rows ?? []} loading={loading} rowKey="key" size="small" empty="暂无数据"
            onRefresh={() => void fetchSummary()} refreshLoading={loading} pagination={false}
          />
        </div>
      </Spin>
    </div>
  );
}
