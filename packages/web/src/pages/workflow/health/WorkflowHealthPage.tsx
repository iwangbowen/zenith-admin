import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Select, Space, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw, Search } from 'lucide-react';
import type { WorkflowHealthIssue, WorkflowHealthSummary } from '@zenith/shared';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { useWorkflowHealthSummary, workflowHealthKeys } from '@/hooks/queries/workflow-health';

const ISSUE_LABELS: Record<WorkflowHealthIssue['type'], string> = {
  external_dispatch_failed: '外部审批失败',
  external_dispatch_pending: '外部审批未派发',
  trigger_waiting_no_execution: '触发器无执行记录',
  trigger_execution_failed: '触发器执行失败',
  subprocess_waiting: '子流程等待',
  delay_overdue: '延迟未唤醒',
  delay_missing_wake_job: '延迟缺唤醒作业',
  task_timeout_overdue: '任务超时',
  workflow_event_outbox_failed: '事件派发失败',
  workflow_event_outbox_pending: '事件派发待处理',
  waiting_task_stuck: '任务等待过久',
  instance_stalled: '实例疑似卡死',
};

const THRESHOLD_OPTIONS = [
  { value: 10, label: '超过 10 分钟' },
  { value: 15, label: '超过 15 分钟' },
  { value: 30, label: '超过 30 分钟（推荐）' },
  { value: 60, label: '超过 1 小时' },
  { value: 120, label: '超过 2 小时' },
  { value: 240, label: '超过 4 小时' },
  { value: 1440, label: '超过 1 天' },
];

const ISSUE_TYPE_OPTIONS = [
  { value: '', label: '全部问题类型' },
  ...Object.entries(ISSUE_LABELS).map(([value, label]) => ({ value, label })),
];

function SummaryItem({ label, value, danger }: Readonly<{ label: string; value: number; danger?: boolean }>) {
  return (
    <div style={{ minWidth: 120, padding: '10px 12px', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
      <Typography.Text type="tertiary" size="small">{label}</Typography.Text>
      <div style={{ fontSize: 22, fontWeight: 600, color: danger ? 'var(--semi-color-danger)' : 'var(--semi-color-text-0)' }}>{value}</div>
    </div>
  );
}

export default function WorkflowHealthPage() {
  const queryClient = useQueryClient();
  const [thresholdMinutes, setThresholdMinutes] = useState(30);
  const [submittedThresholdMinutes, setSubmittedThresholdMinutes] = useState(30);
  const [issueType, setIssueType] = useState<WorkflowHealthIssue['type'] | ''>('');
  const summaryQuery = useWorkflowHealthSummary({ thresholdMinutes: submittedThresholdMinutes });
  const data: WorkflowHealthSummary | null = summaryQuery.data ?? null;

  const handleSearch = () => {
    setSubmittedThresholdMinutes(thresholdMinutes);
    void queryClient.invalidateQueries({ queryKey: workflowHealthKeys.all });
  };

  const handleReset = () => {
    setThresholdMinutes(30);
    setSubmittedThresholdMinutes(30);
    setIssueType('');
    void queryClient.invalidateQueries({ queryKey: workflowHealthKeys.all });
  };

  const columns: ColumnProps<WorkflowHealthIssue>[] = [
    {
      title: '级别',
      dataIndex: 'severity',
      width: 90,
      fixed: 'right',
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
    { title: '实例', dataIndex: 'instanceId', width: 180, render: (_: unknown, row) => row.instanceId ? `#${row.instanceId} ${row.instanceTitle ?? ''}` : '—' },
    { title: '任务', dataIndex: 'taskId', width: 90, render: (v: number | null) => v ? `#${v}` : '—' },
    { title: '节点', dataIndex: 'nodeName', width: 160, render: (_: unknown, row) => row.nodeName ?? row.nodeKey ?? '—' },
    { title: '状态', dataIndex: 'status', width: 110, render: (v: string | null) => v ?? '—' },
    { title: '等待时长', dataIndex: 'ageMinutes', width: 110, render: (v: number) => `${v} 分钟` },
    { title: '创建时间', dataIndex: 'createdAt', width: 170 },
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
    <Select
      value={thresholdMinutes}
      onChange={(v) => setThresholdMinutes(Number(v) || 30)}
      optionList={THRESHOLD_OPTIONS}
      placeholder="等待阈值"
      style={{ width: 180 }}
    />
  );

  const renderIssueTypeFilter = () => (
    <Select
      value={issueType}
      onChange={(v) => setIssueType(v as WorkflowHealthIssue['type'] | '')}
      optionList={ISSUE_TYPE_OPTIONS}
      prefix="问题类型"
      style={{ width: 220 }}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
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

      <Space wrap style={{ marginBottom: 12 }}>
        <SummaryItem label="问题总数" value={data?.stats.total ?? 0} danger={(data?.stats.total ?? 0) > 0} />
        <SummaryItem label="严重" value={data?.stats.critical ?? 0} danger={(data?.stats.critical ?? 0) > 0} />
        <SummaryItem label="警告" value={data?.stats.warning ?? 0} />
        <SummaryItem label="外部审批失败" value={data?.stats.externalFailed ?? 0} danger={(data?.stats.externalFailed ?? 0) > 0} />
        <SummaryItem label="触发器卡住" value={data?.stats.triggerStuck ?? 0} danger={(data?.stats.triggerStuck ?? 0) > 0} />
        <SummaryItem label="事件派发失败" value={data?.stats.outboxFailed ?? 0} danger={(data?.stats.outboxFailed ?? 0) > 0} />
      </Space>

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
    </div>
  );
}
