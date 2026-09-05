/** 会话列表：按用户名 / 设备筛选，分页浏览会话并可打开单会话事件时间轴 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Empty, Input, SideSheet, Spin, Tag, Timeline, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { dateTimeColumn } from '@/utils/table-columns';
import { analyticsKeys, useAnalyticsSessions, useSessionTimeline } from '@/hooks/queries/analytics';
import type { SessionListItem } from '@zenith/shared/analytics';
import { ANALYTICS_DEVICE_TYPE_OPTIONS, USER_BEHAVIOR_EVENT_TYPE_LABELS } from '@zenith/shared/analytics';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect } from '@/components/search-filters';
import { msToReadable, sectionStyle, type DeviceFilter } from './analytics-format';

// 标签取 shared SSOT；颜色是时间轴 UI 表现，留在页面侧
const TIMELINE_EVENT_META: Record<string, { label: string; color: 'blue' | 'green' | 'orange' | 'grey' | 'red' | 'purple' }> = {
  page_view: { label: USER_BEHAVIOR_EVENT_TYPE_LABELS.page_view, color: 'blue' },
  page_leave: { label: USER_BEHAVIOR_EVENT_TYPE_LABELS.page_leave, color: 'grey' },
  feature_use: { label: USER_BEHAVIOR_EVENT_TYPE_LABELS.feature_use, color: 'green' },
  area_click: { label: USER_BEHAVIOR_EVENT_TYPE_LABELS.area_click, color: 'green' },
  api_request: { label: USER_BEHAVIOR_EVENT_TYPE_LABELS.api_request, color: 'orange' },
  perf: { label: USER_BEHAVIOR_EVENT_TYPE_LABELS.perf, color: 'purple' },
  custom: { label: USER_BEHAVIOR_EVENT_TYPE_LABELS.custom, color: 'purple' },
  identify: { label: USER_BEHAVIOR_EVENT_TYPE_LABELS.identify, color: 'grey' },
};

function SessionTimelineSheet({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const timelineQuery = useSessionTimeline(sessionId, sessionId != null);
  const data = timelineQuery.data ?? null;

  return (
    <SideSheet
      title="会话时间轴"
      visible={sessionId != null}
      onCancel={onClose}
      width={560}
    >
      <Spin spinning={timelineQuery.isFetching}>
        {!data ? <Empty description="暂无数据" /> : (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag color="blue">{data.username || (data.userId == null ? '匿名访客' : `用户 #${data.userId}`)}</Tag>
              <Tag>{data.deviceType || 'unknown'} · {data.browser || '–'} / {data.os || '–'}</Tag>
              {data.startedAt && <Tag color="grey">开始 {data.startedAt}</Tag>}
              {data.durationMs != null && <Tag color="grey">时长 {msToReadable(data.durationMs)}</Tag>}
            </div>
            {data.items.length === 0 ? <Empty description="该会话暂无事件明细" /> : (
              <Timeline mode="left">
                {data.items.map((item) => {
                  const meta = TIMELINE_EVENT_META[item.eventType] ?? { label: item.eventType, color: 'grey' as const };
                  return (
                    <Timeline.Item
                      key={item.id}
                      time={item.createdAt.slice(11)}
                      type={item.eventType === 'api_request' ? 'warning' : item.eventType === 'page_view' ? 'ongoing' : 'default'}
                    >
                      <div style={{ display: 'grid', gap: 2 }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Tag size="small" color={meta.color}>{meta.label}</Tag>
                          <Typography.Text strong ellipsis={{ showTooltip: true }} style={{ maxWidth: 320 }}>
                            {item.eventType === 'feature_use' || item.eventType === 'area_click'
                              ? item.elementLabel || item.eventName || '–'
                              : item.pageTitle || item.pagePath}
                          </Typography.Text>
                        </div>
                        <Typography.Text size="small" type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 420 }}>
                          {item.pagePath}
                          {item.componentArea ? ` · ${item.componentArea}` : ''}
                          {item.durationMs != null ? ` · ${msToReadable(item.durationMs)}` : ''}
                        </Typography.Text>
                      </div>
                    </Timeline.Item>
                  );
                })}
              </Timeline>
            )}
          </div>
        )}
      </Spin>
    </SideSheet>
  );
}

export default function AnalyticsSessionsTab() {
  const queryClient = useQueryClient();
  const [usernameInput, setUsernameInput] = useState('');
  const [deviceInput, setDeviceInput] = useState<DeviceFilter | undefined>();
  const [filters, setFilters] = useState<{ username: string; deviceType?: DeviceFilter }>({ username: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [timelineSessionId, setTimelineSessionId] = useState<string | null>(null);
  const sessionsQuery = useAnalyticsSessions({
    page,
    pageSize,
    username: filters.username || undefined,
    deviceType: filters.deviceType,
  });
  const data = sessionsQuery.data ?? { list: [], total: 0, page: 1, pageSize: 20 };

  const handleSearch = () => {
    setPage(1);
    setFilters({ username: usernameInput.trim(), deviceType: deviceInput });
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.sessionsLists });
  };

  const handleReset = () => {
    setUsernameInput('');
    setDeviceInput(undefined);
    setPage(1);
    setFilters({ username: '' });
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.sessionsLists });
  };

  const columns: ColumnProps<SessionListItem>[] = [
    { title: '用户', dataIndex: 'username', width: 150, render: (_value, record) => record.username || (record.userId == null ? '匿名访客' : `用户 #${record.userId}`) },
    { title: '入口页', dataIndex: 'entryPage', minWidth: 200, render: (_value, record) => <Typography.Text ellipsis={{ showTooltip: true }}>{record.entryPage || '–'}</Typography.Text> },
    { title: '出口页', dataIndex: 'exitPage', width: 200, render: (_value, record) => <Typography.Text ellipsis={{ showTooltip: true }}>{record.exitPage || '–'}</Typography.Text> },
    { title: '页数', dataIndex: 'pageCount', width: 90, align: 'right' },
    { title: '事件', dataIndex: 'eventCount', width: 90, align: 'right' },
    { title: '时长', dataIndex: 'durationMs', width: 120, align: 'right', render: (_value, record) => msToReadable(record.durationMs) },
    {
      title: '设备 / 浏览器 / 系统',
      dataIndex: 'deviceType',
      width: 230,
      render: (_value, record) => (
        <div>
          <Tag color="blue">{record.deviceType || 'unknown'}</Tag>
          <Typography.Text size="small" type="tertiary"> {record.browser || '–'} / {record.os || '–'}</Typography.Text>
        </div>
      ),
    },
    { title: '地域', dataIndex: 'region', width: 120, render: (_value, record) => record.region || '–' },
    { title: '跳出', dataIndex: 'isBounce', width: 90, render: (_value, record) => <Tag color={record.isBounce ? 'red' : 'green'}>{record.isBounce ? '是' : '否'}</Tag> },
    dateTimeColumn('开始时间', 'startedAt'),
    createOperationColumn<SessionListItem>({
      width: 110,
      actions: (record) => [{ key: 'timeline', label: '时间轴', onClick: () => setTimelineSessionId(record.sessionId) }],
    }),
  ];

  const renderUsernameSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="用户名"
      value={usernameInput}
      showClear
      onChange={setUsernameInput}
      onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
      style={{ width: 200 }}
    />
  );
  const renderDeviceFilter = () => (
    <FilterSelect
      placeholder="全部设备"
      items={ANALYTICS_DEVICE_TYPE_OPTIONS}
      value={deviceInput}
      onChange={setDeviceInput}
      width={150}
    />
  );
  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;

  return (
    <div style={sectionStyle}>
      <SearchToolbar
        primary={(
          <>
            {renderUsernameSearch()}
            {renderDeviceFilter()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderUsernameSearch()}
            {renderSearchButton()}
          </>
        )}
        mobileFilters={renderDeviceFilter()}
        filterTitle="会话筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      <ConfigurableTable<SessionListItem>
        bordered
        columns={columns}
        dataSource={data.list}
        loading={sessionsQuery.isFetching}
        rowKey="id"
        onRefresh={() => void sessionsQuery.refetch()}
        refreshLoading={sessionsQuery.isFetching}
        pagination={{
          currentPage: page,
          pageSize,
          total: data.total,
          showSizeChanger: true,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
      />
      <SessionTimelineSheet sessionId={timelineSessionId} onClose={() => setTimelineSessionId(null)} />
    </div>
  );
}
