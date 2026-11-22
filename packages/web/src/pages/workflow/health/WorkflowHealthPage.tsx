import { useState } from 'react';
import { Button, Descriptions, Modal, Select, SideSheet, Tabs, TabPane, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router';
import { usePagination } from '@/hooks/usePagination';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { WORKFLOW_HEALTH_ISSUE_TYPE_LABELS, WORKFLOW_HEALTH_ISSUE_TYPE_OPTIONS, workflowTaskContract, type WorkflowHealthIssue, type WorkflowHealthSummary } from '@zenith/shared/workflow';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import WorkflowInstanceCell from '@/components/workflow/WorkflowInstanceCell';
import WorkflowInstanceDetailSheet from '@/components/workflow/WorkflowInstanceDetailSheet';
import { useWorkflowHealthSummary, workflowHealthKeys } from '@/hooks/queries/workflow-health';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { useApiMutation } from '@/lib/contract-query';
import { FilterSelect } from '@/components/search-filters';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';

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
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('active');
  const [selectedIssue, setSelectedIssue] = useState<WorkflowHealthIssue | null>(null);
  const { page, pageSize, buildPagination } = usePagination();
  const { hasPermission } = usePermission();
  const [issueType, setIssueType] = useState<WorkflowHealthIssue['type'] | undefined>();
  // 等待阈值走「草稿 → 查询」并回源健康汇总；问题类型为即时本地过滤，重置时一并清空
  const { bind, submittedParams, handleSearch, handleReset } = useListSearch<{ thresholdMinutes: number }>({
    defaults: { thresholdMinutes: 30 },
    listKey: workflowHealthKeys.all,
    onReset: () => setIssueType(undefined),
  });
  const [detailInstanceId, setDetailInstanceId] = useState<number | null>(null);
  const summaryQuery = useWorkflowHealthSummary({ thresholdMinutes: submittedParams.thresholdMinutes, type: issueType, page, pageSize });
  const data: WorkflowHealthSummary | null = summaryQuery.data ?? null;

  // 与任务监控同一入口：非 0 code（如催办限频）由 api() 抛错走全局提示
  const urgeMutation = useApiMutation(workflowTaskContract.urgeTask, {
    onSuccess: (result) => {
      const names = result.urged.map((row) => row.assigneeName ?? '处理人').join('、');
      Toast.success(names ? `已催办：${names}` : result.message);
    },
  });

  const canUrge = hasPermission('workflow:instance:create');

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
      render: (v: WorkflowHealthIssue['type']) => WORKFLOW_HEALTH_ISSUE_TYPE_LABELS[v] ?? v,
    },
    {
      title: '说明',
      dataIndex: 'title',
      width: 180,
      render: renderEllipsis,
    },
    {
      title: '详情',
      dataIndex: 'description',
      minWidth: 240,
      render: renderEllipsis,
    },
    {
      title: '实例',
      dataIndex: 'instanceId',
      width: 260,
      render: (_: unknown, row) => (
        <WorkflowInstanceCell
          instanceId={row.instanceId}
          title={row.instanceId != null ? `#${row.instanceId} · ${row.instanceTitle ?? ''}`.trim() : (row.instanceTitle ?? null)}
          showSub={false}
          onOpen={(id) => setDetailInstanceId(id)}
        />
      ),
    },
    { title: '任务', dataIndex: 'taskId', width: 90, render: (v: number | null) => v ? `#${v}` : EMPTY_PLACEHOLDER },
    { title: '节点', dataIndex: 'nodeName', width: 160, render: (_: unknown, row) => row.nodeName ?? row.nodeKey ?? EMPTY_PLACEHOLDER },
    { title: '状态', dataIndex: 'status', width: 110, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
    { title: '等待时长', dataIndex: 'ageMinutes', width: 110, align: 'right', render: (v: number) => `${v} 分钟` },
    dateTimeColumn('创建时间', 'createdAt'),
    createOperationColumn<WorkflowHealthIssue>({
      width: 180,
      desktopInlineKeys: ['evidence', 'instance'],
      actions: (row) => [
        { key: 'evidence', label: '问题详情', onClick: () => setSelectedIssue(row) },
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

  return (
    <div className="page-container page-tabs-page">
      <Typography.Text type="tertiary">检查时刻：{data?.checkedAt ?? '—'} · 当前授权范围 · {data?.ruleVersion ?? '—'} · 覆盖 {data?.coverage.instances ?? '—'} 个运行实例 / {data?.coverage.tasks ?? '—'} 个任务</Typography.Text>
      {summaryQuery.isError && <div role="alert">巡检失败，请重试。<Button onClick={() => void summaryQuery.refetch()}>重新检查</Button></div>}
      <Tabs activeKey={activeTab} onChange={setActiveTab} type="line">
      <TabPane itemKey="active" tab="活动问题">
      <ListSearchToolbar
        filters={(
          <>
            <Select
              {...bind('thresholdMinutes', (v: unknown) => Number(v) || 30)}
              optionList={THRESHOLD_OPTIONS}
              prefix="人工滞留阈值"
              // 前缀 + 「超过 30 分钟（推荐）」需单行完整展示，320 为实测下限
              style={{ width: 320 }}
            />
            <FilterSelect
              placeholder="全部问题类型"
              items={WORKFLOW_HEALTH_ISSUE_TYPE_OPTIONS}
              value={issueType}
              onChange={setIssueType}
              width={220}
              prefix="问题类型"
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="健康巡检筛选"
      />

      <StatGrid minItemWidth={150} style={{ marginBottom: 12 }}>
        <StatCard title="问题总数" value={data?.stats.total ?? '—'} accent={(data?.stats.total ?? 0) > 0 ? 'var(--semi-color-danger)' : undefined} />
        <StatCard title="严重" value={data?.stats.critical ?? '—'} accent={(data?.stats.critical ?? 0) > 0 ? 'var(--semi-color-danger)' : undefined} />
        <StatCard title="警告" value={data?.stats.warning ?? '—'} />
        <StatCard title="外部审批失败" value={data?.stats.externalFailed ?? '—'} accent={(data?.stats.externalFailed ?? 0) > 0 ? 'var(--semi-color-danger)' : undefined} />
        <StatCard title="触发器卡住" value={data?.stats.triggerStuck ?? '—'} accent={(data?.stats.triggerStuck ?? 0) > 0 ? 'var(--semi-color-danger)' : undefined} />
        <StatCard title="事件派发失败" value={data?.stats.outboxFailed ?? '—'} accent={(data?.stats.outboxFailed ?? 0) > 0 ? 'var(--semi-color-danger)' : undefined} />
      </StatGrid>

      <ConfigurableTable
        columns={columns}
        {...listTableProps({ ...summaryQuery, data: { list: data?.issues ?? [], total: data?.total ?? 0 } }, { pagination: buildPagination })}
      />
      </TabPane>
      <TabPane itemKey="coverage" tab="规则与检查覆盖">
        <Typography.Paragraph>结构异常、明确失败、外部结果未知和待修复工单立即检查；人工滞留使用所选阈值；SLA 超时使用任务冻结截止时间。摘要按完整授权范围计算，列表独立分页。</Typography.Paragraph>
        {WORKFLOW_HEALTH_ISSUE_TYPE_OPTIONS.map(rule => <Typography.Paragraph key={rule.value}>{rule.label} · {rule.value}</Typography.Paragraph>)}
      </TabPane>
      <TabPane itemKey="resolved" tab="恢复记录">
        <Typography.Paragraph>修复、恢复与终止记录保存在修复工单及作业执行历史，可追溯操作人、原因和处理结果。</Typography.Paragraph>
        <Button onClick={() => navigate('/workflow/monitor?tab=compensations')}>打开修复工单</Button>
      </TabPane>
      </Tabs>
      <SideSheet visible={!!selectedIssue} title="巡检问题详情" onCancel={() => setSelectedIssue(null)} width={Math.min(640, window.innerWidth)}>
        {selectedIssue && <><Typography.Title heading={5}>{selectedIssue.title}</Typography.Title><Typography.Paragraph>{selectedIssue.description}</Typography.Paragraph><Descriptions data={[{ key: '规则版本', value: selectedIssue.ruleVersion }, { key: '问题标识', value: selectedIssue.fingerprint }, { key: '实例 / 任务', value: '#' + selectedIssue.instanceId + ' / #' + (selectedIssue.taskId ?? '—') }, { key: '节点轮次', value: selectedIssue.activationId ?? '—' }]} />{selectedIssue.jobId && <Button onClick={() => navigate('/workflow/monitor?tab=jobs&jobId=' + selectedIssue.jobId)}>打开关联作业</Button>}<Button onClick={() => { setDetailInstanceId(selectedIssue.instanceId); setSelectedIssue(null); }}>查看实例</Button></>}
      </SideSheet>

      <WorkflowInstanceDetailSheet
        instanceId={detailInstanceId}
        visible={detailInstanceId != null}
        onClose={() => setDetailInstanceId(null)}
      />
    </div>
  );
}
