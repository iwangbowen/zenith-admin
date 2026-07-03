import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Input, Modal, Select, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import { PAYMENT_CHANNEL_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentNotifyLog } from '@zenith/shared';
import { paymentLogKeys, usePaymentLogList } from '@/hooks/queries/payment-logs';

interface SearchParams { keyword: string; channel: string; scene: string; signatureValid: string; timeRange: [Date, Date] | null; }
const defaultSearch: SearchParams = { keyword: '', channel: '', scene: '', signatureValid: '', timeRange: null };

function formatRaw(raw: string | null | undefined): string {
  if (!raw) return '';
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

const codeBlockStyle: CSSProperties = {
  maxHeight: 260, overflow: 'auto', fontSize: 12, background: 'var(--semi-color-fill-0)',
  padding: 12, borderRadius: 4, wordBreak: 'break-all', whiteSpace: 'pre-wrap', margin: 0,
};

export default function PaymentLogsPage() {
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);
  const [detailLog, setDetailLog] = useState<PaymentNotifyLog | null>(null);

  function buildQuery(active: SearchParams): Record<string, string> {
    const query: Record<string, string> = {};
    if (active.keyword) query.keyword = active.keyword;
    if (active.channel) query.channel = active.channel;
    if (active.scene) query.scene = active.scene;
    if (active.signatureValid) query.signatureValid = active.signatureValid;
    if (active.timeRange) {
      query.startTime = formatDateTimeForApi(active.timeRange[0]);
      query.endTime = formatDateTimeForApi(active.timeRange[1]);
    }
    return query;
  }

  const listQuery = usePaymentLogList({ page, pageSize, ...buildQuery(submittedParams) });
  const data = listQuery.data ?? null;

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: paymentLogKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearch); setSubmittedParams(defaultSearch); setPage(1); void queryClient.invalidateQueries({ queryKey: paymentLogKeys.lists }); }

  const columns: ColumnProps<PaymentNotifyLog>[] = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={v === 'wechat' ? 'green' : 'blue'}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '场景', dataIndex: 'scene', width: 100, render: (v: string) => (v === 'refund' ? '退款回调' : '支付回调') },
    { title: '订单号', dataIndex: 'orderNo', width: 200, render: (v: string | null) => v || '-' },
    { title: '验签', dataIndex: 'signatureValid', width: 90, render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? '通过' : '失败'}</Tag> },
    { title: '结果', dataIndex: 'result', width: 120, render: (v: string | null) => v || '-' },
    { title: '说明', dataIndex: 'message', width: 220, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 200 }}>{v || '-'}</Typography.Text> },
    { title: 'IP', dataIndex: 'ip', width: 140, render: (v: string | null) => v || '-' },
    { title: '时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    createOperationColumn<PaymentNotifyLog>({
      width: 80,
      actions: (r) => [{
        key: 'detail',
        label: '详情',
        disabled: !r.rawBody && !r.headers,
        disabledReason: '无详情内容',
        onClick: () => setDetailLog(r),
      }],
    }),
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

  const renderSceneFilter = () => (
    <Select
      placeholder="全部场景"
      value={draftParams.scene || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, scene: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={[{ value: 'payment', label: '支付回调' }, { value: 'refund', label: '退款回调' }]}
    />
  );

  const renderSignatureFilter = () => (
    <Select
      placeholder="验签结果"
      value={draftParams.signatureValid || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, signatureValid: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={[{ value: 'true', label: '验签通过' }, { value: 'false', label: '验签失败' }]}
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

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderChannelFilter()}
            {renderSceneFilter()}
            {renderSignatureFilter()}
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
            {renderChannelFilter()}
            {renderSceneFilter()}
            {renderSignatureFilter()}
            {renderTimeRangeFilter()}
          </>
        )}
        filterTitle="支付回调日志筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(data?.total ?? 0)}
      />

      <Modal
        title={`回调详情（#${detailLog?.id ?? ''}）`}
        visible={!!detailLog}
        onCancel={() => setDetailLog(null)}
        footer={null}
        width={720}
        closeOnEsc
      >
        {detailLog && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Tag color={detailLog.channel === 'wechat' ? 'green' : 'blue'}>{PAYMENT_CHANNEL_LABELS[detailLog.channel]}</Tag>
              <Tag color="grey">{detailLog.scene === 'refund' ? '退款回调' : '支付回调'}</Tag>
              <Tag color={detailLog.signatureValid ? 'green' : 'red'}>{detailLog.signatureValid ? '验签通过' : '验签失败'}</Tag>
              {detailLog.orderNo && <Typography.Text type="tertiary">订单号：{detailLog.orderNo}</Typography.Text>}
            </div>
            {detailLog.message && <Typography.Text type="warning">{detailLog.message}</Typography.Text>}
            {detailLog.headers && (
              <div>
                <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>请求头</Typography.Text>
                <pre style={codeBlockStyle}>{formatRaw(detailLog.headers)}</pre>
              </div>
            )}
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>原始 Body</Typography.Text>
              <pre style={codeBlockStyle}>{formatRaw(detailLog.rawBody) || '（无）'}</pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
