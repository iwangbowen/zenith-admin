import { Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { MemberRecharge, MemberRechargeStatus } from '@zenith/shared/member';
import { MEMBER_RECHARGE_STATUSES } from '@zenith/shared/member';
import type { PaymentChannel, PaymentOrderStatus } from '@zenith/shared/payment';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_ORDER_STATUS_LABELS } from '@zenith/shared/payment';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { dateTimeColumn, renderEllipsis } from '../../utils/table-columns';
import { formatDateForApi } from '@/utils/date';
import { memberAdminKeys, useMemberRechargeList } from '@/hooks/queries/member-admin';
import { useListSearch } from '@/hooks/useListSearch';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';

interface SearchParams {
  keyword?: string;
  status?: MemberRechargeStatus;
  channel?: PaymentChannel;
  dateRange: [Date, Date] | null;
}

const defaultSearch: SearchParams = { keyword: undefined, status: undefined, channel: undefined, dateRange: null };

// 筛选项与服务端可筛选状态对齐：不含瞬态的 unknown（渠道结果待确认）
const statusOptions = MEMBER_RECHARGE_STATUSES.map((v) => ({ value: v, label: PAYMENT_ORDER_STATUS_LABELS[v] }));
const channelOptions = (Object.keys(PAYMENT_CHANNEL_LABELS) as PaymentChannel[]).map((v) => ({ value: v, label: PAYMENT_CHANNEL_LABELS[v] }));

const STATUS_COLORS: Record<PaymentOrderStatus, string> = {
  pending: 'grey', paying: 'blue', unknown: 'amber', success: 'green', closed: 'grey', refunding: 'orange', refunded: 'orange', failed: 'red',
};

export default function MemberRechargesPage() {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset, applySearch,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: memberAdminKeys.rechargeLists });
  // 会员详情等入口的深链筛选（?memberKeyword=，消费后即从 URL 移除）
  useListDeepLink(['memberKeyword'], (p) => applySearch({ keyword: p.memberKeyword, dateRange: null }));
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

  const columns: ColumnProps<MemberRecharge>[] = [
    { title: '订单号', dataIndex: 'orderNo', width: 200, fixed: 'left', render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    { title: '会员', dataIndex: 'memberNickname', width: 140, render: (v: string | null, r: MemberRecharge) => v || (r.memberId ? `#${r.memberId}` : '—') },
    { title: '手机号', dataIndex: 'memberPhone', width: 130, render: (v: string | null) => v ?? '—' },
    { title: '金额(元)', dataIndex: 'amount', width: 110, align: 'right', render: (v: number) => <span style={{ fontWeight: 600 }}>{(v / 100).toFixed(2)}</span> },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => PAYMENT_CHANNEL_LABELS[v] ?? v },
    { title: '支付方式', dataIndex: 'payMethod', width: 130, render: (v: string) => PAYMENT_METHOD_LABELS[v as keyof typeof PAYMENT_METHOD_LABELS] ?? v },
    { title: '说明', dataIndex: 'subject', minWidth: 160, render: (v: string) => renderEllipsis(v) },
    { title: '状态', dataIndex: 'status', width: 110, fixed: 'right', render: (v: PaymentOrderStatus) => <Tag color={STATUS_COLORS[v] as 'green'}>{PAYMENT_ORDER_STATUS_LABELS[v] ?? v}</Tag> },
    dateTimeColumn('支付时间', 'paidAt', { fixed: 'right' }),
    dateTimeColumn('创建时间', 'createdAt', { fixed: 'right' }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="会员昵称/手机号/订单号" value={draftParams.keyword} onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))} onSearch={handleSearch} />
  );

  const renderChannelFilter = () => (
    <FilterSelect
      placeholder="全部渠道"
      items={channelOptions}
      value={draftParams.channel}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, channel: value as PaymentChannel | undefined }))}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusOptions}
      value={draftParams.status}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, status: value as MemberRechargeStatus | undefined }))}
    />
  );

  const renderDateRangeFilter = () => (
    <DateRangeFilter type="dateRange" value={draftParams.dateRange ?? undefined} onChange={(value) => setDraftParams((prev) => ({ ...prev, dateRange: value ? (value as [Date, Date]) : null }))} width={300} />
  );

  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const buildExportQuery = () => {
    const [ds, de] = submittedParams.dateRange ?? [];
    return {
      ...(submittedParams.keyword ? { keyword: submittedParams.keyword } : {}),
      ...(submittedParams.status ? { status: submittedParams.status } : {}),
      ...(submittedParams.channel ? { channel: submittedParams.channel } : {}),
      ...(ds ? { dateStart: formatDateForApi(ds) } : {}),
      ...(de ? { dateEnd: formatDateForApi(de) } : {}),
    };
  };
  const renderExportButton = (variant?: 'flat') => hasPermission('member:recharge:list') ? (
    <ExportButton entity="member.recharges" query={buildExportQuery()} variant={variant} />
  ) : null;

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
            {renderExportButton()}
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
        mobileActions={renderExportButton('flat')}
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
      />
    </div>
  );
}
