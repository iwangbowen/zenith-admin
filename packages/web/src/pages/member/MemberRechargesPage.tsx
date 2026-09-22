import { Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { MemberRecharge, MemberRechargeStatus } from '@zenith/shared/member';
import { MEMBER_RECHARGE_STATUSES } from '@zenith/shared/member';
import type { PaymentChannel, PaymentOrderStatus } from '@zenith/shared/payment';
import { PAYMENT_ORDER_STATUS_TAG_COLOR } from '@/utils/payment';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_ORDER_STATUS_LABELS } from '@zenith/shared/payment';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar } from '@/components/list-page';
import ExportButton from '@/components/ExportButton';
import { dateTimeColumn, renderCodeEllipsis, renderEllipsis } from '../../utils/table-columns';
import { formatDateRangeValuesForApi } from '@/utils/date';
import { memberAdminKeys, useMemberRechargeList } from '@/hooks/queries/member-admin';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { memberCellColumn, useMemberKeywordDeepLink } from './member-admin-display';
import { useListPage } from '@/hooks/useListPage';

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

export default function MemberRechargesPage() {
  const {
    bind,
    bindKeyword,
    handleSearch,
    handleReset,
    applySearch,
    tableProps,
    filterQuery,
  } = useListPage({
    defaults: defaultSearch,
    listKey: memberAdminKeys.rechargeLists,
    useList: useMemberRechargeList,
    toQuery: (s) => {
      const [dateStart, dateEnd] = formatDateRangeValuesForApi(s.dateRange);
      return { keyword: s.keyword, status: s.status, channel: s.channel, dateStart, dateEnd };
    },
    table: { empty: '暂无充值记录' },
  });
  useMemberKeywordDeepLink<SearchParams>({ applySearch, buildParams: (memberKeyword) => ({ keyword: memberKeyword, dateRange: null }) });

  const columns: ColumnProps<MemberRecharge>[] = [
    // 订单号是 genPaymentNo 生成的单号（"PAY" + 13 位毫秒 + 4 位尾号 = 20 字符，等宽字体约 168px），
    // 原 200 定宽可用宽只剩 168，再长一点就折行；改用等宽字体单行省略 + tooltip
    { title: '订单号', dataIndex: 'orderNo', width: 240, fixed: 'left', render: renderCodeEllipsis },
    memberCellColumn<MemberRecharge>({ width: 180, nameField: 'memberNickname', idField: 'memberId', ellipsis: true }),
    { title: '手机号', dataIndex: 'memberPhone', width: 130, render: (v: string | null) => v ?? '—' },
    { title: '金额(元)', dataIndex: 'amount', width: 110, align: 'right', render: (v: number) => <span style={{ fontWeight: 600 }}>{(v / 100).toFixed(2)}</span> },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => PAYMENT_CHANNEL_LABELS[v] ?? v },
    { title: '支付方式', dataIndex: 'payMethod', width: 130, render: (v: string) => PAYMENT_METHOD_LABELS[v as keyof typeof PAYMENT_METHOD_LABELS] ?? v },
    { title: '说明', dataIndex: 'subject', minWidth: 160, render: (v: string) => renderEllipsis(v) },
    { title: '状态', dataIndex: 'status', width: 110, fixed: 'right', render: (v: PaymentOrderStatus) => <Tag color={PAYMENT_ORDER_STATUS_TAG_COLOR[v]}>{PAYMENT_ORDER_STATUS_LABELS[v] ?? v}</Tag> },
    dateTimeColumn('支付时间', 'paidAt', { fixed: 'right' }),
    dateTimeColumn('创建时间', 'createdAt', { fixed: 'right' }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="会员昵称/手机号/订单号" {...bindKeyword('keyword')} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部渠道"
              items={channelOptions}
              {...bind('channel')}
            />
            <StatusSelect
              items={statusOptions}
              {...bind('status')}
            />
            <DateRangeFilter type="dateRange" {...bind('dateRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={<ExportButton entity="member.recharges" query={filterQuery} permission="member:recharge:list" />}
        filterTitle="充值记录筛选"
      />

      <ConfigurableTable<MemberRecharge>
        columns={columns}
        {...tableProps}
      />
    </div>
  );
}
