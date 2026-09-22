import { Button, Empty, Space, Spin, Timeline, Tooltip, Typography } from '@douyinfe/semi-ui';
import { RefreshCw } from 'lucide-react';
import { canonicalEntityRefSchema, entityTimelineContract, ENTITY_TIMELINE_EVENT_OPTIONS, type CanonicalEntityType } from '@zenith/shared/platform';
import { useEntityTimeline, type EntityTimelineFilters } from '@/hooks/queries/entity-timeline';
import { entityTypeLabel, timelineEventDescription, timelineEventLabel } from '@/utils/entity-relations';
import DateTimeText from '@/components/DateTimeText';
import EntityRefBadge from './EntityRefBadge';
import { useListSearch } from '@/hooks/useListSearch';
import { contractKey } from '@/lib/contract-query';
import { DateRangeFilter, FilterSelect } from '@/components/search-filters';
import { ListSearchToolbar } from '@/components/list-page/ListSearchToolbar';
import { formatDateRangeForApi } from '@/utils/date';

type TimelineSearch = { eventType: EntityTimelineFilters['eventType']; range: [Date, Date] | null };

export default function EntityTimeline({ entityType, entityKey, enabled = true }: {
  readonly entityType: CanonicalEntityType; readonly entityKey: string | undefined; readonly enabled?: boolean;
}) {
  const search = useListSearch<TimelineSearch>({
    defaults: { eventType: undefined, range: null },
    listKey: contractKey(entityTimelineContract.timeline, { params: { type: entityType, key: entityKey ?? '' }, query: {} }),
    resetKey: `${entityType}:${entityKey ?? ''}`,
  });
  const query = useEntityTimeline(entityType, entityKey, enabled, 20, {
    eventType: search.submittedParams.eventType,
    ...formatDateRangeForApi(search.submittedParams.range),
  });
  if (!enabled || !entityKey) return null;
  const events = query.data?.pages.flatMap((page) => page.items) ?? [];
  return <div style={{ paddingTop: 12 }}>
    <ListSearchToolbar
      filters={<>
        <FilterSelect items={ENTITY_TIMELINE_EVENT_OPTIONS} placeholder="全部事件类型" width={180} {...search.bind('eventType')} />
        <DateRangeFilter type="dateRange" {...search.bind('range')} />
      </>}
      onSearch={search.handleSearch}
      onReset={search.handleReset}
      actions={<Tooltip content="刷新业务时间线">
        <Button
          size="small"
          theme="borderless"
          icon={<RefreshCw size={14} />}
          loading={query.isRefetching}
          aria-label="刷新业务时间线"
          onClick={() => void query.refetch()}
        />
      </Tooltip>}
    />
    {query.isLoading && <Spin />}
    {query.isError && <Space><Typography.Text type="danger">时间线加载失败</Typography.Text><Button size="small" onClick={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}>重试</Button></Space>}
    {!query.isLoading && !query.isError && events.length === 0 && <Empty description="暂无可见业务事件" />}
    <Timeline>{events.map((event) => {
      const source = canonicalEntityRefSchema.safeParse(event.sourceRef);
      return <Timeline.Item key={event.id} time={<DateTimeText value={event.occurredAt} />}>
        <Typography.Text strong>{typeof event.payload.title === 'string' ? event.payload.title : timelineEventLabel(event.eventType)}</Typography.Text>
        {timelineEventDescription(event) && <div><Typography.Text type="tertiary">{timelineEventDescription(event)}</Typography.Text></div>}
        {event.eventType === 'messaging.notification.dispatched' && typeof event.payload.failed === 'number' && event.payload.failed > 0 && <div><Typography.Text type="warning">部分渠道投递失败</Typography.Text></div>}
        {event.eventType === 'messaging.notification.dispatched' && typeof event.payload.deferred === 'number' && event.payload.deferred > 0 && <div><Typography.Text type="tertiary">部分通知按偏好延后发送</Typography.Text></div>}
        {typeof event.payload.actorName === 'string' && <div><Typography.Text size="small" type="tertiary">操作人：{event.payload.actorName}</Typography.Text></div>}
        {source.success && <div><EntityRefBadge entityRef={source.data} capabilities={{ view: true, open: true }}>查看{entityTypeLabel(source.data.type)}</EntityRefBadge></div>}
      </Timeline.Item>;
    })}</Timeline>
    {query.hasNextPage && <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>加载更多事件</Button>}
  </div>;
}
