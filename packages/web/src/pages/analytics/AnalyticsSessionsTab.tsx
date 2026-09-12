/** 会话列表：按用户名 / 设备筛选，分页浏览会话并可打开单会话事件时间轴 */
import { useMemo, useState } from 'react';
import { compactParams } from '@/lib/query';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { Empty, SideSheet, Spin, Tag, Timeline, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { EMPTY_PLACEHOLDER, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { analyticsKeys, useAnalyticsSessions, useSessionTimeline } from '@/hooks/queries/analytics';
import { useListSearch } from '@/hooks/useListSearch';
import type { SessionListItem } from '@zenith/shared/analytics';
import { ANALYTICS_DEVICE_TYPE_OPTIONS, USER_BEHAVIOR_EVENT_TYPE_LABELS } from '@zenith/shared/analytics';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { msToReadable, sectionStyle, type DeviceFilter } from './analytics-format';

interface SearchParams {
  username: string;
  deviceType?: DeviceFilter;
}

const defaultSearchParams: SearchParams = { username: '', deviceType: undefined };

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
              <Tag>{data.deviceType || 'unknown'} · {data.browser || EMPTY_PLACEHOLDER} / {data.os || EMPTY_PLACEHOLDER}</Tag>
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
                              ? item.elementLabel || item.eventName || EMPTY_PLACEHOLDER
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
  // 搜索状态：draft 绑输入框，submitted 进 query key；查询 / 重置回到第 1 页并失效会话列表
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: analyticsKeys.sessionsLists, pageSize: 20 });
  const [timelineSessionId, setTimelineSessionId] = useState<string | null>(null);
  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    username: submittedParams.username.trim(),
    deviceType: submittedParams.deviceType,
  }), [submittedParams]);
  const sessionsQuery = useAnalyticsSessions({ page, pageSize, ...filterQuery });

  const columns: ColumnProps<SessionListItem>[] = [
    { title: '用户', dataIndex: 'username', width: 150, render: (_value, record) => record.username || (record.userId == null ? '匿名访客' : `用户 #${record.userId}`) },
    { title: '入口页', dataIndex: 'entryPage', minWidth: 200, render: (_value, record) => renderEllipsis(record.entryPage) },
    { title: '出口页', dataIndex: 'exitPage', width: 200, render: (_value, record) => renderEllipsis(record.exitPage) },
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
          <Typography.Text size="small" type="tertiary"> {record.browser || EMPTY_PLACEHOLDER} / {record.os || EMPTY_PLACEHOLDER}</Typography.Text>
        </div>
      ),
    },
    { title: '地域', dataIndex: 'region', width: 120, render: (_value, record) => record.region || EMPTY_PLACEHOLDER },
    { title: '跳出', dataIndex: 'isBounce', width: 90, render: (_value, record) => <Tag color={record.isBounce ? 'red' : 'green'}>{record.isBounce ? '是' : '否'}</Tag> },
    dateTimeColumn('开始时间', 'startedAt'),
    createOperationColumn<SessionListItem>({
      width: 110,
      actions: (record) => [{ key: 'timeline', label: '时间轴', onClick: () => setTimelineSessionId(record.sessionId) }],
    }),
  ];

  return (
    <div style={sectionStyle}>
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="用户名" {...bindKeyword('username')} width={200} />}
        filters={(
          <FilterSelect
            placeholder="全部设备"
            items={ANALYTICS_DEVICE_TYPE_OPTIONS}
            {...bind('deviceType')}
            width={150}
          />
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="会话筛选"
      />
      <ConfigurableTable<SessionListItem>
        columns={columns}
        {...listTableProps(sessionsQuery, { pagination: buildPagination })}
      />
      <SessionTimelineSheet sessionId={timelineSessionId} onClose={() => setTimelineSessionId(null)} />
    </div>
  );
}
