import { useState } from 'react';
import { Empty, Modal, SideSheet, Space, Spin, Tag, Timeline, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { WORKFLOW_SCHEDULE_RUN_TRIGGER_LABELS, type WorkflowSchedule, type WorkflowScheduleRun } from '@zenith/shared/workflow';
import ConfigurableTable from '@/components/ConfigurableTable';
import DateTimeText from '@/components/DateTimeText';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { listTableProps } from '@/components/list-page';
import { RefreshButton } from '@/components/toolbar-controls';
import WorkflowInstanceCell from '@/components/workflow/WorkflowInstanceCell';
import WorkflowInstanceDetailSheet from '@/components/workflow/WorkflowInstanceDetailSheet';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useRetryWorkflowScheduleRun, useWorkflowScheduleRunDetail, useWorkflowScheduleRuns } from '@/hooks/queries/workflow-schedules';
import { dateTimeColumn } from '@/utils/table-columns';
import { WORKFLOW_JOB_STATUS_META } from '../monitor/constants';

export default function WorkflowScheduleRunsSheet({ schedule, onClose }: Readonly<{ schedule: WorkflowSchedule; onClose: () => void }>) {
  const pagination = usePagination({ pageSize: 20, resetKey: schedule.id });
  const runs = useWorkflowScheduleRuns(schedule.id, { page: pagination.page, pageSize: pagination.pageSize });
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [instanceId, setInstanceId] = useState<number | null>(null);
  const detail = useWorkflowScheduleRunDetail(schedule.id, selectedRun);
  const retry = useRetryWorkflowScheduleRun();
  const { hasPermission } = usePermission();
  const columns: ColumnProps<WorkflowScheduleRun>[] = [
    dateTimeColumn('计划周期', 'scheduledAt'),
    { title: '触发方式', dataIndex: 'trigger', width: 100, render: (value: WorkflowScheduleRun['trigger']) => WORKFLOW_SCHEDULE_RUN_TRIGGER_LABELS[value] },
    { title: '执行状态', dataIndex: 'status', width: 110, render: (status: WorkflowScheduleRun['status'], run) => {
      const meta = WORKFLOW_JOB_STATUS_META[status];
      return <Tag color={meta.color} size="small">{status === 'pending' && run.attempts > 0 ? '等待重试' : meta.text}</Tag>;
    } },
    { title: '尝试', dataIndex: 'attempts', width: 75, render: (value: number, run) => `${value}/${run.maxAttempts}` },
    { title: '下次尝试', dataIndex: 'runAt', width: 180, render: (value: string, run) => run.status === 'pending' ? <DateTimeText value={value} /> : '—' },
    { title: '审批实例', dataIndex: 'instanceTitle', minWidth: 220, render: (_value, run) => (
      <WorkflowInstanceCell instanceId={run.instanceId} title={run.instanceTitle ?? (typeof run.payload.title === 'string' ? run.payload.title : null)}
        onOpen={setInstanceId} emptyText="尚未发起" />
    ) },
    { title: '失败原因', dataIndex: 'lastError', width: 180, render: (value: string | null) => (
      value ? <Typography.Text type="danger" ellipsis={{ showTooltip: true }} style={{ maxWidth: 165 }}>{value}</Typography.Text> : '—'
    ) },
    createOperationColumn<WorkflowScheduleRun>({ width: 170, desktopInlineKeys: ['attempts', 'retry'], actions: (run) => [
      { key: 'attempts', label: '执行尝试', onClick: () => setSelectedRun(run.id) },
      { key: 'retry', label: '补发原周期', hidden: !hasPermission('workflow:schedule:edit') || !['failed', 'dead', 'canceled'].includes(run.status),
        loading: retry.isPending && retry.variables?.params.jobId === run.id, disabled: retry.isPending,
        onClick: () => { Modal.confirm({ title: '补发这个定时周期？', content: '沿用该周期的原始标题、表单和发起人。已创建的审批实例会直接复用。',
          onOk: async () => { await retry.mutateAsync({ params: { id: schedule.id, jobId: run.id } }); Toast.success('已提交原周期补发'); } }); },
      },
    ] }),
  ];
  return (
    <>
      <SideSheet visible title={`执行记录 · ${schedule.name}`} onCancel={onClose} width={1040} closeOnEsc>
        <Space vertical align="start" spacing={12} style={{ width: '100%' }}>
          <Typography.Text type="tertiary">每个周期单独记录；失败自动重试，补发保留原周期的数据。</Typography.Text>
          <RefreshButton onClick={() => void runs.refetch()} loading={runs.isFetching} />
        </Space>
        {runs.data?.total === 0 ? <Empty description="暂无执行记录，定时触发或立即执行后在这里查看" style={{ marginTop: 64 }} /> : (
          <ConfigurableTable<WorkflowScheduleRun> columns={columns} {...listTableProps(runs, { pagination: pagination.buildPagination })} />
        )}
      </SideSheet>
      <SideSheet visible={selectedRun !== null} title="周期执行尝试" onCancel={() => setSelectedRun(null)} width={620} closeOnEsc>
        <Spin spinning={detail.isLoading}>
          {detail.data && <Space vertical align="start" style={{ width: '100%' }} spacing={16}>
            <Typography.Text>原计划时间：<DateTimeText value={detail.data.scheduledAt} /></Typography.Text>
            <WorkflowInstanceCell instanceId={detail.data.instanceId} title={detail.data.instanceTitle} onOpen={setInstanceId} emptyText="尚未创建审批实例" />
            <Timeline>
              {[...detail.data.executions].sort((a, b) => a.generation - b.generation || a.attempt - b.attempt).map((attempt) => (
                <Timeline.Item key={attempt.id} type={attempt.status === 'succeeded' ? 'success' : attempt.status === 'failed' ? 'error' : 'ongoing'}
                  time={<DateTimeText value={attempt.finishedAt ?? attempt.startedAt ?? attempt.createdAt} />}>
                  <Space vertical align="start" spacing={4}>
                    <Typography.Text strong>第 {attempt.generation + 1} 轮 · 第 {attempt.attempt} 次</Typography.Text>
                    <Typography.Text>{attempt.status === 'succeeded' ? '成功' : attempt.status === 'running' ? '执行中' : attempt.status === 'canceled' ? '已取消' : attempt.status === 'skipped' ? '已跳过' : '失败'}{attempt.durationMs != null ? ` · ${attempt.durationMs} ms` : ''}</Typography.Text>
                    {attempt.errorMessage && <Typography.Paragraph type="danger">{attempt.errorMessage}</Typography.Paragraph>}
                  </Space>
                </Timeline.Item>
              ))}
            </Timeline>
          </Space>}
          {detail.data?.executions.length === 0 && <Empty description="等待首次执行" />}
        </Spin>
      </SideSheet>
      <WorkflowInstanceDetailSheet instanceId={instanceId} visible={instanceId !== null} onClose={() => setInstanceId(null)} />
    </>
  );
}
