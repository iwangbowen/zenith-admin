import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Select, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { workflowTaskContract, type WorkflowHealthIssue, type WorkflowHealthSummary } from '@zenith/shared/workflow';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import WorkflowInstanceCell from '@/components/workflow/WorkflowInstanceCell';
import WorkflowInstanceDetailSheet from '@/components/workflow/WorkflowInstanceDetailSheet';
import { useWorkflowHealthSummary, workflowHealthKeys } from '@/hooks/queries/workflow-health';
import { usePermission } from '@/hooks/usePermission';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { dateTimeColumn } from '@/utils/table-columns';
import { useApiMutation } from '@/lib/contract-query';
import { createLabelOptionsFromMap } from '@zenith/shared/core';
import { FilterSelect } from '@/components/search-filters';

const ISSUE_LABELS: Record<WorkflowHealthIssue['type'], string> = {
  external_dispatch_failed: '外部审批失败',
  external_dispatch_pending: '外部审批未派发',
  trigger_waiting_no_execution: '触发器无执行记录',
  trigger_execution_failed: '触发器执行失败',
  subprocess_waiting: '子流程等待',
  delay_overdue: '延迟未唤醒',
  delay_missing_wake_job: '延迟缺唤醒作业',
  task_timeout_overdue: '任务超时',
  token_task_mismatch: 'Token 与任务不一致',
  workflow_event_outbox_failed: '事件派发失败',
  workflow_event_outbox_pending: '事件派发待处理',
  waiting_task_stuck: '任务等待过久',
  instance_stalled: '实例疑似卡死',
};
const ISSUE_OPTIONS = createLabelOptionsFromMap(ISSUE_LABELS);

const THRESHOLD_OPTIONS = [
  { value: 10, label: '超过 10 分钟' },
  { value: 15, label: '超过 15 分钟' },
  { value: 30, label: '超过 30 分钟（推荐）' },
  { value: 60, label: '超过 1 小时' },
  { value: 120, label: '超过 2 小时' },
  { value: 240, label: '超过 4 小时' },
  { value: 1440, label: '超过 1 天' },
];

export default function WorkflowHealthPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const [thresholdMinutes, setThresholdMinutes] = useState(30);
  const [submittedThresholdMinutes, setSubmittedThresholdMinutes] = useState(30);
  const [issueType, setIssueType] = useState<WorkflowHealthIssue['type'] | undefined>();
  const [detailInstanceId, setDetailInstanceId] = useState<number | null>(null);
  const summaryQuery = useWorkflowHealthSummary({ thresholdMinutes: submittedThresholdMinutes });
  const data: WorkflowHealthSummary | null = summaryQuery.data ?? null;

  // 与任务监控同一入口：非 0 code（如催办限频）由 api() 抛错走全局提示
  const urgeMutation = useApiMutation(workflowTaskContract.urgeTask, {
    onSuccess: () => {
      Toast.success('已催办');
    },
  });

  const canUrge = hasPermission('workflow:instance:monitor');

  const handleSearch = () => {
    setSubmittedThresholdMinutes(thresholdMinutes);
    void queryClient.invalidateQueries({ queryKey: workflowHealthKeys.all });
  };

  const handleReset = () => {
    setThresholdMinutes(30);
    setSubmittedThresholdMinutes(30);
    setIssueType(undefined);
    void queryClient.invalidateQueries({ queryKey: workflowHealthKeys.all });
  };

  const columns: ColumnProps<WorkflowHealthIssue>[] = [
    {
      title: '级别',
      dataIndex: 'severity',
      width: 90,
      render: (v: WorkflowHealthIssue['severity']) => (
        <Tag color={v === 'critical' ? 'red' : 'orange'} size="small">{v === 'critical' ? '严重' : '警告'}</Tag>
      ),
    },
    {
      title: '问题类型',
      dataIndex: 'type',
      width: 150,
      render: (v: WorkflowHealthIssue['type']) => ISSUE_LABELS[v] ?? v,
    },
    {
      title: '说明',
      dataIndex: 'title',
      ellipsis: { showTitle: true },
      render: (_: unknown, row) => (
        <div>
          <Typography.Text strong>{row.title}</Typography.Text>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>{row.description}</Typography.Text>
        </div>
      ),
    },
    {
      title: '实例',
      dataIndex: 'instanceId',
      width: 220,
      render: (_: unknown, row) => (
        <WorkflowInstanceCell
          instanceId={row.instanceId}
          title={row.instanceTitle}
          onOpen={(id) => setDetailInstanceId(id)}
        />
      ),
    },
    { title: '任务', dataIndex: 'taskId', width: 90, render: (v: number | null) => v ? `#${v}` : '—' },
    { title: '节点', dataIndex: 'nodeName', width: 160, render: (_: unknown, row) => row.nodeName ?? row.nodeKey ?? '—' },
    { title: '状态', dataIndex: 'status', width: 110, render: (v: string | null) => v ?? '—' },
    { title: '等待时长', dataIndex: 'ageMinutes', width: 110, align: 'right', render: (v: number) => `${v} 分钟` },
    dateTimeColumn('创建时间', 'createdAt'),
    createOperationColumn<WorkflowHealthIssue>({
      width: 180,
      desktopInlineKeys: ['urge', 'instance'],
      actions: (row) => [
        {
          key: 'urge',
          label: '催办',
          hidden: !canUrge || !row.taskId || row.status !== 'pending',
          onClick: () => {
            Modal.confirm({
              title: '确定催办该任务？',
              content: '将向当前处理人发送催办提醒。',
              onOk: () => urgeMutation.mutateAsync({ params: { taskId: row.taskId as number }, body: {} }).then(() => undefined),
            });
          },
        },
        {
          key: 'instance',
          label: '查看实例',
          hidden: !row.instanceId,
          onClick: () => setDetailInstanceId(row.instanceId as number),
        },
      ],
    }),
  ];

  const renderThresholdFilter = () => (
    <Select
      value={thresholdMinutes}
      onChange={(v) => setThresholdMinutes(Number(v) || 30)}
      optionList={THRESHOLD_OPTIONS}
      prefix="只看等待"
      suffix="的问题"
      style={{ width: 320 }}
    />
  );

  const renderMobileThresholdFilter = () => (
    <FilterSelect
      placeholder="全部等待阈值"
      items={THRESHOLD_OPTIONS}
      value={thresholdMinutes}
      onChange={(v) => setThresholdMinutes(Number(v) || 30)}
      width={180}
    />
  );

  const renderIssueTypeFilter = () => (
    <FilterSelect
      placeholder="全部问题类型"
      items={ISSUE_OPTIONS}
      value={issueType}
      onChange={setIssueType}
      width={220}
      prefix="问题类型"
    />
  );

  const renderSearchButton = () => (
    <SearchButton onClick={handleSearch} />
  );

  const renderResetButton = () => (
    <ResetButton onClick={handleReset} />
  );

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderThresholdFilter()}
            {renderIssueTypeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderMobileThresholdFilter()}
            {renderSearchButton()}
          </>
        )}
        mobileFilters={renderIssueTypeFilter()}
        filterTitle="健康巡检筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <StatGrid minItemWidth={150} style={{ marginBottom: 12 }}>
        <StatCard title="问题总数" value={data?.stats.total ?? 0} accent={(data?.stats.total ?? 0) > 0 ? 'var(--semi-color-danger)' : undefined} />
        <StatCard title="严重" value={data?.stats.critical ?? 0} accent={(data?.stats.critical ?? 0) > 0 ? 'var(--semi-color-danger)' : undefined} />
        <StatCard title="警告" value={data?.stats.warning ?? 0} />
        <StatCard title="外部审批失败" value={data?.stats.externalFailed ?? 0} accent={(data?.stats.externalFailed ?? 0) > 0 ? 'var(--semi-color-danger)' : undefined} />
        <StatCard title="触发器卡住" value={data?.stats.triggerStuck ?? 0} accent={(data?.stats.triggerStuck ?? 0) > 0 ? 'var(--semi-color-danger)' : undefined} />
        <StatCard title="事件派发失败" value={data?.stats.outboxFailed ?? 0} accent={(data?.stats.outboxFailed ?? 0) > 0 ? 'var(--semi-color-danger)' : undefined} />
      </StatGrid>

      <ConfigurableTable
        bordered
        rowKey="id"
        loading={summaryQuery.isFetching}
        dataSource={(data?.issues ?? []).filter((issue) => !issueType || issue.type === issueType)}
        columns={columns}
        pagination={false}
        onRefresh={() => void summaryQuery.refetch()}
        refreshLoading={summaryQuery.isFetching}
      />

      <WorkflowInstanceDetailSheet
        instanceId={detailInstanceId}
        visible={detailInstanceId != null}
        onClose={() => setDetailInstanceId(null)}
      />
    </div>
  );
}
