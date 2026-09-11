/**
 * 任务监控 Tab（流程监控页）— 跨实例的任务粒度运维视图。
 * 字段对齐审批平台惯例：流程 / 发起人 / 发起时间 / 当前任务 / 任务起止时间 / 审批人 /
 * 审批状态 / 审批建议 / 耗时 / 流程编号 / 任务编号；行操作：详情（实例详情抽屉）/ 催办。
 */
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { enumValueOf } from '@zenith/shared/core';
import { WORKFLOW_TASK_MONITOR_NODE_TYPES, WORKFLOW_TASK_STATUSES, workflowTaskContract, type WorkflowTaskMonitorItem } from '@zenith/shared/workflow';
import ConfigurableTable from '@/components/ConfigurableTable';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import {
  WORKFLOW_TASK_NODE_TYPE_OPTIONS,
  taskAssigneeColumn, taskCommentColumn, taskIdColumn, taskNodeColumn, taskStatusColumn, taskStayDurationColumn,
} from '@/components/workflow/workflow-task-columns';
import WorkflowInstanceCell from '@/components/workflow/WorkflowInstanceCell';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import { useWorkflowTaskMonitorList, workflowMonitorKeys, type WorkflowTaskMonitorParams } from '@/hooks/queries/workflow-monitor';
import { useApiMutation } from '@/lib/contract-query';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { dateTimeColumn } from '@/utils/table-columns';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';

const STUCK_OPTIONS = [
  { value: 30, label: '停留 > 30 分钟' },
  { value: 120, label: '停留 > 2 小时' },
  { value: 1440, label: '停留 > 24 小时' },
];

interface SearchParams {
  keyword: string;
  assigneeKeyword: string;
  status?: string;
  nodeType?: string;
  stuckMinutes?: number;
  createdRange: [Date, Date] | null;
}

const defaultSearchParams: SearchParams = {
  keyword: '', assigneeKeyword: '', status: undefined, nodeType: undefined, stuckMinutes: undefined, createdRange: null,
};

interface Props {
  readonly onOpenInstance: (instanceId: number) => void;
}

export default function WorkflowTasksMonitorView({ onOpenInstance }: Props) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, bind, bindKeyword, submittedParams,
    handleSearch, applySearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: workflowMonitorKeys.taskMonitorLists });

  const { startTime, endTime } = formatDateTimeRangeForApi(submittedParams.createdRange);
  const params: WorkflowTaskMonitorParams = {
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    assigneeKeyword: submittedParams.assigneeKeyword || undefined,
    status: enumValueOf(WORKFLOW_TASK_STATUSES, submittedParams.status),
    nodeType: enumValueOf(WORKFLOW_TASK_MONITOR_NODE_TYPES, submittedParams.nodeType),
    stuckMinutes: submittedParams.stuckMinutes,
    startTime,
    endTime,
  };
  const listQuery = useWorkflowTaskMonitorList(params);
  const data = listQuery.data ?? null;
  const stats = data?.stats ?? { total: 0, pending: 0, waiting: 0, approved: 0, rejected: 0, skipped: 0 };
  const statValue = (v: number) => (listQuery.isLoading ? '—' : v);

  // 非 0 code（如 429 催办限频）由 api() 抛错走全局错误提示，避免同时弹「已催办」
  const urgeMutation = useApiMutation(workflowTaskContract.urgeTask, {
    onSuccess: () => {
      Toast.success('已催办');
      void queryClient.invalidateQueries({ queryKey: workflowMonitorKeys.taskMonitorLists });
    },
  });

  const handleStatCardClick = (status: string | undefined) => {
    applySearch({ ...draftParams, status: draftParams.status === status ? undefined : status });
  };

  const columns: ColumnProps<WorkflowTaskMonitorItem>[] = [
    taskIdColumn<WorkflowTaskMonitorItem>('任务编号', 90),
    {
      title: '申请标题',
      dataIndex: 'instanceTitle',
      width: 220,
      render: (v: string, r) => (
        <WorkflowInstanceCell instanceId={r.instanceId} title={v} showSub={false} onOpen={onOpenInstance} />
      ),
    },
    {
      title: '流程',
      dataIndex: 'definitionName',
      minWidth: 200,
      render: (v: string | null, r) => (
        <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>
          {r.serialNo ?? `#${r.instanceId}`} · {v ?? '—'}
        </Typography.Text>
      ),
    },
    { title: '发起人', dataIndex: 'initiatorName', width: 110, render: (v: string | null) => v ?? '—' },
    dateTimeColumn('发起时间', 'instanceCreatedAt'),
    taskNodeColumn<WorkflowTaskMonitorItem>({ title: '当前任务', width: 200, withTypeTag: true }),
    dateTimeColumn('任务开始时间', 'createdAt'),
    dateTimeColumn('任务结束时间', 'actionAt'),
    taskAssigneeColumn<WorkflowTaskMonitorItem>('审批人'),
    taskStatusColumn<WorkflowTaskMonitorItem>('审批状态'),
    taskCommentColumn<WorkflowTaskMonitorItem>(),
    taskStayDurationColumn<WorkflowTaskMonitorItem>(),
    createOperationColumn<WorkflowTaskMonitorItem>({
      width: 150,
      desktopInlineKeys: ['detail', 'urge'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => onOpenInstance(record.instanceId) },
        {
          key: 'urge',
          label: '催办',
          hidden: record.status !== 'pending' || !hasPermission('workflow:instance:monitor'),
          onClick: () => {
            Modal.confirm({
              title: '确定催办该任务？',
              content: `将向处理人「${record.assigneeName ?? '未指派'}」发送催办提醒。`,
              onOk: () => urgeMutation.mutateAsync({ params: { taskId: record.id }, body: {} }).then(() => undefined),
            });
          },
        },
      ],
    }),
  ];

  return (
    <>
      <StatGrid minItemWidth={120} style={{ marginBottom: 16 }}>
        <StatCard title="全部" value={statValue(stats.total ?? 0)} accent="var(--semi-color-text-0)" onClick={() => handleStatCardClick(undefined)} active={!draftParams.status} />
        <StatCard title="待处理" value={statValue(stats.pending ?? 0)} accent="var(--semi-color-primary)" onClick={() => handleStatCardClick('pending')} active={draftParams.status === 'pending'} />
        <StatCard title="等待中" value={statValue(stats.waiting ?? 0)} accent="var(--semi-color-warning)" onClick={() => handleStatCardClick('waiting')} active={draftParams.status === 'waiting'} />
        <StatCard title="已通过" value={statValue(stats.approved ?? 0)} accent="#0dc87c" onClick={() => handleStatCardClick('approved')} active={draftParams.status === 'approved'} />
        <StatCard title="已驳回" value={statValue(stats.rejected ?? 0)} accent="#ff4d4f" onClick={() => handleStatCardClick('rejected')} active={draftParams.status === 'rejected'} />
        <StatCard title="已跳过" value={statValue(stats.skipped ?? 0)} accent="#8b5cf6" onClick={() => handleStatCardClick('skipped')} active={draftParams.status === 'skipped'} />
      </StatGrid>

      <ListSearchToolbar
        keyword={<KeywordInput placeholder="流程名称 / 申请标题" {...bindKeyword('keyword')} width={200} />}
        filters={(
          <>
            <KeywordInput placeholder="审批人" {...bindKeyword('assigneeKeyword')} width={130} />
            <FilterSelect
              placeholder="全部节点类型"
              items={WORKFLOW_TASK_NODE_TYPE_OPTIONS}
              {...bind('nodeType')}
              width={140}
            />
            <FilterSelect
              placeholder="全部停留时长"
              items={STUCK_OPTIONS}
              {...bind('stuckMinutes')}
              width={150}
            />
            <DateRangeFilter
              placeholder={['创建时间起', '创建时间止']}
              {...bind('createdRange')}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
      />

      <ConfigurableTable<WorkflowTaskMonitorItem>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />
    </>
  );
}
