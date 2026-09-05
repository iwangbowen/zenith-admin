import { Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
// 直接引组件文件而非 charts 桶文件：后者会连带引入 ~2MB 的 vchart，本页无图表
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { JsonBlock } from '@/components/JsonBlock';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_OUTBOX_EVENT_STATUSES, type PaymentOutboxEvent } from '@zenith/shared/payment';
import { paymentEventKeys, usePaymentEventList, usePaymentOpsHealth, useRedispatchPaymentEvent } from '@/hooks/queries/payment-events';
import { useListSearch } from '@/hooks/useListSearch';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { copyableNoColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { createLabelOptionsFromMap, enumValueOf } from '@zenith/shared/core';

const EVENT_STATUS_LABELS = { pending: '待处理', done: '已完成', failed: '失败' } as const satisfies Record<PaymentOutboxEvent['status'], string>;
const EVENT_STATUS_OPTIONS = createLabelOptionsFromMap(EVENT_STATUS_LABELS);
const EVENT_STATUS_COLOR = { pending: 'blue', done: 'green', failed: 'red' } as const satisfies Record<PaymentOutboxEvent['status'], string>;
const HEALTH_LABELS = [
  ['outboxPending', 'Outbox 积压'],
  ['outboxFailed', 'Outbox 死信'],
  ['webhookPending', 'Webhook 待投递'],
  ['webhookFailed24h', 'Webhook 24h失败'],
  ['sharingProcessing', '分账处理中'],
  ['transferProcessing', '转账处理中'],
  ['reconPendingDiff', '待处理对账差异'],
] as const;

interface SearchParams { keyword: string; status?: string; type: string; }
const defaultSearch: SearchParams = { keyword: '', status: undefined, type: '' };

/** payload 为 JSON 字符串时美化缩进，解析失败原样展示 */
function formatPayload(raw: string | null | undefined): string {
  if (!raw) return '（无）';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function PaymentEventsPage() {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: paymentEventKeys.lists });
  const listQuery = usePaymentEventList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(PAYMENT_OUTBOX_EVENT_STATUSES, submittedParams.status),
    type: submittedParams.type || undefined,
  });
  const data = listQuery.data ?? null;
  const healthQuery = usePaymentOpsHealth();
  const health = healthQuery.data ?? null;
  const redispatchMutation = useRedispatchPaymentEvent();
  const redispatchingId = redispatchMutation.isPending ? (redispatchMutation.variables?.params.id ?? null) : null;

  function handleRedispatch(record: PaymentOutboxEvent) {
    redispatchMutation.mutate({ params: { id: record.id } }, {
      onSuccess: (event) => {
        if (event.status === 'done') {
          Toast.success('事件重投完成');
          return;
        }
        Toast.warning(event.lastError
          ? `事件已重新入队，本次投递仍未完成：${event.lastError}`
          : '事件已重新入队，等待后台继续投递');
      },
    });
  }

  const columns: ColumnProps<PaymentOutboxEvent>[] = [
    // 订单号置于首列承载展开箭头；内部事件 ID 移入展开详情
    copyableNoColumn('订单号', 'orderNo', { width: 300 }),
    { title: '事件类型', dataIndex: 'type', width: 180, render: renderEllipsis },
    { title: '次数', dataIndex: 'attempts', width: 80, align: 'right' },
    { title: '错误信息', dataIndex: 'lastError', minWidth: 260, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 240 }}>{v || '-'}</Typography.Text> },
    dateTimeColumn('创建时间', 'createdAt'),
    dateTimeColumn('处理时间', 'processedAt'),
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentOutboxEvent['status']) => <Tag color={EVENT_STATUS_COLOR[v]}>{EVENT_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentOutboxEvent>({
      width: 100,
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

  /** 行内展开：完整错误信息与事件载荷 */
  const renderExpanded = (r?: PaymentOutboxEvent) => (r ? (
    // flex: 1 + minWidth: 0：Semi 展开行容器是 flex row，不声明会被收缩成内容最小宽
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0', flex: 1, minWidth: 0 }}>
      <Typography.Text type="tertiary" size="small">事件 ID：{r.id}</Typography.Text>
      {r.lastError && (
        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>最近错误</Typography.Text>
          <Typography.Text type="danger" style={{ wordBreak: 'break-all' }}>{r.lastError}</Typography.Text>
        </div>
      )}
      <div>
        <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>事件载荷</Typography.Text>
        <JsonBlock value={formatPayload(r.payload)} />
      </div>
    </div>
  ) : null);

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="订单号..." value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} width={200} />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={EVENT_STATUS_OPTIONS}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderTypeFilter = () => (
    <KeywordInput placeholder="事件类型..." value={draftParams.type} onChange={(v) => setDraftParams((p) => ({ ...p, type: v }))} onSearch={handleSearch} width={180} />
  );

  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  // 与订单统计等页面统一的无边框统计形态（StatGrid/StatCard）
  const renderHealthCards = () => (
    <StatGrid minItemWidth={148} style={{ marginBottom: 12 }}>
      {HEALTH_LABELS.map(([key, label]) => {
        const value = health?.[key] ?? 0;
        const danger = (key === 'outboxFailed' || key === 'webhookFailed24h') && value > 0;
        return <StatCard key={key} title={label} value={value} accent={danger ? 'var(--semi-color-danger)' : undefined} />;
      })}
    </StatGrid>
  );

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

      {renderHealthCards()}

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(data?.total ?? 0)}
        expandedRowRender={renderExpanded}
        expandRowByClick
      />
    </div>
  );
}
