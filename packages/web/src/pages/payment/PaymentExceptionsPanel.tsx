import { Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { ListSearchToolbar } from '@/components/list-page';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { useListPage } from '@/hooks/useListPage';
import { enumValueOf } from '@zenith/shared/core';
import {
  PAYMENT_CHANNEL_LABELS,
  PAYMENT_EXCEPTION_STATUSES,
  PAYMENT_EXCEPTION_STATUS_LABELS,
  PAYMENT_EXCEPTION_STATUS_OPTIONS,
  PAYMENT_EXCEPTION_TYPES,
  PAYMENT_EXCEPTION_TYPE_LABELS,
  PAYMENT_EXCEPTION_TYPE_OPTIONS,
  type PaymentException,
} from '@zenith/shared/payment';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { formatYuan } from '@/utils/payment';
import { paymentEventKeys, useHandlePaymentException, usePaymentExceptionList } from '@/hooks/queries/payment-events';
import { formatDateTimeRangeForApi } from '@/utils/date';

interface SearchParams {
  keyword: string;
  status?: string;
  type?: string;
  timeRange: [Date, Date] | null;
}

const defaultSearch: SearchParams = { keyword: '', status: undefined, type: undefined, timeRange: null };

const STATUS_COLOR = { open: 'orange', resolved: 'green', ignored: 'grey' } as const;

export default function PaymentExceptionsPanel() {
  const {
    bind,
    bindKeyword,
    handleSearch,
    handleReset,
    tableProps,
  } = useListPage({
    defaults: defaultSearch,
    listKey: paymentEventKeys.exceptionLists,
    useList: usePaymentExceptionList,
    toQuery: (s) => ({
      keyword: s.keyword,
      status: enumValueOf(PAYMENT_EXCEPTION_STATUSES, s.status),
      type: enumValueOf(PAYMENT_EXCEPTION_TYPES, s.type),
      ...formatDateTimeRangeForApi(s.timeRange),
    }),
  });
  const actionMutation = useHandlePaymentException();

  function handleAction(record: PaymentException, action: 'resolve' | 'ignore') {
    actionMutation.mutate(
      { params: { id: record.id }, body: { action } },
      { onSuccess: () => Toast.success(action === 'resolve' ? '已标记处理' : '已忽略') },
    );
  }

  const columns: ColumnProps<PaymentException>[] = [
    { title: '类型', dataIndex: 'type', width: 150, render: (value: PaymentException['type']) => PAYMENT_EXCEPTION_TYPE_LABELS[value] ?? value },
    { title: '订单号', dataIndex: 'orderNo', width: 220, render: renderEllipsis },
    { title: '退款单号', dataIndex: 'refundNo', width: 220, render: renderEllipsis },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (value: PaymentException['channel']) => value ? PAYMENT_CHANNEL_LABELS[value] ?? value : '—' },
    { title: '金额', dataIndex: 'amount', width: 110, align: 'right', render: (value: number | null | undefined) => value == null ? '—' : formatYuan(value) },
    { title: '说明', dataIndex: 'message', minWidth: 260, render: renderEllipsis },
    dateTimeColumn('创建时间', 'createdAt'),
    { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: (value: PaymentException['status']) => <Tag color={STATUS_COLOR[value]}>{PAYMENT_EXCEPTION_STATUS_LABELS[value]}</Tag> },
    createOperationColumn<PaymentException>({
      width: 160,
      desktopInlineKeys: ['resolve'],
      actions: (r) => r.status === 'open' ? [
        { key: 'resolve', label: '标记处理', onClick: () => handleAction(r, 'resolve') },
        { key: 'ignore', label: '忽略', onClick: () => handleAction(r, 'ignore') },
      ] : [],
    }),
  ];

  return (
    <>
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="订单号/退款单号/错误信息..." {...bindKeyword('keyword')} width={240} />}
        filters={(
          <>
            <StatusSelect items={PAYMENT_EXCEPTION_STATUS_OPTIONS} {...bind('status')} />
            <FilterSelect placeholder="全部类型" items={PAYMENT_EXCEPTION_TYPE_OPTIONS} {...bind('type')} width={150} />
            <DateRangeFilter placeholder={['创建开始', '创建结束']} {...bind('timeRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="支付异常筛选"
      />
      <ConfigurableTable<PaymentException>
        columns={columns}
        empty="暂无支付异常"
        {...tableProps}
      />
      <Typography.Text type="tertiary" size="small">
        异常只记录渠道与本地状态不一致的事实；确认入账、原路退款等资金动作仍走订单/退款流程。
      </Typography.Text>
    </>
  );
}
