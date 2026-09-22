import { Button, Empty, Space, Spin, Timeline, Tooltip, Typography } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import type { CanonicalEntityType } from '@zenith/shared/platform';
import { useEntityTimeline } from '@/hooks/queries/entity-relations';
import { timelineEventDescription, timelineEventLabel } from '@/utils/entity-relations';
import DateTimeText from '@/components/DateTimeText';

export default function EntityTimeline({ entityType, entityKey, enabled = true }: {
  readonly entityType: CanonicalEntityType; readonly entityKey: string | undefined; readonly enabled?: boolean;
}) {
  const query = useEntityTimeline(entityType, entityKey, enabled);
  if (!enabled || !entityKey) return null;
  const events = query.data?.pages.flatMap((page) => page.items) ?? [];
  return <div style={{ paddingTop: 12 }}>
    <Space wrap spacing={8} style={{ marginBottom: 12 }}>
      <Typography.Text type="tertiary">按业务事件发生时间展示</Typography.Text>
      {/* 与「关联记录」页签的刷新同形：图标按钮 + tooltip，不占标题行宽度 */}
      <Tooltip content="刷新业务时间线">
        <Button
          size="small"
          theme="borderless"
          icon={<RefreshCw size={14} />}
          loading={query.isRefetching}
          aria-label="刷新业务时间线"
          onClick={() => void query.refetch()}
        />
      </Tooltip>
    </Space>
    {query.isLoading && <Spin />}
    {query.isError && <Space><Typography.Text type="danger">时间线加载失败</Typography.Text><Button size="small" onClick={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}>重试</Button></Space>}
    {!query.isLoading && !query.isError && events.length === 0 && <Empty description="暂无可见业务事件" />}
    <Timeline>{events.map((event) => <Timeline.Item key={event.id} time={<DateTimeText value={event.occurredAt} />}>
      <Typography.Text strong>{typeof event.payload.title === 'string' ? event.payload.title : timelineEventLabel(event.eventType)}</Typography.Text>
      {timelineEventDescription(event) && <div><Typography.Text type="tertiary">{timelineEventDescription(event)}</Typography.Text></div>}
      {typeof event.payload.actorName === 'string' && <div><Typography.Text size="small" type="tertiary">操作人：{event.payload.actorName}</Typography.Text></div>}
    </Timeline.Item>)}</Timeline>
    {query.hasNextPage && <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>加载更多事件</Button>}
  </div>;
}
