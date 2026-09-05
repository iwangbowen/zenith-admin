import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Form, Tag, Toast, Tooltip } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import AppModal from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { dateTimeColumn, renderEllipsis, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import type { MonitorAlertEvent, MonitorAlertHandleStatus } from '@zenith/shared/platform';
import { enumValueOf } from '@zenith/shared/core';
import {
  MONITOR_ALERT_EVENT_STATUSES,
  MONITOR_ALERT_EVENT_STATUS_OPTIONS,
  MONITOR_ALERT_HANDLE_STATUSES,
  MONITOR_ALERT_HANDLE_STATUS_OPTIONS,
  MONITOR_ALERT_LEVELS,
  MONITOR_ALERT_LEVEL_OPTIONS,
  MONITOR_ALERT_NOTIFY_STATUSES,
  MONITOR_ALERT_NOTIFY_STATUS_OPTIONS,
  MONITOR_METRICS,
} from '@zenith/shared/platform';
import { NOTIFY_CHANNEL_LABELS } from '@zenith/shared/messaging';
import {
  monitorAlertKeys,
  useBatchHandleMonitorAlertEvents,
  useHandleMonitorAlertEvent,
  useMonitorAlertEventList,
} from '@/hooks/queries/monitor-alerts';
import {
  MONITOR_ALERT_HANDLE_STATUS_CONFIG as HANDLE_CONFIG,
  MONITOR_ALERT_LEVEL_CONFIG as LEVEL_CONFIG,
  MONITOR_ALERT_NOTIFY_STATUS_CONFIG as NOTIFY_CONFIG,
  MONITOR_METRIC_GROUPED_OPTIONS as METRIC_GROUPS,
  MONITOR_METRIC_LABELS as METRIC_LABELS,
  formatMonitorMetricValue,
} from '../rules/constants';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';

const OP_SYMBOL: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };
const CHANNEL_LABELS: Record<string, string> = NOTIFY_CHANNEL_LABELS;

/** 日志级别计数指标 → 日志文件页深链的级别过滤 */
const LOG_METRIC_LEVEL: Record<string, 'error' | 'warn'> = {
  logErrorPerMin: 'error',
  logWarnPerMin: 'warn',
};

interface SearchParams {
  keyword: string;
  metric?: string;
  level?: string;
  status?: string;
  notifyStatus?: string;
  handleStatus?: string;
  timeRange: [Date, Date] | null;
}

const defaultSearchParams: SearchParams = {
  keyword: '', metric: undefined, level: undefined, status: undefined, notifyStatus: undefined, handleStatus: undefined, timeRange: null,
};

/** 处理动作的文案随目标状态变化，避免「确定」按钮下用户不知道自己在做什么；
 *  措辞与行内按钮保持一致，否则点「标记已处理」弹出「关闭告警」会让人以为点错了。
 *  `done` 单列一份而非由 okText 拼「已 + xxx」，否则会得出「已标记已处理」这种叠词 */
const HANDLE_ACTION_META: Record<
  MonitorAlertHandleStatus,
  { title: string; okText: string; done: string; hint: string }
> = {
  acknowledged: {
    title: '认领告警', okText: '认领', done: '已认领',
    hint: '认领后该告警计入你的处理中列表，其他人能看到已有人跟进。',
  },
  closed: {
    title: '标记已处理', okText: '标记已处理', done: '已标记为已处理',
    hint: '确认问题已处理完毕；系统仍会按指标独立判断是否恢复。',
  },
  pending: {
    title: '撤销认领', okText: '撤销认领', done: '已撤销认领',
    hint: '撤销后清空处理人与备注，告警重新回到待处理列表。',
  },
};

/** 指标筛选下拉：桌面与移动端共用，按业务域分组并支持搜索（指标已接近 30 个，平铺难以定位） */
const METRIC_FILTER_GROUPS = METRIC_GROUPS.map((group) => ({ label: group.label, items: group.children }));

function MetricFilterSelect({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  return <FilterSelect placeholder="全部指标" groups={METRIC_FILTER_GROUPS} value={value} onChange={onChange} width={170} filter />;
}

export default function AlertEventsPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  // 从告警规则页「查看事件」或概览页统计卡跳转而来时按 URL 过滤；
  // URL 是这类联查的唯一来源，刷新后依然生效
  const [urlParams, setUrlParams] = useSearchParams();
  const ruleId = Number(urlParams.get('ruleId')) || undefined;

  const canHandle = hasPermission('alert:event:handle');
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [handleTarget, setHandleTarget] = useState<
    { ids: number[]; handleStatus: MonitorAlertHandleStatus } | null
  >(null);
  const [handleFormApi, setHandleFormApi] = useState<FormApi | null>(null);

  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({
    // URL 携带的筛选作为初始条件，保证跳转过来时表单控件与列表结果一致
    defaults: () => ({
      ...defaultSearchParams,
      level: urlParams.get('level') ?? '',
      status: urlParams.get('status') ?? '',
      notifyStatus: urlParams.get('notifyStatus') ?? '',
      handleStatus: urlParams.get('handleStatus') ?? '',
    }),
    listKey: monitorAlertKeys.eventLists,
    onSearch: () => setSelectedRowKeys([]),
    onReset: () => setSelectedRowKeys([]),
  });

  const queryParams = useMemo(() => ({
    keyword: submittedParams.keyword || undefined,
    metric: enumValueOf(MONITOR_METRICS, submittedParams.metric),
    level: enumValueOf(MONITOR_ALERT_LEVELS, submittedParams.level),
    status: enumValueOf(MONITOR_ALERT_EVENT_STATUSES, submittedParams.status),
    notifyStatus: enumValueOf(MONITOR_ALERT_NOTIFY_STATUSES, submittedParams.notifyStatus),
    handleStatus: enumValueOf(MONITOR_ALERT_HANDLE_STATUSES, submittedParams.handleStatus),
    ruleId,
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  }), [submittedParams, ruleId]);

  const listQuery = useMonitorAlertEventList({ page, pageSize, ...queryParams });
  const data = listQuery.data ?? null;
  const handleMutation = useHandleMonitorAlertEvent();
  const batchHandleMutation = useBatchHandleMonitorAlertEvents();
  const submitting = handleMutation.isPending || batchHandleMutation.isPending;

  function openHandleModal(ids: number[], handleStatus: MonitorAlertHandleStatus) {
    setHandleTarget({ ids, handleStatus });
  }

  async function submitHandle() {
    if (!handleTarget) return;
    const note = (handleFormApi?.getValue('note') as string | undefined)?.trim() || null;
    const { ids, handleStatus } = handleTarget;
    if (ids.length === 1) {
      await handleMutation.mutateAsync({ params: { id: ids[0] }, body: { handleStatus, note } });
    } else {
      await batchHandleMutation.mutateAsync({ body: { ids, handleStatus, note } });
    }
    const meta = HANDLE_ACTION_META[handleStatus];
    Toast.success(`${meta.done}${ids.length > 1 ? `（${ids.length} 条）` : ''}`);
    setHandleTarget(null);
    setSelectedRowKeys([]);
  }

  const columns: ColumnProps<MonitorAlertEvent>[] = [
    dateTimeColumn('触发时间', 'triggeredAt'),
    { title: '规则', dataIndex: 'ruleName', width: 160, render: renderEllipsis },
    {
      title: '触发条件', dataIndex: 'metric', width: 210,
      render: (_: unknown, r: MonitorAlertEvent) => (
        <span>
          <Tag size="small" type="ghost">{METRIC_LABELS[r.metric] ?? r.metric}</Tag>
          {' '}{OP_SYMBOL[r.operator] ?? r.operator} {formatMonitorMetricValue(r.metric, r.threshold)}
        </span>
      ),
    },
    { title: '实际值', dataIndex: 'value', width: 110, render: (v: number, r: MonitorAlertEvent) => <b>{formatMonitorMetricValue(r.metric, v)}</b> },
    { title: '级别', dataIndex: 'level', width: 80, render: (v: string) => <Tag color={LEVEL_CONFIG[v]?.color ?? 'grey'} size="small">{LEVEL_CONFIG[v]?.label ?? v}</Tag> },
    { title: '描述', dataIndex: 'message', minWidth: 280, render: renderEllipsis },
    {
      title: '通知状态', dataIndex: 'notifyStatus', width: 120,
      render: (_: unknown, r: MonitorAlertEvent) => {
        const config = NOTIFY_CONFIG[r.notifyStatus];
        const channels = r.notifyChannels.map((c) => CHANNEL_LABELS[c] ?? c).join('、');
        const tip = r.notifyError
          ?? (r.notifyStatus === 'skipped' ? '规则未配置任何通知渠道' : channels ? `已尝试渠道：${channels}` : undefined);
        const tag = <Tag color={config?.color ?? 'grey'} size="small">{config?.label ?? r.notifyStatus}</Tag>;
        return tip ? <Tooltip content={tip}>{tag}</Tooltip> : tag;
      },
    },
    dateTimeColumn('通知时间', 'notifiedAt', { empty: EMPTY_PLACEHOLDER }),
    { title: '处理人', dataIndex: 'handledByName', width: 110, render: renderEllipsis },
    dateTimeColumn('恢复时间', 'resolvedAt'),
    {
      title: '处理状态', dataIndex: 'handleStatus', width: 110, fixed: 'right',
      render: (_: unknown, r: MonitorAlertEvent) => {
        const config = HANDLE_CONFIG[r.handleStatus];
        const tag = <Tag color={config?.color ?? 'grey'} size="small">{config?.label ?? r.handleStatus}</Tag>;
        return r.handleNote ? <Tooltip content={r.handleNote}>{tag}</Tooltip> : tag;
      },
    },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (s: string) => s === 'firing' ? <Tag color="red" size="small">告警中</Tag> : <Tag color="green" size="small">已恢复</Tag>,
    },
    createOperationColumn<MonitorAlertEvent>({
      desktopInlineKeys: ['ack', 'close'],
      width: 220,
      actions: (record) => [
        {
          key: 'viewLog',
          label: '查看日志',
          hidden: !(record.metric in LOG_METRIC_LEVEL) || !hasPermission('system:log:files'),
          onClick: () => {
            // 按触发日期定位当天应用日志文件（app.日期.1.log）
            const date = record.triggeredAt?.slice(0, 10);
            navigate(`/system/log-files?file=app.${date}.1.log&level=${LOG_METRIC_LEVEL[record.metric]}`);
          },
        },
        {
          key: 'ack',
          label: '认领',
          hidden: !canHandle || record.handleStatus !== 'pending',
          onClick: () => openHandleModal([record.id], 'acknowledged'),
        },
        {
          key: 'close',
          label: '标记已处理',
          hidden: !canHandle || record.handleStatus === 'closed',
          onClick: () => openHandleModal([record.id], 'closed'),
        },
        {
          key: 'reopen',
          label: '撤销认领',
          hidden: !canHandle || record.handleStatus === 'pending',
          onClick: () => openHandleModal([record.id], 'pending'),
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput
      placeholder="搜索规则名称或描述..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      onSearch={handleSearch}
    />
  );

  const renderMetricFilter = () => (
    <MetricFilterSelect
      value={draftParams.metric}
      onChange={(v) => setDraftParams((p) => ({ ...p, metric: v }))}
    />
  );

  const renderLevelFilter = () => (
    <FilterSelect
      placeholder="全部级别"
      items={MONITOR_ALERT_LEVEL_OPTIONS}
      value={draftParams.level}
      onChange={(v) => setDraftParams((p) => ({ ...p, level: v }))}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={MONITOR_ALERT_EVENT_STATUS_OPTIONS}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderHandleStatusFilter = () => (
    <FilterSelect
      placeholder="全部处理状态"
      items={MONITOR_ALERT_HANDLE_STATUS_OPTIONS}
      value={draftParams.handleStatus}
      onChange={(v) => setDraftParams((p) => ({ ...p, handleStatus: v }))}
      width={140}
    />
  );

  const renderNotifyStatusFilter = () => (
    <FilterSelect
      placeholder="全部通知状态"
      items={MONITOR_ALERT_NOTIFY_STATUS_OPTIONS}
      value={draftParams.notifyStatus}
      onChange={(v) => setDraftParams((p) => ({ ...p, notifyStatus: v }))}
      width={140}
    />
  );

  const renderTimeRangeFilter = () => (
    <DateRangeFilter
      value={draftParams.timeRange}
      onChange={(v) => setDraftParams((p) => ({ ...p, timeRange: v }))}
    />
  );

  const renderRuleFilterTag = () => ruleId ? (
    <Tag closable color="blue" onClose={() => setUrlParams({}, { replace: true })}>
      仅看规则 #{ruleId}
    </Tag>
  ) : null;

  const renderBatchActions = () => canHandle && selectedRowKeys.length > 0 ? (
    <>
      <Button theme="light" onClick={() => openHandleModal(selectedRowKeys, 'acknowledged')}>
        批量认领 ({selectedRowKeys.length})
      </Button>
      <Button theme="light" onClick={() => openHandleModal(selectedRowKeys, 'closed')}>
        批量标记已处理 ({selectedRowKeys.length})
      </Button>
    </>
  ) : null;

  const renderExportButton = (variant?: 'flat') => hasPermission('alert:event:export')
    ? <ExportButton entity="alert.monitor-alert-events" query={queryParams} variant={variant} />
    : null;

  const actionMeta = handleTarget ? HANDLE_ACTION_META[handleTarget.handleStatus] : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderRuleFilterTag()}
            {renderKeywordSearch()}
            {renderMetricFilter()}
            {renderLevelFilter()}
            {renderStatusFilter()}
            {renderHandleStatusFilter()}
            {renderNotifyStatusFilter()}
            {renderTimeRangeFilter()}
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
            {renderBatchActions()}
          </>
        )}
        actions={renderExportButton()}
        mobilePrimary={(
          <>
            {renderRuleFilterTag()}
            {renderKeywordSearch()}
            <SearchButton onClick={handleSearch} />
          </>
        )}
        mobileFilters={(
          <>
            {renderMetricFilter()}
            {renderLevelFilter()}
            {renderStatusFilter()}
            {renderHandleStatusFilter()}
            {renderNotifyStatusFilter()}
            {renderTimeRangeFilter()}
          </>
        )}
        mobileActions={(
          <>
            {renderBatchActions()}
            {renderExportButton('flat')}
          </>
        )}
        filterTitle="告警事件筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无告警记录"
        rowSelection={canHandle
          ? { selectedRowKeys, onChange: (keys) => setSelectedRowKeys((keys ?? []) as number[]) }
          : undefined}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
      />

      {/* 处理弹窗不走 useEditModal：它不是实体的新增 / 编辑，而是对既有记录的状态流转 */}
      <AppModal
        title={actionMeta?.title ?? '处理告警'}
        visible={handleTarget !== null}
        okText={actionMeta?.okText}
        confirmLoading={submitting}
        onOk={() => void submitHandle()}
        onCancel={() => setHandleTarget(null)}
        closeOnEsc
        width={520}
      >
        <p style={{ marginTop: 0, color: 'var(--semi-color-text-1)' }}>
          {handleTarget && handleTarget.ids.length > 1
            ? `将对选中的 ${handleTarget.ids.length} 条告警执行此操作。`
            : null}
          {actionMeta?.hint}
        </p>
        <Form
          key={`${handleTarget?.handleStatus ?? ''}-${handleTarget?.ids.join(',') ?? ''}`}
          getFormApi={setHandleFormApi}
          labelPosition="left"
          labelWidth={72}
        >
          {handleTarget?.handleStatus !== 'pending' && (
            <Form.TextArea
              field="note"
              label="处理备注"
              placeholder="可选，记录原因与处置动作"
              maxCount={500}
              autosize={{ minRows: 3, maxRows: 6 }}
            />
          )}
        </Form>
      </AppModal>
    </div>
  );
}
