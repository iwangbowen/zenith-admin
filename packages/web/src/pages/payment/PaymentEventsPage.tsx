import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateTime } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import type { PaymentOutboxEvent } from '@zenith/shared';
import { paymentEventKeys, usePaymentEventList, useRedispatchPaymentEvent } from '@/hooks/queries/payment-events';

const EVENT_STATUS_LABELS = { pending: '待处理', done: '已完成', failed: '失败' } as const satisfies Record<PaymentOutboxEvent['status'], string>;
const EVENT_STATUS_COLOR = { pending: 'blue', done: 'green', failed: 'red' } as const satisfies Record<PaymentOutboxEvent['status'], string>;

interface SearchParams { keyword: string; status: string; type: string; }
const defaultSearch: SearchParams = { keyword: '', status: '', type: '' };

export default function PaymentEventsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);
  const listQuery = usePaymentEventList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    type: submittedParams.type || undefined,
  });
  const data = listQuery.data ?? null;
  const redispatchMutation = useRedispatchPaymentEvent();
  const redispatchingId = redispatchMutation.isPending ? (redispatchMutation.variables ?? null) : null;

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: paymentEventKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearch); setSubmittedParams(defaultSearch); setPage(1); void queryClient.invalidateQueries({ queryKey: paymentEventKeys.lists }); }

  function handleRedispatch(record: PaymentOutboxEvent) {
    redispatchMutation.mutate(record.id, { onSuccess: () => Toast.success('重投成功') });
  }

  const columns: ColumnProps<PaymentOutboxEvent>[] = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '事件类型', dataIndex: 'type', width: 180 },
    { title: '订单号', dataIndex: 'orderNo', width: 200 },
    { title: '次数', dataIndex: 'attempts', width: 80 },
    { title: '错误信息', dataIndex: 'lastError', width: 260, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 240 }}>{v || '-'}</Typography.Text> },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    { title: '处理时间', dataIndex: 'processedAt', width: 170, render: (t: string | null) => (t ? formatDateTime(t) : '-') },
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentOutboxEvent['status']) => <Tag color={EVENT_STATUS_COLOR[v]}>{EVENT_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentOutboxEvent>({
      width: 90,
      actions: (r) => [
        ...(r.status !== 'done' && hasPermission('payment:ops:manage') ? [{
          key: 'redispatch',
          label: '重投',
          loading: redispatchingId === r.id,
          onClick: () => handleRedispatch(r),
        }] : []),
      ],
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

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );

  const renderTypeFilter = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="事件类型..."
      value={draftParams.type}
      onChange={(v) => setDraftParams((p) => ({ ...p, type: v }))}
      showClear
      style={{ width: 180 }}
      onEnterPress={handleSearch}
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
            {renderStatusFilter()}
            {renderTypeFilter()}
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
            {renderStatusFilter()}
            {renderTypeFilter()}
          </>
        )}
        filterTitle="支付事件筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(data?.total ?? 0)}
      />
    </div>
  );
}
