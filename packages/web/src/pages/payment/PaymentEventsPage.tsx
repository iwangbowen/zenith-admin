import { Spin, Table, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
// 直接引组件文件而非 charts 桶文件：后者会连带引入 ~2MB 的 vchart，本页无图表
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { JsonBlock } from '@/components/JsonBlock';
import { PaymentExpandedDetail } from './payment-expanded-detail';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_EVENT_ATTEMPT_STATUS_LABELS, PAYMENT_OUTBOX_EVENT_STATUS_LABELS, PAYMENT_OUTBOX_EVENT_STATUS_OPTIONS, PAYMENT_OUTBOX_EVENT_STATUSES, type PaymentEventAttempt, type PaymentOutboxEvent } from '@zenith/shared/payment';
import { paymentEventKeys, usePaymentEventAttempts, usePaymentEventList, usePaymentOpsHealth, useRedispatchPaymentEvent } from '@/hooks/queries/payment-events';
import { ListSearchToolbar } from '@/components/list-page';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { copyableNoColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { enumValueOf } from '@zenith/shared/core';
import { useListPage } from '@/hooks/useListPage';
import { useListDeepLink } from '@/hooks/useListDeepLink';

const EVENT_STATUS_COLOR = { pending: 'blue', running: 'cyan', retrying: 'orange', succeeded: 'green', skipped: 'grey', dead: 'red' } as const satisfies Record<PaymentOutboxEvent['status'], string>;
const ATTEMPT_STATUS_COLOR = { running: 'blue', succeeded: 'green', skipped: 'grey', failed: 'red' } as const satisfies Record<PaymentEventAttempt['status'], string>;
const HEALTH_LABELS = [
  ['outboxPending', 'Outbox 积压'],
  ['outboxFailed', 'Outbox 死信'],
  ['webhookPending', 'Webhook 待投递'],
  ['webhookFailed24h', 'Webhook 24h失败'],
  ['sharingProcessing', '分账处理中'],
  ['transferProcessing', '转账处理中'],
  ['reconPendingDiff', '待处理对账差异'],
] as const;

interface SearchParams { keyword: string; status?: string; type?: string; }
const defaultSearch: SearchParams = { keyword: '', status: undefined, type: undefined };

/** payload 为 JSON 字符串时美化缩进，解析失败原样展示 */
function formatPayload(raw: Record<string, unknown>): string {
  return JSON.stringify(raw, null, 2);
}

const attemptColumns: ColumnProps<PaymentEventAttempt>[] = [
  { title: '轮次', dataIndex: 'generation', width: 70, align: 'right' },
  { title: '序号', dataIndex: 'attemptNo', width: 70, align: 'right' },
  { title: '状态', dataIndex: 'status', width: 90, render: (status: PaymentEventAttempt['status']) => <Tag color={ATTEMPT_STATUS_COLOR[status]}>{PAYMENT_EVENT_ATTEMPT_STATUS_LABELS[status]}</Tag> },
  dateTimeColumn('开始时间', 'startedAt') as ColumnProps<PaymentEventAttempt>,
  dateTimeColumn('结束时间', 'finishedAt') as ColumnProps<PaymentEventAttempt>,
  { title: '错误信息', dataIndex: 'errorMessage', minWidth: 260, render: renderEllipsis },
];

function PaymentEventExpandedDetail({ event }: Readonly<{ event: PaymentOutboxEvent }>) {
  const attemptsQuery = usePaymentEventAttempts(event.id);
  return (
    <PaymentExpandedDetail
      meta={`事件：${event.eventId} · 消费者：${event.consumerKey} · 当前轮次：${event.generation}`}
      sections={[
        { title: '当前错误', visible: Boolean(event.lastError), content: <Typography.Text type="danger" style={{ wordBreak: 'break-all' }}>{event.lastError}</Typography.Text> },
        {
          title: '投递尝试历史',
          content: (
            <Spin spinning={attemptsQuery.isPending}>
              {attemptsQuery.isError
                ? <Typography.Text type="danger">投递尝试加载失败：{attemptsQuery.error.message}</Typography.Text>
                : (
                    <Table<PaymentEventAttempt>
                      columns={attemptColumns}
                      dataSource={attemptsQuery.data ?? []}
                      rowKey="id"
                      pagination={false}
                      size="small"
                      empty="暂无投递尝试"
                    />
                  )}
            </Spin>
          ),
        },
        { title: '消费者结果', visible: Boolean(event.result), content: <JsonBlock value={event.result ?? {}} /> },
        { title: '事件载荷', content: <JsonBlock value={formatPayload(event.payload)} /> },
      ]}
    />
  );
}

export default function PaymentEventsPage() {
  const { hasPermission } = usePermission();
  const {
    bind,
    bindKeyword,
    handleSearch,
    handleReset,
    applySearch,
    tableProps,
  } = useListPage({
    defaults: defaultSearch,
    listKey: paymentEventKeys.lists,
    useList: usePaymentEventList,
    toQuery: (s) => ({ keyword: s.keyword, status: enumValueOf(PAYMENT_OUTBOX_EVENT_STATUSES, s.status), type: s.type }),
  });
  useListDeepLink(['status'], (picked) => applySearch({ ...defaultSearch, status: enumValueOf(PAYMENT_OUTBOX_EVENT_STATUSES, picked.status) }));
  const healthQuery = usePaymentOpsHealth();
  const health = healthQuery.data ?? null;
  const redispatchMutation = useRedispatchPaymentEvent();
  const redispatchingId = redispatchMutation.isPending ? (redispatchMutation.variables?.params.id ?? null) : null;

  function handleRedispatch(record: PaymentOutboxEvent) {
    redispatchMutation.mutate({ params: { id: record.id } }, {
      onSuccess: (event) => {
        Toast.success(event.status === 'pending' ? '消费者已重新入队' : '消费者重试已提交');
      },
    });
  }

  const columns: ColumnProps<PaymentOutboxEvent>[] = [
    // 订单号置于首列承载展开箭头；内部事件 ID 移入展开详情
    copyableNoColumn('订单号', 'orderNo', { width: 300 }),
    { title: '事件类型', dataIndex: 'type', width: 180, render: renderEllipsis },
    { title: '消费者', dataIndex: 'consumerKey', width: 220, render: renderEllipsis },
    { title: '当前轮次', dataIndex: 'generation', width: 90, align: 'right' },
    { title: '本轮次数', dataIndex: 'attempts', width: 90, align: 'right' },
    { title: '当前错误', dataIndex: 'lastError', minWidth: 260, render: renderEllipsis },
    dateTimeColumn('创建时间', 'createdAt'),
    dateTimeColumn('完成时间', 'finishedAt'),
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentOutboxEvent['status']) => <Tag color={EVENT_STATUS_COLOR[v]}>{PAYMENT_OUTBOX_EVENT_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentOutboxEvent>({
      width: 100,
      actions: (r) => [
        ...((r.status === 'dead' || r.status === 'retrying') && hasPermission('payment:ops:manage') ? [{
          key: 'redispatch',
          label: '重投',
          loading: redispatchingId === r.id,
          onClick: () => handleRedispatch(r),
        }] : []),
      ],
    }),
  ];

  const renderExpanded = (event?: PaymentOutboxEvent) => event ? <PaymentEventExpandedDetail event={event} /> : null;

  // 与订单统计等页面统一的无边框统计形态（StatGrid/StatCard）

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="订单号..." {...bindKeyword('keyword')} width={200} />}
        filters={(
          <>
            <StatusSelect
              items={PAYMENT_OUTBOX_EVENT_STATUS_OPTIONS}
              {...bind('status')}
            />
            <KeywordInput placeholder="事件类型..." {...bindKeyword('type')} width={180} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="支付事件筛选"
      />

      <StatGrid minItemWidth={148} style={{ marginBottom: 12 }}>
        {HEALTH_LABELS.map(([key, label]) => {
          const value = health?.[key] ?? 0;
          const danger = (key === 'outboxFailed' || key === 'webhookFailed24h') && value > 0;
          return <StatCard key={key} title={label} value={value} accent={danger ? 'var(--semi-color-danger)' : undefined} />;
        })}
      </StatGrid>

      <ConfigurableTable
        columns={columns}
        empty="暂无数据"
        {...tableProps}
        expandedRowRender={renderExpanded}
        expandRowByClick
      />
    </div>
  );
}
