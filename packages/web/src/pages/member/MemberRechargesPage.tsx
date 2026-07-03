import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Input, Select, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw } from 'lucide-react';
import type { MemberRecharge, PaymentChannel, PaymentOrderStatus } from '@zenith/shared';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_ORDER_STATUS_LABELS } from '@zenith/shared';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { renderEllipsis } from '../../utils/table-columns';
import { formatDateForApi } from '@/utils/date';
import { memberAdminKeys, useMemberRechargeList } from '@/hooks/queries/member-admin';

interface SearchParams {
  keyword?: string;
  status?: PaymentOrderStatus;
  channel?: PaymentChannel;
  dateRange: [Date, Date] | null;
}

const defaultSearch: SearchParams = { keyword: undefined, status: undefined, channel: undefined, dateRange: null };

const statusOptions = (Object.keys(PAYMENT_ORDER_STATUS_LABELS) as PaymentOrderStatus[]).map((v) => ({ value: v, label: PAYMENT_ORDER_STATUS_LABELS[v] }));
const channelOptions = (Object.keys(PAYMENT_CHANNEL_LABELS) as PaymentChannel[]).map((v) => ({ value: v, label: PAYMENT_CHANNEL_LABELS[v] }));

const STATUS_COLORS: Record<PaymentOrderStatus, string> = {
  pending: 'grey', paying: 'blue', success: 'green', closed: 'grey', refunding: 'orange', refunded: 'orange', failed: 'red',
};

export default function MemberRechargesPage() {
  const queryClient = useQueryClient();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [dateStart, dateEnd] = submittedParams.dateRange ?? [];
  const listQuery = useMemberRechargeList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    channel: submittedParams.channel || undefined,
    dateStart: dateStart ? formatDateForApi(dateStart) : undefined,
    dateEnd: dateEnd ? formatDateForApi(dateEnd) : undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: memberAdminKeys.rechargeLists });
  };
  const handleReset = () => {
    setDraftParams(defaultSearch);
    setSubmittedParams(defaultSearch);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: memberAdminKeys.rechargeLists });
  };

  const columns: ColumnProps<MemberRecharge>[] = [
    { title: '订单号', dataIndex: 'orderNo', width: 200, fixed: 'left', render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    { title: '会员', dataIndex: 'memberNickname', width: 140, render: (v: string | null, r: MemberRecharge) => v || (r.memberId ? `#${r.memberId}` : '—') },
    { title: '手机号', dataIndex: 'memberPhone', width: 130, render: (v: string | null) => v ?? '—' },
    { title: '金额(元)', dataIndex: 'amount', width: 110, render: (v: number) => <span style={{ fontWeight: 600 }}>{(v / 100).toFixed(2)}</span> },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => PAYMENT_CHANNEL_LABELS[v] ?? v },
    { title: '支付方式', dataIndex: 'payMethod', width: 130, render: (v: string) => PAYMENT_METHOD_LABELS[v as keyof typeof PAYMENT_METHOD_LABELS] ?? v },
    { title: '说明', dataIndex: 'subject', width: 160, render: (v: string) => renderEllipsis(v) },
    { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: (v: PaymentOrderStatus) => <Tag color={STATUS_COLORS[v] as 'green'}>{PAYMENT_ORDER_STATUS_LABELS[v] ?? v}</Tag> },
    { title: '支付时间', dataIndex: 'paidAt', width: 180, fixed: 'right', render: (v: string | null) => v ?? '—' },
    { title: '创建时间', dataIndex: 'createdAt', width: 180, fixed: 'right' },
  ];

  const renderKeywordSearch = () => (
    <Input
      placeholder="会员昵称/手机号/订单号"
      prefix={<Search size={14} />}
      value={draftParams.keyword}
      showClear
      style={{ width: 220 }}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value || undefined }))}
      onEnterPress={handleSearch}
    />
  );

  const renderChannelFilter = () => (
    <Select
      placeholder="全部渠道"
      value={draftParams.channel}
      style={{ width: 120 }}
      showClear
      optionList={channelOptions}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, channel: value as PaymentChannel | undefined }))}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status}
      style={{ width: 130 }}
      showClear
      optionList={statusOptions}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, status: value as PaymentOrderStatus | undefined }))}
    />
  );

  const renderDateRangeFilter = () => (
    <DatePicker
      type="dateRange"
      placeholder={['开始日期', '结束日期']}
      value={draftParams.dateRange ?? undefined}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, dateRange: value ? (value as [Date, Date]) : null }))}
      style={{ width: 300 }}
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
            {renderStatusFilter()}
            {renderDateRangeFilter()}
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
            {renderStatusFilter()}
            {renderDateRangeFilter()}
          </>
        )}
        filterTitle="充值记录筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="id"
        size="small"
        pagination={buildPagination(total)}
        empty="暂无充值记录"
        scroll={{ x: 1500 }}
      />
    </div>
  );
}
