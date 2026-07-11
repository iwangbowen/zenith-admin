/**
 * 行为中心阶段 1：事件调试流 —— 当前租户最近事件摘要，3s 轮询近实时刷新。
 */
import { useState } from 'react';
import { Button, Input, SideSheet, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag';
import { RotateCcw, Search } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateTime } from '@/utils/date';
import { useAnalyticsDebugEvents } from '@/hooks/queries/analytics';
import type { AnalyticsDebugEvent, AnalyticsQualityIssueType } from '@zenith/shared';
import { ANALYTICS_QUALITY_ISSUE_TYPE_LABELS } from '@zenith/shared';

const DEBUG_LIMIT = 50;

const ISSUE_COLOR: Record<AnalyticsQualityIssueType, TagColor> = {
  missing_required: 'orange',
  type_mismatch: 'amber',
  invalid_enum: 'red',
  event_disabled: 'grey',
  origin_rejected: 'red',
  quota_exceeded: 'orange',
};

function nullableText(value: string | number | null | undefined) {
  return value == null || value === '' ? '–' : String(value);
}

export default function AnalyticsDebugTab({ active }: Readonly<{ active: boolean }>) {
  const [eventNameDraft, setEventNameDraft] = useState('');
  const [eventName, setEventName] = useState('');
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<AnalyticsDebugEvent | null>(null);

  const debugQuery = useAnalyticsDebugEvents({ limit: DEBUG_LIMIT, eventName: eventName || undefined }, active);
  const events = debugQuery.data ?? [];

  const handleSearch = () => setEventName(eventNameDraft);
  const handleReset = () => { setEventNameDraft(''); setEventName(''); };

  const openDetail = (record: AnalyticsDebugEvent) => { setDetailRecord(record); setDetailVisible(true); };

  const columns: ColumnProps<AnalyticsDebugEvent>[] = [
    { title: '时间', dataIndex: 'createdAt', width: 170, render: (value: string) => formatDateTime(value) },
    { title: '事件名', dataIndex: 'eventName', width: 160, render: (value: string | null) => nullableText(value) },
    { title: '类型', dataIndex: 'eventType', width: 100 },
    { title: '来源', dataIndex: 'source', width: 110 },
    { title: '应用', dataIndex: 'appId', width: 90 },
    { title: '环境', dataIndex: 'environment', width: 90 },
    { title: 'Distinct ID', dataIndex: 'distinctId', width: 150, render: (value: string | null) => nullableText(value) },
    { title: '会员 ID', dataIndex: 'memberId', width: 90, render: (value: number | null) => nullableText(value) },
    {
      title: '页面',
      dataIndex: 'pagePath',
      width: 200,
      render: (value: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 180 }}>{value}</Typography.Text>,
    },
    {
      title: '质量问题',
      dataIndex: 'issueTypes',
      width: 200,
      render: (value: AnalyticsQualityIssueType[]) => (
        value.length
          ? <>{value.map((t) => <Tag key={t} color={ISSUE_COLOR[t]} size="small" style={{ marginRight: 4 }}>{ANALYTICS_QUALITY_ISSUE_TYPE_LABELS[t]}</Tag>)}</>
          : <Typography.Text type="tertiary" size="small">–</Typography.Text>
      ),
    },
    createOperationColumn<AnalyticsDebugEvent>({
      width: 90,
      desktopInlineKeys: ['detail'],
      actions: (record) => [{ key: 'detail', label: '详情', onClick: () => openDetail(record) }],
    }),
  ];

  return (
    <div>
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="事件名"
          value={eventNameDraft}
          onChange={setEventNameDraft}
          onEnterPress={handleSearch}
          showClear
          style={{ width: 180 }}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        <Typography.Text type="tertiary" size="small">每 3 秒自动刷新，最多展示 {DEBUG_LIMIT} 条</Typography.Text>
      </SearchToolbar>
      <ConfigurableTable
        bordered
        rowKey="id"
        loading={debugQuery.isFetching && events.length === 0}
        columns={columns}
        dataSource={events}
        onRefresh={() => void debugQuery.refetch()}
        refreshLoading={debugQuery.isFetching}
        scroll={{ x: 1200 }}
        pagination={false}
        empty="暂无最近事件"
      />

      <SideSheet
        title="事件详情"
        visible={detailVisible}
        onCancel={() => setDetailVisible(false)}
        width={480}
      >
        {detailRecord && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div><Typography.Text strong>事件 ID：</Typography.Text>{nullableText(detailRecord.eventId)}</div>
            <div><Typography.Text strong>事件名：</Typography.Text>{nullableText(detailRecord.eventName)}</div>
            <div><Typography.Text strong>类型：</Typography.Text>{detailRecord.eventType}</div>
            <div><Typography.Text strong>来源：</Typography.Text>{detailRecord.source} / {detailRecord.appId} / {detailRecord.environment}</div>
            <div><Typography.Text strong>Distinct ID：</Typography.Text>{nullableText(detailRecord.distinctId)}</div>
            <div><Typography.Text strong>用户 / 会员：</Typography.Text>{nullableText(detailRecord.userId)} / {nullableText(detailRecord.memberId)}</div>
            <div><Typography.Text strong>页面：</Typography.Text>{detailRecord.pagePath}</div>
            <div><Typography.Text strong>时间：</Typography.Text>{formatDateTime(detailRecord.createdAt)}</div>
            <div>
              <Typography.Text strong>质量问题：</Typography.Text>
              {detailRecord.issueTypes.length
                ? detailRecord.issueTypes.map((t) => <Tag key={t} color={ISSUE_COLOR[t]} size="small" style={{ marginRight: 4 }}>{ANALYTICS_QUALITY_ISSUE_TYPE_LABELS[t]}</Tag>)
                : '–'}
            </div>
            <div>
              <Typography.Text strong>属性：</Typography.Text>
              <pre style={{ margin: '8px 0 0', padding: 12, borderRadius: 'var(--semi-border-radius-medium)', background: 'var(--semi-color-fill-0)', overflow: 'auto' }}>
                {JSON.stringify(detailRecord.properties ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
