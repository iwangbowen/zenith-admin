import { Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { MemberRecharge, MemberRechargeStatus } from '@zenith/shared/member';
import { MEMBER_RECHARGE_STATUSES } from '@zenith/shared/member';
import type { PaymentChannel, PaymentOrderStatus } from '@zenith/shared/payment';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_ORDER_STATUS_LABELS } from '@zenith/shared/payment';
import { usePermission } from '@/hooks/usePermission';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import ExportButton from '@/components/ExportButton';
import { dateTimeColumn, renderEllipsis } from '../../utils/table-columns';
import { formatDateForApi } from '@/utils/date';
import { memberAdminKeys, useMemberRechargeList } from '@/hooks/queries/member-admin';
import { useListSearch } from '@/hooks/useListSearch';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { memberCellColumn, useMemberKeywordDeepLink } from './member-admin-display';

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
    draftParams, setField, submittedParams,
    handleSearch, handleReset, applySearch,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: memberAdminKeys.rechargeLists });
  useMemberKeywordDeepLink<SearchParams>({ applySearch, buildParams: (memberKeyword) => ({ keyword: memberKeyword, dateRange: null }) });
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

  const columns: ColumnProps<MemberRecharge>[] = [
    { title: '订单号', dataIndex: 'orderNo', width: 200, fixed: 'left', render: (v: string) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    memberCellColumn<MemberRecharge>({ width: 140, nameField: 'memberNickname', idField: 'memberId' }),
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
    <KeywordInput placeholder="会员昵称/手机号/订单号" value={draftParams.keyword} onChange={setField('keyword')} onSearch={handleSearch} />
  );

  const renderChannelFilter = () => (
    <FilterSelect
      placeholder="全部渠道"
      items={channelOptions}
      value={draftParams.channel}
      onChange={(value) => setField('channel')(value as PaymentChannel | undefined)}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusOptions}
      value={draftParams.status}
      onChange={(value) => setField('status')(value as MemberRechargeStatus | undefined)}
    />
  );

  const renderDateRangeFilter = () => (
    <DateRangeFilter type="dateRange" value={draftParams.dateRange ?? undefined} onChange={(value) => setField('dateRange')(value ? (value as [Date, Date]) : null)} />
  );

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
      <ListSearchToolbar
        keyword={renderKeywordSearch()}
        filters={(
          <>
            {renderChannelFilter()}
            {renderStatusFilter()}
            {renderDateRangeFilter()}
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={renderExportButton()}
        mobileActions={renderExportButton('flat')}
        filterTitle="充值记录筛选"
      />

      <ConfigurableTable<MemberRecharge>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无充值记录' })}
      />
    </div>
  );
}
