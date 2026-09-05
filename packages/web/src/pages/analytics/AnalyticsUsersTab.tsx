/** 用户分析：按操作量排名的用户列表，点击行打开行为时间线 */
import { useEffect, useMemo, useState } from 'react';
import { Avatar, Empty, Select, SideSheet, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { DataBar } from '@/components/data-viz/DataBar';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { formatDateTime } from '@/utils/date';
import { dateTimeColumn } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { useAnalyticsUserStats, useAnalyticsUserTimeline } from '@/hooks/queries/analytics';
import type { AnalyticsUserStats } from '@zenith/shared/analytics';
import { useBehaviorDays } from './behavior-days-context';
import { DAYS_OPTIONS, msToReadable, numberText, sectionStyle } from './analytics-format';
import { SectionHeader } from './analytics-shared';

type UserStatsRow = AnalyticsUserStats['list'][number] & { id: string; rank: number };

export default function AnalyticsUsersTab() {
  const [days, setDays] = useBehaviorDays();
  const [timelineVisible, setTimelineVisible] = useState(false);
  const [timelineUserId, setTimelineUserId] = useState<number | null>(null);
  const { page, pageSize, resetPage, buildPagination } = usePagination();
  const userStatsQuery = useAnalyticsUserStats(days, page, pageSize);
  const timelineQuery = useAnalyticsUserTimeline(timelineUserId, timelineVisible);
  const data = userStatsQuery.data ?? null;
  const loading = userStatsQuery.isFetching;
  const timeline = timelineQuery.data ?? null;
  const timelineLoading = timelineQuery.isFetching;

  useEffect(() => { resetPage(); }, [days, resetPage]);

  const rows = useMemo<UserStatsRow[]>(() => (data?.list ?? []).map((item, index) => ({
    ...item,
    id: item.userId == null ? `anonymous-${index}` : String(item.userId),
    rank: (page - 1) * pageSize + index + 1,
  })), [data, page, pageSize]);
  const maxEvents = Math.max(1, ...rows.map((item) => item.totalEvents));

  const openTimeline = (record: UserStatsRow) => {
    if (record.userId == null) return;
    setTimelineUserId(record.userId);
    setTimelineVisible(true);
  };

  const columns: ColumnProps<UserStatsRow>[] = [
    {
      title: '用户',
      dataIndex: 'username',
      width: 210,
      render: (_value, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar size="small" color={record.userId == null ? 'grey' : 'blue'}>{(record.username || '访').slice(0, 1).toUpperCase()}</Avatar>
          <div>
            <Typography.Text strong>{record.username || (record.userId == null ? '匿名访客' : `用户 #${record.userId}`)}</Typography.Text>
            <div><Typography.Text type="tertiary" size="small">#{record.rank}</Typography.Text></div>
          </div>
        </div>
      ),
    },
    {
      title: '总操作',
      align: 'right',
      dataIndex: 'totalEvents',
      width: 220,
      render: (_value, record) => (
        <div>
          <Typography.Text strong>{numberText(record.totalEvents)}</Typography.Text>
          <DataBar value={record.totalEvents} max={maxEvents} style={{ marginTop: 6 }} />
        </div>
      ),
    },
    { title: '页面访问', dataIndex: 'pageViews', width: 110 },
    { title: '访问页面数', dataIndex: 'uniquePages', width: 120 },
    { title: '功能使用', dataIndex: 'featureUses', width: 110 },
    { title: '总停留', dataIndex: 'totalDwellMs', width: 130, align: 'right', render: (_value, record) => msToReadable(record.totalDwellMs) },
    dateTimeColumn('最近活跃', 'lastActiveAt', { fixed: 'right' }),
  ];

  return (
    <div style={sectionStyle}>
      <SectionHeader
        title="用户分析"
        description={`覆盖用户 ${numberText(data?.total ?? 0)}`}
        extra={<Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />}
      />
      <ConfigurableTable<UserStatsRow>
        bordered
        columns={columns}
        dataSource={rows}
        loading={loading}
        rowKey="id"
        onRefresh={() => void userStatsQuery.refetch()}
        refreshLoading={loading}
        pagination={buildPagination(data?.total ?? 0)}
        onRow={(record) => ({
          onClick: () => { if (record) openTimeline(record); },
          style: { cursor: record?.userId == null ? 'default' : 'pointer' },
        })}
      />
      <SideSheet
        title="用户行为时间线"
        visible={timelineVisible}
        width={560}
        onCancel={() => setTimelineVisible(false)}
      >
        <Spin spinning={timelineLoading}>
          {!timeline ? <Empty description="暂无时间线" /> : (
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <Typography.Title heading={5} style={{ margin: 0 }}>{timeline.username || `用户 #${timeline.userId}`}</Typography.Title>
                <Typography.Text type="tertiary">
                  共 {numberText(timeline.totalEvents)} 次行为 · {timeline.firstSeenAt ? formatDateTime(timeline.firstSeenAt) : '–'} 至 {timeline.lastSeenAt ? formatDateTime(timeline.lastSeenAt) : '–'}
                </Typography.Text>
              </div>
              {timeline.items.map((item) => (
                <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: 12, position: 'relative' }}>
                  <Typography.Text type="tertiary" size="small">{formatDateTime(item.createdAt)}</Typography.Text>
                  <div>
                    <Tag color="blue">{item.eventType}</Tag>
                    <Typography.Text strong style={{ marginLeft: 8 }}>{item.eventName || item.elementLabel || item.pageTitle || item.pagePath}</Typography.Text>
                    <div><Typography.Text type="tertiary" size="small">{item.componentArea || '页面'} · {item.pagePath} · {msToReadable(item.durationMs)}</Typography.Text></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Spin>
      </SideSheet>
    </div>
  );
}
