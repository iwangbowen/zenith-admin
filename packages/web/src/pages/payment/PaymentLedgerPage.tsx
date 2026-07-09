import { useState } from 'react';
import { formatYuan, PAYMENT_CHANNEL_TAG_COLOR } from '@/utils/payment';
import type { CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, DatePicker, Input, Row, Col, Select, Skeleton, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  paymentLedgerKeys,
  usePaymentLedgerList,
  usePaymentLedgerSummary,
} from '@/hooks/queries/payment-ledger';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNEL_OPTIONS, PAYMENT_LEDGER_DIRECTION_LABELS, PAYMENT_LEDGER_TYPE_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentLedgerDirection, PaymentLedgerEntry, PaymentLedgerType } from '@zenith/shared';

const yuan = formatYuan;
const sectionStyle: CSSProperties = {
  background: 'var(--semi-color-bg-1)',
  border: '1px solid var(--semi-color-border)',
  borderRadius: 'var(--semi-border-radius-medium)',
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
  const queryClient = useQueryClient();
  const canView = hasPermission('payment:ledger:list');
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);

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

  const filters = buildQuery(submittedParams);
  const listQuery = usePaymentLedgerList({ page, pageSize, ...filters }, canView);
  const summaryQuery = usePaymentLedgerSummary(filters, canView);
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const summary = summaryQuery.data ?? null;
  const loading = listQuery.isFetching || summaryQuery.isFetching;

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: paymentLedgerKeys.all }); }
  function handleReset() { setDraftParams(defaultSearch); setPage(1); setSubmittedParams(defaultSearch); void queryClient.invalidateQueries({ queryKey: paymentLedgerKeys.all }); }

  const columns: ColumnProps<PaymentLedgerEntry>[] = [
    { title: '流水号', dataIndex: 'entryNo', width: 190, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 170 }}>{v}</Typography.Text> },
    { title: '方向', dataIndex: 'direction', width: 90, render: (v: PaymentLedgerDirection) => <Tag color={v === 'in' ? 'green' : 'red'}>{PAYMENT_LEDGER_DIRECTION_LABELS[v]}</Tag> },
    { title: '类型', dataIndex: 'type', width: 100, render: (v: PaymentLedgerType) => PAYMENT_LEDGER_TYPE_LABELS[v] },
    { title: '金额', dataIndex: 'amount', width: 120, render: (v: number, r: PaymentLedgerEntry) => <Typography.Text type={r.direction === 'in' ? 'success' : 'danger'}>{yuan(v)}</Typography.Text> },
    { title: '订单号', dataIndex: 'orderNo', width: 180, render: (v: string | null) => v || '-' },
    { title: '退款单号', dataIndex: 'refundNo', width: 180, render: (v: string | null) => v || '-' },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel | null) => (v ? <Tag color={PAYMENT_CHANNEL_TAG_COLOR[v]}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> : '-') },
    { title: '业务类型', dataIndex: 'bizType', width: 120, render: (v: string | null) => v || '-' },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="订单号..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      showClear
      style={{ width: 200 }}
      onEnterPress={handleSearch}
    />
  );

  const renderDirectionFilter = () => (
    <Select
      placeholder="收支方向"
      value={draftParams.direction || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, direction: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={Object.entries(PAYMENT_LEDGER_DIRECTION_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );

  const renderTypeFilter = () => (
    <Select
      placeholder="流水类型"
      value={draftParams.type || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, type: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={Object.entries(PAYMENT_LEDGER_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );

  const renderChannelFilter = () => (
    <Select
      placeholder="全部渠道"
      value={draftParams.channel || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, channel: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={PAYMENT_CHANNEL_OPTIONS}
    />
  );

  const renderTimeRangeFilter = () => (
    <DatePicker
      type="dateTimeRange"
      placeholder={['开始时间', '结束时间']}
      value={draftParams.timeRange ?? undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, timeRange: v ? (v as [Date, Date]) : null }))}
      style={{ width: 330 }}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch} disabled={!canView}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset} disabled={!canView}>重置</Button>;

  return (
    <div className="page-container">
      <div style={{ marginBottom: 16 }}>
        {loading && !summary ? (
          <Skeleton
            loading
            active
            placeholder={
              <Row gutter={[16, 16]} type="flex">
                {Array.from({ length: 4 }, (_, i) => `sk-ledger-${i}`).map((key) => (
                  <Col key={key} xs={24} sm={12} xl={6}>
                    <div style={{ ...sectionStyle, minHeight: 92, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <Skeleton.Title style={{ width: '60%', marginBottom: 4 }} />
                      <Skeleton.Paragraph rows={1} style={{ width: '40%', marginBottom: 0 }} />
                    </div>
                  </Col>
                ))}
              </Row>
            }
          >{null}</Skeleton>
        ) : (
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
        )}
      </div>

      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderDirectionFilter()}
            {renderTypeFilter()}
            {renderChannelFilter()}
            {renderTimeRangeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderDirectionFilter()}
            {renderTypeFilter()}
            {renderChannelFilter()}
            {renderTimeRangeFilter()}
          </>
        )}
        filterTitle="资金台账筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      {!canView && (
        <Banner
          type="warning"
          bordered
          closeIcon={null}
          description="当前账号缺少「payment:ledger:list」权限，无法查看资金台账。"
          style={{ marginBottom: 12 }}
        />
      )}

      <ConfigurableTable
        bordered columns={columns} dataSource={data} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => { void listQuery.refetch(); void summaryQuery.refetch(); }} refreshLoading={loading} pagination={buildPagination(total)}
      />
    </div>
  );
}
