import { PAYMENT_CHANNEL_TAG_COLOR } from '@/utils/payment';
import { useMemo } from 'react';
import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { enumValueOf } from '@zenith/shared/core';
import { PAYMENT_CHANNELS, PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNEL_OPTIONS } from '@zenith/shared/payment';
import type { PaymentChannel, PaymentNotifyLog } from '@zenith/shared/payment';
import { paymentLogKeys, usePaymentLogList } from '@/hooks/queries/payment-logs';
import { useListSearch } from '@/hooks/useListSearch';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
import { compactParams } from '@/lib/query';
import { copyableNoColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { JsonBlock } from '@/components/JsonBlock';

const NOTIFY_SCENES = ['payment', 'refund'] as const;

interface SearchParams { keyword: string; channel?: string; scene?: string; signatureValid?: string; timeRange: [Date, Date] | null; }
const defaultSearch: SearchParams = { keyword: '', channel: undefined, scene: undefined, signatureValid: undefined, timeRange: null };

function formatRaw(raw: string | null | undefined): string {
  if (!raw) return '';
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}

export default function PaymentLogsPage() {  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: paymentLogKeys.lists });

  // 已提交筛选 → 契约查询参数：只映射一次；枚举筛选从 string 收窄，
  // 验签结果在草稿以 'true' / 'false' 字串保存（Select 选项值），提交时收窄为布尔（compactParams 保留 false）
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    channel: enumValueOf(PAYMENT_CHANNELS, submittedParams.channel),
    scene: enumValueOf(NOTIFY_SCENES, submittedParams.scene),
    signatureValid: submittedParams.signatureValid === undefined ? undefined : submittedParams.signatureValid === 'true',
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  }), [submittedParams]);

  const listQuery = usePaymentLogList({ page, pageSize, ...filterQuery });

  const columns: ColumnProps<PaymentNotifyLog>[] = [
    // 订单号置于首列承载展开箭头；内部日志 ID 移入展开详情
    copyableNoColumn('订单号', 'orderNo', { width: 300 }),
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={PAYMENT_CHANNEL_TAG_COLOR[v]}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '场景', dataIndex: 'scene', width: 100, render: (v: string) => (v === 'refund' ? '退款回调' : '支付回调') },
    { title: '验签', dataIndex: 'signatureValid', width: 90, render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? '通过' : '失败'}</Tag> },
    { title: '结果', dataIndex: 'result', width: 150, render: renderEllipsis },
    { title: '说明', dataIndex: 'message', width: 220, render: renderEllipsis },
    { title: 'IP', dataIndex: 'ip', width: 150, render: renderEllipsis },
    dateTimeColumn('时间', 'createdAt'),
  ];

  /** 行内展开：请求头与原始 Body（无内容的行不可展开） */
  const renderExpanded = (r?: PaymentNotifyLog) => (r ? (
    // flex: 1 + minWidth: 0：Semi 展开行容器是 flex row，不声明会被收缩成内容最小宽
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0', flex: 1, minWidth: 0 }}>
      <Typography.Text type="tertiary" size="small">日志 ID：{r.id}</Typography.Text>
      {r.headers && (
        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>请求头</Typography.Text>
          <JsonBlock value={formatRaw(r.headers)} />
        </div>
      )}
      <div>
        <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>原始 Body</Typography.Text>
        <JsonBlock value={formatRaw(r.rawBody) || '（无）'} />
      </div>
    </div>
  ) : null);

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="订单号..." {...bindKeyword('keyword')} width={200} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部渠道"
              items={PAYMENT_CHANNEL_OPTIONS}
              {...bind('channel')}
            />
            <FilterSelect
              placeholder="全部场景"
              items={[{ value: 'payment', label: '支付回调' }, { value: 'refund', label: '退款回调' }]}
              {...bind('scene')}
            />
            <FilterSelect
              placeholder="全部验签结果"
              items={[{ value: 'true', label: '验签通过' }, { value: 'false', label: '验签失败' }]}
              {...bind('signatureValid')}
              width={140}
            />
            <DateRangeFilter {...bind('timeRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="支付回调日志筛选"
      />

      <ConfigurableTable
        columns={columns}
        empty="暂无数据"
        {...listTableProps(listQuery, { pagination: buildPagination })}
        expandedRowRender={renderExpanded}
        rowExpandable={(r) => !!(r && (r.rawBody || r.headers))}
        expandRowByClick
      />
    </div>
  );
}
