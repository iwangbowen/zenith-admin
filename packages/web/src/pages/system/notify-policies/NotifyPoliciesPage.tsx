/**
 * 通知策略中心（管理员）。
 *
 * Tab 1 事件策略：事件目录（来自代码常量）+ 当前作用域的渠道覆盖与锁定；
 * Tab 2 投递日志：每次派发的「收件人 × 渠道」决策与归因，回答「为什么他没收到」。
 */
import { useMemo } from 'react';
import { Button, Modal, Spin, Switch, Tabs, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Lock, RotateCcw, Unlock } from 'lucide-react';
import { NOTIFICATION_CHANNEL_LABELS, NOTIFICATION_DECISION_LABELS, NOTIFICATION_DECISION_OPTIONS, NOTIFICATION_REASON_CODE_LABELS, NOTIFICATION_SEVERITY_LABELS, type NotificationChannel, type NotificationDecision, type NotificationDispatch, type NotificationPolicyEvent, type NotificationReasonCode, NOTIFICATION_CHANNEL_OPTIONS } from '@zenith/shared/messaging';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { DateRangeFilter, FilterSelect } from '@/components/search-filters';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { dateTimeColumn, renderEllipsis, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import {
  notificationPolicyKeys,
  useNotificationDispatches,
  useNotificationPolicyEvents,
  useResetNotificationOverride,
  useSaveNotificationOverride,
  useTestFireNotification,
} from '@/hooks/queries/notification-policies';

const { Text } = Typography;

const SEVERITY_TAG_COLOR: Record<string, 'grey' | 'orange' | 'red'> = {
  normal: 'grey',
  important: 'orange',
  critical: 'red',
};

const DECISION_TAG_COLOR: Record<NotificationDecision, 'green' | 'grey' | 'blue' | 'cyan' | 'red'> = {
  sent: 'green',
  suppressed: 'grey',
  deferred: 'blue',
  deduped: 'cyan',
  failed: 'red',
};

// ─── Tab 1：事件策略 ───────────────────────────────────────────────────────────

function ChannelPolicyCell({ event, canSave }: Readonly<{ event: NotificationPolicyEvent; canSave: boolean }>) {
  const saveMutation = useSaveNotificationOverride();
  const resetMutation = useResetNotificationOverride();

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {event.channels.map((cell) => {
        const effective = cell.override?.enabled ?? cell.defaultEnabled;
        const locked = cell.override?.locked ?? false;
        const overridden = cell.override !== null;
        return (
          <span key={cell.channel} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Text type="tertiary" size="small">{NOTIFICATION_CHANNEL_LABELS[cell.channel]}</Text>
            <Switch
              size="small"
              checked={effective}
              disabled={!canSave || saveMutation.isPending}
              onChange={(checked) => {
                saveMutation.mutate(
                  { body: { eventKey: event.key, channel: cell.channel, enabled: checked, locked } },
                  { onSuccess: () => Toast.success('策略已更新') },
                );
              }}
              aria-label={`${event.label} - ${NOTIFICATION_CHANNEL_LABELS[cell.channel]}`}
            />
            {!event.mandatory && (
              <Tooltip content={locked ? '已锁定：用户不可自行修改，点击解锁' : '未锁定：用户可自行开关，点击锁定'}>
                <Button
                  theme="borderless"
                  size="small"
                  disabled={!canSave}
                  icon={locked ? <Lock size={13} /> : <Unlock size={13} style={{ color: 'var(--semi-color-text-3)' }} />}
                  onClick={() => {
                    saveMutation.mutate(
                      { body: { eventKey: event.key, channel: cell.channel, enabled: effective, locked: !locked } },
                      { onSuccess: () => Toast.success(locked ? '已解锁' : '已锁定') },
                    );
                  }}
                  aria-label={locked ? '解锁' : '锁定'}
                />
              </Tooltip>
            )}
            {overridden && (
              <Tooltip content="存在覆盖，点击恢复默认">
                <Button
                  theme="borderless"
                  size="small"
                  disabled={!canSave}
                  icon={<RotateCcw size={13} />}
                  loading={resetMutation.isPending}
                  onClick={() => {
                    resetMutation.mutate(
                      { body: { eventKey: event.key, channel: cell.channel } },
                      { onSuccess: () => Toast.success('已恢复默认') },
                    );
                  }}
                  aria-label="恢复默认"
                />
              </Tooltip>
            )}
          </span>
        );
      })}
    </div>
  );
}

function PolicyEventsTab() {
  const { hasPermission: can } = usePermission();
  const canSave = can('system:notify-policy:save');
  const canTest = can('system:notify-policy:test');
  const eventsQuery = useNotificationPolicyEvents();
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const testMutation = useTestFireNotification();

  // group key → 中文分组名（组头整行渲染用）
  const groupLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of events) {
      if (!map.has(event.group)) map.set(event.group, event.groupLabel);
    }
    return map;
  }, [events]);

  const columns: ColumnProps<NotificationPolicyEvent>[] = [
    {
      title: '事件', dataIndex: 'label', width: 260,
      render: (label: string, record) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Text>{label}</Text>
          {record.mandatory && (
            <Tooltip content="必达通知：用户不可退订"><Lock size={12} style={{ color: 'var(--semi-color-text-2)' }} /></Tooltip>
          )}
        </span>
      ),
    },
    {
      title: '级别', dataIndex: 'severity', width: 80,
      render: (v: NotificationPolicyEvent['severity']) => (
        <Tag size="small" color={SEVERITY_TAG_COLOR[v]}>{NOTIFICATION_SEVERITY_LABELS[v]}</Tag>
      ),
    },
    {
      title: '特性', dataIndex: 'bypassQuietHours', width: 170,
      render: (bypass: boolean, record) => (
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {record.mandatory && <Tag size="small" color="red" type="light">必达</Tag>}
          {bypass && <Tag size="small" color="orange" type="light">穿透免打扰</Tag>}
          {!record.mandatory && !bypass && <Text type="tertiary" size="small">{EMPTY_PLACEHOLDER}</Text>}
        </span>
      ),
    },
    {
      title: '渠道策略（开关 / 锁定 / 恢复默认）', dataIndex: 'channels', minWidth: 420,
      render: (_v, record) => (record ? <ChannelPolicyCell event={record} canSave={canSave} /> : null),
    },
    ...(canTest ? [createOperationColumn<NotificationPolicyEvent>({
      width: 120,
      actions: (record) => [{
        key: 'test',
        label: '测试触发',
        loading: testMutation.isPending && testMutation.variables?.body.eventKey === record.key,
        disabled: testMutation.isPending,
        onClick: () => {
          Modal.confirm({
            title: `测试触发「${record.label}」？`,
            content: '以当前账号为收件人真实派发一次，模板变量填示例值，结果见「投递日志」。',
            onOk: () => {
              testMutation.mutate({ body: { eventKey: record.key } }, {
                onSuccess: () => Toast.success('已触发，请在「投递日志」查看派发结果'),
              });
            },
          });
        },
      }],
    })] : []),
  ];

  if (eventsQuery.isPending) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;
  }
  return (
    <ConfigurableTable
      bordered
      columnSettings={false}
      dataSource={events}
      columns={columns}
      rowKey="key"
      pagination={false}
      size="small"
      empty="暂无事件"
      onRefresh={() => void eventsQuery.refetch()}
      refreshLoading={eventsQuery.isFetching}
      groupBy={(record?: NotificationPolicyEvent) => record?.group ?? ''}
      clickGroupedRowToExpand
      defaultExpandAllGroupRows
      renderGroupSection={(groupKey) => (
        <Text strong>{groupLabels.get(String(groupKey)) ?? String(groupKey)}</Text>
      )}
    />
  );
}

// ─── Tab 2：投递日志 ───────────────────────────────────────────────────────────

interface DispatchSearchParams {
  eventKey: string | undefined;
  channel: NotificationChannel | undefined;
  decision: NotificationDecision | undefined;
  timeRange: [Date, Date] | null;
}

const defaultDispatchParams: DispatchSearchParams = {
  eventKey: undefined,
  channel: undefined,
  decision: undefined,
  timeRange: null,
};

const CHANNEL_OPTIONS = NOTIFICATION_CHANNEL_OPTIONS;

function DispatchLogTab() {
  const eventsQuery = useNotificationPolicyEvents();
  const eventOptions = useMemo(
    () => (eventsQuery.data ?? []).map((event) => ({ value: event.key, label: `${event.groupLabel} · ${event.label}` })),
    [eventsQuery.data],
  );

  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<DispatchSearchParams>({ defaults: defaultDispatchParams, listKey: notificationPolicyKeys.dispatches });

  const { startTime, endTime } = formatDateTimeRangeForApi(submittedParams.timeRange);
  const listQuery = useNotificationDispatches({
    page,
    pageSize,
    eventKey: submittedParams.eventKey,
    channel: submittedParams.channel,
    decision: submittedParams.decision,
    startTime,
    endTime,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const columns: ColumnProps<NotificationDispatch>[] = [
    dateTimeColumn('派发时间', 'createdAt'),
    { title: '事件', dataIndex: 'eventLabel', width: 180, render: renderEllipsis },
    {
      title: '收件人', dataIndex: 'recipientName', width: 160,
      render: (_v, record) => record?.recipientName
        ?? record?.recipientAddress
        ?? (record && record.recipientId !== null ? `#${record.recipientId}` : EMPTY_PLACEHOLDER),
    },
    {
      title: '渠道', dataIndex: 'channel', width: 90,
      render: (v: NotificationChannel) => NOTIFICATION_CHANNEL_LABELS[v],
    },
    {
      title: '归因', dataIndex: 'reasonCode', width: 220,
      render: (v: string | null) => (v ? (NOTIFICATION_REASON_CODE_LABELS[v as NotificationReasonCode] ?? v) : EMPTY_PLACEHOLDER),
    },
    { title: '详情', dataIndex: 'reasonDetail', render: renderEllipsis },
    {
      title: '结论', dataIndex: 'decision', width: 110, fixed: 'right' as const,
      render: (v: NotificationDecision) => <Tag color={DECISION_TAG_COLOR[v]} type="light">{NOTIFICATION_DECISION_LABELS[v]}</Tag>,
    },
  ];

  return (
    <>
      <SearchToolbar
        primary={(
          <>
            <FilterSelect
              placeholder="全部事件"
              items={eventOptions}
              value={draftParams.eventKey}
              onChange={(v) => setDraftParams({ ...draftParams, eventKey: v as string | undefined })}
              width={240}
              filter
            />
            <FilterSelect
              placeholder="全部渠道"
              items={CHANNEL_OPTIONS}
              value={draftParams.channel}
              onChange={(v) => setDraftParams({ ...draftParams, channel: v as NotificationChannel | undefined })}
            />
            <FilterSelect
              placeholder="全部结论"
              items={NOTIFICATION_DECISION_OPTIONS}
              value={draftParams.decision}
              onChange={(v) => setDraftParams({ ...draftParams, decision: v as NotificationDecision | undefined })}
            />
            <DateRangeFilter value={draftParams.timeRange} onChange={(v) => setDraftParams({ ...draftParams, timeRange: v })} />
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
          </>
        )}
      />
      <ConfigurableTable<NotificationDispatch>
        bordered
        dataSource={list}
        columns={columns}
        rowKey="id"
        loading={listQuery.isPending}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />
    </>
  );
}

export default function NotifyPoliciesPage() {
  const [activeTab, setActiveTab] = useUrlTabState(['events', 'dispatches'] as const, 'events');

  return (
    <div className="page-container">
      <Tabs activeKey={activeTab} onChange={(v) => setActiveTab(v as 'events' | 'dispatches')}>
        <Tabs.TabPane itemKey="events" tab="事件策略">
          <PolicyEventsTab />
        </Tabs.TabPane>
        <Tabs.TabPane itemKey="dispatches" tab="投递日志">
          <DispatchLogTab />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
}
