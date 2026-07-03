import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Col, Descriptions, Form, Input, Modal, Row, Select, Space, TabPane, Tabs, Tag, Toast, Typography, withField } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { AlertTriangle, CheckCircle2, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import type {
  SystemSchedulerAlertChannel,
  SystemSchedulerNode,
  SystemSchedulerRun,
  SystemSchedulerRunStatus,
  SystemSchedulerTask,
  SystemSchedulerTaskType,
  SystemSchedulerTriggerType,
} from '@zenith/shared';
import UserSelect from '@/components/UserSelect';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { renderEllipsis } from '@/utils/table-columns';
import {
  systemSchedulerKeys,
  useAcknowledgeSystemSchedulerAlert,
  useCleanupSystemSchedulerRuns,
  useRunSystemSchedulerTask,
  useSaveSystemSchedulerTaskConfig,
  useSystemSchedulerNodes,
  useSystemSchedulerRunDetail,
  useSystemSchedulerRuns,
  useSystemSchedulerTasks,
} from '@/hooks/queries/system-scheduler';

type TabKey = 'tasks' | 'runs' | 'nodes';

interface TaskSearchParams {
  keyword: string;
  module: string;
  taskType: string;
  status: string;
}

interface RunSearchParams {
  taskName: string;
  taskType: string;
  triggerType: string;
  status: string;
  alertStatus: string;
  startTime: string;
  endTime: string;
}

interface TaskConfigForm {
  enabled: boolean;
  logRetentionDays: number;
  logRetentionRuns: number;
  timeoutMs: number | null;
  failureAlertThreshold: number;
  alertEnabled: boolean;
  alertChannels: SystemSchedulerAlertChannel[];
  alertUserIds: number[];
  alertEmailsText: string;
  alertWebhookUrl: string | null;
  manualSingleton: boolean;
}

const defaultTaskSearch: TaskSearchParams = { keyword: '', module: '', taskType: '', status: '' };
const defaultRunSearch: RunSearchParams = { taskName: '', taskType: '', triggerType: '', status: '', alertStatus: '', startTime: '', endTime: '' };
const FormUserSelect = withField(UserSelect);
const EMPTY_TASKS: SystemSchedulerTask[] = [];
const EMPTY_RUNS: SystemSchedulerRun[] = [];
const EMPTY_NODES: SystemSchedulerNode[] = [];

const taskTypeMap = {
  recurring: { label: '周期任务', color: 'blue' },
  queue: { label: '队列 Worker', color: 'cyan' },
} as const satisfies Record<SystemSchedulerTaskType, { label: string; color: 'blue' | 'cyan' }>;

const runStatusMap = {
  running: { label: '运行中', color: 'blue' },
  success: { label: '成功', color: 'green' },
  failed: { label: '失败', color: 'red' },
} as const satisfies Record<SystemSchedulerRunStatus, { label: string; color: 'blue' | 'green' | 'red' }>;

const triggerTypeMap = {
  schedule: { label: '自动调度', color: 'blue' },
  manual: { label: '手动执行', color: 'orange' },
  queue: { label: '队列触发', color: 'cyan' },
} as const satisfies Record<SystemSchedulerTriggerType, { label: string; color: 'blue' | 'orange' | 'cyan' }>;

const alertChannelMap = {
  inapp: '系统号卡片',
  email: '邮件',
  webhook: 'Webhook',
} as const satisfies Record<SystemSchedulerAlertChannel, string>;

function formatDuration(value: number | null) {
  if (value == null) return '-';
  if (value < 1000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  return `${(value / 60_000).toFixed(1)} min`;
}

function statusTag(status: SystemSchedulerRunStatus | null) {
  if (!status) return <Typography.Text type="tertiary">未运行</Typography.Text>;
  const item = runStatusMap[status];
  return <Tag color={item.color}>{item.label}</Tag>;
}

function renderQueue(record: SystemSchedulerTask) {
  if (record.queueTotalCount === 0 && record.queueActiveCount === 0 && record.queueQueuedCount === 0) {
    return <Typography.Text type="tertiary">空闲</Typography.Text>;
  }
  return (
    <Space wrap spacing={4}>
      <Tag color="blue">待 {record.queueQueuedCount}</Tag>
      <Tag color="cyan">跑 {record.queueActiveCount}</Tag>
      <Tag color="orange">延 {record.queueDeferredCount}</Tag>
      {record.queueFailedCount > 0 && <Tag color="red">败 {record.queueFailedCount}</Tag>}
    </Space>
  );
}

function renderNode(hostname: string | null, pid: number | null) {
  if (!hostname && !pid) return '-';
  return `${hostname ?? '-'}${pid ? ` / ${pid}` : ''}`;
}

export default function SystemSchedulerPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const [activeTab, setActiveTab] = useState<TabKey>('tasks');
  const [taskSearch, setTaskSearch] = useState<TaskSearchParams>(defaultTaskSearch);
  const [draftRunSearch, setDraftRunSearch] = useState<RunSearchParams>(defaultRunSearch);
  const [submittedRunSearch, setSubmittedRunSearch] = useState<RunSearchParams>(defaultRunSearch);
  const [configTask, setConfigTask] = useState<SystemSchedulerTask | null>(null);
  const [detailRun, setDetailRun] = useState<SystemSchedulerRun | null>(null);
  const configFormApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination(20);
  const { page: nodesPage, pageSize: nodesPageSize, buildPagination: buildNodesPagination } = usePagination(10);
  const tasksQuery = useSystemSchedulerTasks();
  const runsQuery = useSystemSchedulerRuns({
    page,
    pageSize,
    taskName: submittedRunSearch.taskName || undefined,
    taskType: submittedRunSearch.taskType || undefined,
    triggerType: submittedRunSearch.triggerType || undefined,
    status: submittedRunSearch.status || undefined,
    alertStatus: submittedRunSearch.alertStatus || undefined,
    startTime: submittedRunSearch.startTime || undefined,
    endTime: submittedRunSearch.endTime || undefined,
  }, activeTab === 'runs');
  const nodesQuery = useSystemSchedulerNodes({ page: nodesPage, pageSize: nodesPageSize }, activeTab === 'nodes');
  const detailQuery = useSystemSchedulerRunDetail(detailRun?.id, detailRun != null);
  const runTaskMutation = useRunSystemSchedulerTask();
  const saveConfigMutation = useSaveSystemSchedulerTaskConfig();
  const ackAlertMutation = useAcknowledgeSystemSchedulerAlert();
  const cleanupRunsMutation = useCleanupSystemSchedulerRuns();
  const tasks = tasksQuery.data ?? EMPTY_TASKS;
  const runs = runsQuery.data?.list ?? EMPTY_RUNS;
  const runsTotal = runsQuery.data?.total ?? 0;
  const nodes = nodesQuery.data?.list ?? EMPTY_NODES;
  const nodesTotal = nodesQuery.data?.total ?? 0;
  const runningTaskName = runTaskMutation.isPending ? runTaskMutation.variables : null;

  const canRun = hasPermission('system:scheduler:run');
  const canConfig = hasPermission('system:scheduler:config');
  const canCleanup = hasPermission('system:scheduler:cleanup');
  const canAckAlert = hasPermission('system:scheduler:alert');

  useEffect(() => {
    if (detailRun && detailQuery.data && detailRun !== detailQuery.data) setDetailRun(detailQuery.data);
  }, [detailQuery.data, detailRun]);

  const moduleOptions = useMemo(() => {
    const modules = Array.from(new Set(tasks.map((item) => item.module))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    return [{ value: '', label: '全部模块' }, ...modules.map((module) => ({ value: module, label: module }))];
  }, [tasks]);

  const taskOptions = useMemo(
    () => [{ value: '', label: '全部任务' }, ...tasks.map((item) => ({ value: item.name, label: item.title }))],
    [tasks],
  );

  const filteredTasks = useMemo(() => {
    const keyword = taskSearch.keyword.trim().toLowerCase();
    return tasks.filter((item) => {
      const matchedKeyword = !keyword
        || item.title.toLowerCase().includes(keyword)
        || item.name.toLowerCase().includes(keyword)
        || (item.description ?? '').toLowerCase().includes(keyword);
      const matchedModule = !taskSearch.module || item.module === taskSearch.module;
      const matchedType = !taskSearch.taskType || item.taskType === taskSearch.taskType;
      const matchedStatus = !taskSearch.status || item.lastRunStatus === taskSearch.status;
      return matchedKeyword && matchedModule && matchedType && matchedStatus;
    });
  }, [taskSearch, tasks]);

  const handleRunTask = (record: SystemSchedulerTask) => {
    Modal.confirm({
      title: '立即执行系统任务',
      content: `确定要投递「${record.title}」到后台执行吗？`,
      okText: '执行',
      onOk: async () => {
        const data = await runTaskMutation.mutateAsync(record.name);
        Toast.success(data.message || '任务已投递后台执行');
        setSubmittedRunSearch((prev) => ({ ...prev }));
        void queryClient.invalidateQueries({ queryKey: systemSchedulerKeys.all });
      },
    });
  };

  const openTaskRuns = (record: SystemSchedulerTask) => {
    const next = { ...defaultRunSearch, taskName: record.name };
    setDraftRunSearch(next);
    setSubmittedRunSearch(next);
    setPage(1);
    setActiveTab('runs');
    void queryClient.invalidateQueries({ queryKey: systemSchedulerKeys.runs });
  };

  const openTaskConfig = (record: SystemSchedulerTask) => {
    setConfigTask(record);
  };

  const handleSaveConfig = async (values: TaskConfigForm) => {
    if (!configTask) return;
    const alertEmails = values.alertEmailsText
      ? values.alertEmailsText.split(/[\n,;，；]/).map((item) => item.trim()).filter(Boolean)
      : [];
    await saveConfigMutation.mutateAsync({
      name: configTask.name,
      values: {
        enabled: configTask.taskType === 'queue' ? true : Boolean(values.enabled),
        logRetentionDays: Number(values.logRetentionDays),
        logRetentionRuns: Number(values.logRetentionRuns),
        timeoutMs: values.timeoutMs ? Number(values.timeoutMs) : null,
        failureAlertThreshold: Number(values.failureAlertThreshold),
        alertEnabled: Boolean(values.alertEnabled),
        alertChannels: values.alertChannels?.length ? values.alertChannels : ['inapp'],
        alertUserIds: values.alertUserIds ?? [],
        alertEmails,
        alertWebhookUrl: values.alertWebhookUrl?.trim() || null,
        manualSingleton: configTask.allowManualRun ? Boolean(values.manualSingleton) : false,
      },
    });
    Toast.success('策略已保存');
    setConfigTask(null);
  };

  const handleConfigModalOk = async () => {
    if (!configFormApi.current) return;
    let values: TaskConfigForm;
    try {
      values = await configFormApi.current.validate() as unknown as TaskConfigForm;
    } catch {
      throw new Error('validation');
    }
    await handleSaveConfig(values);
  };

  const openRunDetail = (record: SystemSchedulerRun) => {
    setDetailRun(record);
  };

  const handleAcknowledgeAlert = async (record = detailRun) => {
    if (!record?.alertMessage) return;
    Modal.confirm({
      title: '确认系统调度告警',
      content: `确认已处理运行日志 #${record.id} 的告警吗？`,
      okText: '确认',
      onOk: async () => {
        const data = await ackAlertMutation.mutateAsync({ id: record.id, note: null });
        Toast.success('告警已确认');
        setDetailRun(data);
      },
    });
  };

  const handleCleanupRuns = () => {
    Modal.confirm({
      title: '清理系统调度运行日志',
      content: submittedRunSearch.taskName ? '将按当前任务的留存策略清理运行日志。' : '将按所有任务的留存策略清理运行日志。',
      okText: '清理',
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        const data = await cleanupRunsMutation.mutateAsync(submittedRunSearch.taskName || undefined);
        Toast.success(data.message);
      },
    });
  };

  const taskColumns: ColumnProps<SystemSchedulerTask>[] = [
    {
      title: '任务',
      dataIndex: 'title',
      width: 280,
      fixed: 'left',
      render: (_: unknown, record) => (
        <Space vertical align="start" spacing={2}>
          <Typography.Text strong>{record.title}</Typography.Text>
          <Typography.Text type="tertiary" size="small">{record.name}</Typography.Text>
        </Space>
      ),
    },
    { title: '模块', dataIndex: 'module', width: 110 },
    {
      title: '类型',
      dataIndex: 'taskType',
      width: 120,
      render: (value: SystemSchedulerTaskType) => <Tag color={taskTypeMap[value].color}>{taskTypeMap[value].label}</Tag>,
    },
    {
      title: '调度',
      dataIndex: 'cronExpression',
      width: 170,
      render: (_: unknown, record) => record.taskType === 'recurring' ? <Typography.Text code>{record.cronExpression}</Typography.Text> : <Typography.Text type="tertiary">队列消费</Typography.Text>,
    },
    { title: '下次执行', dataIndex: 'nextRunAt', width: 210, render: (value: string | null) => value ?? '-' },
    { title: '最近状态', dataIndex: 'lastRunStatus', width: 120, render: statusTag },
    { title: '最近耗时', dataIndex: 'lastDurationMs', width: 120, render: formatDuration },
    {
      title: '队列',
      dataIndex: 'queueTotalCount',
      width: 230,
      render: (_: unknown, record) => renderQueue(record),
    },
    {
      title: '告警',
      dataIndex: 'lastAlertMessage',
      width: 300,
      render: (_: unknown, record) => record.lastAlertMessage
        ? (
          <Space vertical align="start" spacing={2}>
            <Tag color="red" prefixIcon={<AlertTriangle size={12} />}>{record.alertCount}</Tag>
            <Typography.Text size="small">{record.alertChannels.map((item) => alertChannelMap[item]).join(' / ') || '未配置渠道'}</Typography.Text>
            {renderEllipsis(record.lastAlertMessage)}
          </Space>
        )
        : (
          <Space vertical align="start" spacing={2}>
            <Typography.Text type="tertiary">无</Typography.Text>
            <Typography.Text type="tertiary" size="small">{record.alertEnabled ? record.alertChannels.map((item) => alertChannelMap[item]).join(' / ') : '未启用'}</Typography.Text>
          </Space>
        ),
    },
    {
      title: '留存策略',
      dataIndex: 'logRetentionDays',
      width: 150,
      render: (_: unknown, record) => `${record.logRetentionDays} 天 / ${record.logRetentionRuns} 条`,
    },
    {
      title: '阈值',
      dataIndex: 'timeoutMs',
      width: 160,
      render: (_: unknown, record) => (
        <Space vertical align="start" spacing={2}>
          <Typography.Text size="small">失败 {record.failureAlertThreshold} 次</Typography.Text>
          <Typography.Text type="tertiary" size="small">{record.timeoutMs ? formatDuration(record.timeoutMs) : '无超时阈值'}</Typography.Text>
        </Space>
      ),
    },
    { title: '注册节点', dataIndex: 'registeredHostname', width: 180, render: (_: unknown, record) => renderNode(record.registeredHostname, record.registeredPid) },
    {
      title: '运行次数',
      dataIndex: 'totalRuns',
      width: 130,
      render: (_: unknown, record) => `${record.totalRuns} / 失败 ${record.failedCount}`,
    },
    { title: '最近信息', dataIndex: 'lastRunMessage', width: 280, render: renderEllipsis },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 100,
      fixed: 'right',
      render: (_: unknown, record) => record.taskType === 'queue'
        ? <Tag color="cyan">Worker</Tag>
        : <Tag color={record.enabled ? 'green' : 'grey'}>{record.enabled ? '启用' : '停用'}</Tag>,
    },
    createOperationColumn<SystemSchedulerTask>({
      width: 220,
      desktopInlineKeys: ['run', 'logs', 'config'],
      actions: (record) => [
        {
          key: 'run',
          label: '执行',
          type: 'primary',
          loading: runningTaskName === record.name,
          disabled: record.taskType !== 'recurring' || !record.enabled || !record.allowManualRun || !canRun || record.running,
          disabledReason: record.taskType !== 'recurring'
            ? '队列 Worker 不支持手动执行'
            : !record.enabled
              ? '任务已停用'
              : !record.allowManualRun
                ? '该任务未开放手动执行'
                : record.running
                  ? '任务正在运行'
                  : '缺少执行权限',
          onClick: () => handleRunTask(record),
        },
        { key: 'logs', label: '日志', onClick: () => openTaskRuns(record) },
        {
          key: 'config',
          label: '策略',
          disabled: !canConfig,
          disabledReason: '缺少配置权限',
          onClick: () => openTaskConfig(record),
        },
      ],
    }),
  ];

  const runColumns: ColumnProps<SystemSchedulerRun>[] = [
    {
      title: '任务',
      dataIndex: 'taskTitle',
      width: 260,
      fixed: 'left',
      render: (_: unknown, record) => (
        <Space vertical align="start" spacing={2}>
          <Typography.Text strong>{record.taskTitle}</Typography.Text>
          <Typography.Text type="tertiary" size="small">{record.taskName}</Typography.Text>
        </Space>
      ),
    },
    { title: '模块', dataIndex: 'module', width: 110 },
    {
      title: '类型',
      dataIndex: 'taskType',
      width: 120,
      render: (value: SystemSchedulerTaskType) => <Tag color={taskTypeMap[value].color}>{taskTypeMap[value].label}</Tag>,
    },
    {
      title: '触发',
      dataIndex: 'triggerType',
      width: 120,
      render: (value: SystemSchedulerTriggerType) => <Tag color={triggerTypeMap[value].color}>{triggerTypeMap[value].label}</Tag>,
    },
    { title: '状态', dataIndex: 'status', width: 110, render: (value: SystemSchedulerRunStatus) => statusTag(value) },
    { title: '开始时间', dataIndex: 'startedAt', width: 210 },
    { title: '结束时间', dataIndex: 'endedAt', width: 210, render: (value: string | null) => value ?? '-' },
    { title: '耗时', dataIndex: 'durationMs', width: 110, render: formatDuration },
    { title: '执行节点', dataIndex: 'nodeHostname', width: 190, render: (_: unknown, record) => renderNode(record.nodeHostname, record.nodePid) },
    { title: 'Job ID', dataIndex: 'jobId', width: 220, render: renderEllipsis },
    {
      title: '告警',
      dataIndex: 'alertMessage',
      width: 270,
      render: (_: unknown, record) => record.alertMessage
        ? (
          <Space vertical align="start" spacing={2}>
            {renderEllipsis(record.alertMessage)}
            <Tag color={record.alertAckAt ? 'green' : 'red'}>{record.alertAckAt ? '已确认' : '未确认'}</Tag>
          </Space>
        )
        : <Typography.Text type="tertiary">无</Typography.Text>,
    },
    {
      title: '输出',
      dataIndex: 'resultMessage',
      width: 320,
      render: (_: unknown, record) => renderEllipsis(record.errorMessage ?? record.resultMessage),
    },
    createOperationColumn<SystemSchedulerRun>({
      width: 160,
      desktopInlineKeys: ['detail', 'ack'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => void openRunDetail(record) },
        {
          key: 'ack',
          label: '确认',
          type: 'primary',
          disabled: !record.alertMessage || !!record.alertAckAt || !canAckAlert,
          disabledReason: !record.alertMessage ? '无告警' : record.alertAckAt ? '已确认' : '缺少确认权限',
          onClick: () => void handleAcknowledgeAlert(record),
        },
      ],
    }),
  ];

  const nodeColumns: ColumnProps<SystemSchedulerNode>[] = [
    {
      title: '节点',
      dataIndex: 'nodeId',
      width: 260,
      fixed: 'left',
      render: (_: unknown, record) => (
        <Space vertical align="start" spacing={2}>
          <Typography.Text strong copyable={{ content: record.nodeId }}>{record.nodeId}</Typography.Text>
          <Typography.Text type="tertiary" size="small">{renderNode(record.hostname, record.pid)}</Typography.Text>
        </Space>
      ),
    },
    { title: '状态', dataIndex: 'active', width: 120, render: (_: unknown, record) => <Tag color={record.active && !record.stale ? 'green' : 'red'}>{record.active && !record.stale ? '在线' : '离线'}</Tag> },
    { title: '版本', dataIndex: 'version', width: 140, render: (value: string | null) => value ?? '-' },
    { title: '启动时间', dataIndex: 'startedAt', width: 210 },
    { title: '最近心跳', dataIndex: 'lastHeartbeatAt', width: 210 },
    { title: '注册任务', dataIndex: 'registeredTaskCount', width: 120 },
    { title: '运行任务', dataIndex: 'runningJobCount', width: 120 },
  ];

  const handleRunSearch = () => {
    setPage(1);
    setSubmittedRunSearch(draftRunSearch);
    void queryClient.invalidateQueries({ queryKey: systemSchedulerKeys.runs });
  };

  const handleRunReset = () => {
    setDraftRunSearch(defaultRunSearch);
    setSubmittedRunSearch(defaultRunSearch);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: systemSchedulerKeys.runs });
  };

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" activeKey={activeTab} onChange={(key) => setActiveTab(key as TabKey)} lazyRender>
        <TabPane tab="系统任务" itemKey="tasks">
          <SearchToolbar>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索任务名称/标识/说明"
              showClear
              value={taskSearch.keyword}
              onChange={(value) => setTaskSearch((prev) => ({ ...prev, keyword: value }))}
              style={{ width: 240 }}
            />
            <Select
              value={taskSearch.module}
              optionList={moduleOptions}
              onChange={(value) => setTaskSearch((prev) => ({ ...prev, module: String(value ?? '') }))}
              style={{ width: 140 }}
            />
            <Select
              value={taskSearch.taskType}
              optionList={[
                { value: '', label: '全部类型' },
                { value: 'recurring', label: '周期任务' },
                { value: 'queue', label: '队列 Worker' },
              ]}
              onChange={(value) => setTaskSearch((prev) => ({ ...prev, taskType: String(value ?? '') }))}
              style={{ width: 140 }}
            />
            <Select
              value={taskSearch.status}
              optionList={[
                { value: '', label: '全部状态' },
                { value: 'running', label: '运行中' },
                { value: 'success', label: '成功' },
                { value: 'failed', label: '失败' },
              ]}
              onChange={(value) => setTaskSearch((prev) => ({ ...prev, status: String(value ?? '') }))}
              style={{ width: 120 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={() => void queryClient.invalidateQueries({ queryKey: systemSchedulerKeys.tasks })}>查询</Button>
            <Button
              type="tertiary"
              icon={<RotateCcw size={14} />}
              onClick={() => {
                setTaskSearch(defaultTaskSearch);
                void queryClient.invalidateQueries({ queryKey: systemSchedulerKeys.tasks });
              }}
            >
              重置
            </Button>
            <Button icon={<RefreshCw size={14} />} onClick={() => void tasksQuery.refetch()} loading={tasksQuery.isFetching}>刷新</Button>
          </SearchToolbar>

          <ConfigurableTable
            bordered
            rowKey="name"
            columns={taskColumns}
            dataSource={filteredTasks}
            loading={tasksQuery.isFetching}
            pagination={false}
            scroll={{ x: 2760 }}
            columnSettingsKey="system-scheduler-tasks"
            onRefresh={() => void tasksQuery.refetch()}
            refreshLoading={tasksQuery.isFetching}
          />
        </TabPane>

        <TabPane tab="运行日志" itemKey="runs">
          <SearchToolbar>
            <Select
              value={draftRunSearch.taskName}
              optionList={taskOptions}
              filter
              onChange={(value) => setDraftRunSearch((prev) => ({ ...prev, taskName: String(value ?? '') }))}
              style={{ width: 220 }}
            />
            <Select
              value={draftRunSearch.taskType}
              optionList={[
                { value: '', label: '全部类型' },
                { value: 'recurring', label: '周期任务' },
                { value: 'queue', label: '队列 Worker' },
              ]}
              onChange={(value) => setDraftRunSearch((prev) => ({ ...prev, taskType: String(value ?? '') }))}
              style={{ width: 140 }}
            />
            <Select
              value={draftRunSearch.triggerType}
              optionList={[
                { value: '', label: '全部触发' },
                { value: 'schedule', label: '自动调度' },
                { value: 'manual', label: '手动执行' },
                { value: 'queue', label: '队列触发' },
              ]}
              onChange={(value) => setDraftRunSearch((prev) => ({ ...prev, triggerType: String(value ?? '') }))}
              style={{ width: 140 }}
            />
            <Select
              value={draftRunSearch.status}
              optionList={[
                { value: '', label: '全部状态' },
                { value: 'running', label: '运行中' },
                { value: 'success', label: '成功' },
                { value: 'failed', label: '失败' },
              ]}
              onChange={(value) => setDraftRunSearch((prev) => ({ ...prev, status: String(value ?? '') }))}
              style={{ width: 120 }}
            />
            <Select
              value={draftRunSearch.alertStatus}
              optionList={[
                { value: '', label: '全部告警' },
                { value: 'alerted', label: '有告警' },
                { value: 'unacked', label: '未确认' },
              ]}
              onChange={(value) => setDraftRunSearch((prev) => ({ ...prev, alertStatus: String(value ?? '') }))}
              style={{ width: 120 }}
            />
            <Input
              placeholder="开始时间"
              value={draftRunSearch.startTime}
              onChange={(value) => setDraftRunSearch((prev) => ({ ...prev, startTime: value }))}
              showClear
              style={{ width: 180 }}
            />
            <Input
              placeholder="结束时间"
              value={draftRunSearch.endTime}
              onChange={(value) => setDraftRunSearch((prev) => ({ ...prev, endTime: value }))}
              showClear
              style={{ width: 180 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleRunSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleRunReset}>重置</Button>
            <Button icon={<RefreshCw size={14} />} onClick={() => void runsQuery.refetch()} loading={runsQuery.isFetching}>刷新</Button>
            <Button
              type="danger"
              theme="light"
              icon={<Trash2 size={14} />}
              onClick={handleCleanupRuns}
              loading={cleanupRunsMutation.isPending}
              disabled={!canCleanup}
            >
              清理
            </Button>
          </SearchToolbar>

          <ConfigurableTable
            bordered
            rowKey="id"
            columns={runColumns}
            dataSource={runs}
            loading={runsQuery.isFetching}
            pagination={buildPagination(runsTotal)}
            scroll={{ x: 2220 }}
            columnSettingsKey="system-scheduler-runs"
            onRefresh={() => void runsQuery.refetch()}
            refreshLoading={runsQuery.isFetching}
          />
        </TabPane>

        <TabPane tab="执行节点" itemKey="nodes">
          <SearchToolbar>
            <Button type="primary" icon={<RefreshCw size={14} />} onClick={() => void nodesQuery.refetch()} loading={nodesQuery.isFetching}>刷新</Button>
          </SearchToolbar>

          <ConfigurableTable
            bordered
            rowKey="nodeId"
            columns={nodeColumns}
            dataSource={nodes}
            loading={nodesQuery.isFetching}
            pagination={buildNodesPagination(nodesTotal)}
            scroll={{ x: 1160 }}
            columnSettingsKey="system-scheduler-nodes"
            onRefresh={() => void nodesQuery.refetch()}
            refreshLoading={nodesQuery.isFetching}
          />
        </TabPane>
      </Tabs>

      <AppModal
        visible={!!configTask}
        title={configTask ? `调度策略 - ${configTask.title}` : '调度策略'}
        width={760}
        onCancel={() => {
          setConfigTask(null);
          configFormApi.current = null;
        }}
        onOk={handleConfigModalOk}
        confirmLoading={saveConfigMutation.isPending}
        okText="保存"
        cancelText="取消"
      >
        {configTask && (
          <Form<TaskConfigForm>
            key={configTask.name}
            getFormApi={(api) => { configFormApi.current = api; }}
            labelPosition="left"
            labelWidth={130}
            initValues={{
              enabled: configTask.enabled,
              logRetentionDays: configTask.logRetentionDays,
              logRetentionRuns: configTask.logRetentionRuns,
              timeoutMs: configTask.timeoutMs,
              failureAlertThreshold: configTask.failureAlertThreshold,
              alertEnabled: configTask.alertEnabled,
              alertChannels: configTask.alertChannels?.length ? configTask.alertChannels : ['inapp'],
              alertUserIds: configTask.alertUserIds ?? [],
              alertEmailsText: (configTask.alertEmails ?? []).join('\n'),
              alertWebhookUrl: configTask.alertWebhookUrl,
              manualSingleton: configTask.manualSingleton,
            }}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Switch field="enabled" label="启用任务" disabled={configTask.taskType === 'queue'} />
              </Col>
              <Col span={12}>
                <Form.Switch field="alertEnabled" label="启用告警" />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.InputNumber field="logRetentionDays" label="留存天数" min={1} max={3650} style={{ width: '100%' }} rules={[{ required: true, message: '请输入留存天数' }]} />
              </Col>
              <Col span={12}>
                <Form.InputNumber field="logRetentionRuns" label="每任务保留条数" min={1} max={100000} style={{ width: '100%' }} rules={[{ required: true, message: '请输入保留条数' }]} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.InputNumber field="timeoutMs" label="超时告警毫秒" min={100} max={86400000} style={{ width: '100%' }} placeholder="为空表示不启用" />
              </Col>
              <Col span={12}>
                <Form.InputNumber field="failureAlertThreshold" label="连续失败阈值" min={1} max={100} style={{ width: '100%' }} rules={[{ required: true, message: '请输入失败阈值' }]} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select
                  field="alertChannels"
                  label="告警渠道"
                  multiple
                  optionList={[
                    { value: 'inapp', label: '系统号卡片' },
                    { value: 'email', label: '邮件' },
                    { value: 'webhook', label: 'Webhook' },
                  ]}
                  style={{ width: '100%' }}
                />
              </Col>
              <Col span={12}>
                <Form.Switch field="manualSingleton" label="手动执行防重" disabled={!configTask.allowManualRun} />
              </Col>
            </Row>
            <FormUserSelect field="alertUserIds" label="通知用户" multiple />
            <Form.TextArea field="alertEmailsText" label="通知邮箱" placeholder="多个邮箱可用换行或逗号分隔" autosize={{ minRows: 2, maxRows: 4 }} />
            <Form.Input field="alertWebhookUrl" label="Webhook URL" placeholder="https://example.com/webhook" />
          </Form>
        )}
      </AppModal>

      <AppModal
        visible={!!detailRun}
        title={detailRun ? `运行日志 #${detailRun.id}` : '运行日志详情'}
        width={760}
        onCancel={() => setDetailRun(null)}
        footer={detailRun?.alertMessage && !detailRun.alertAckAt ? (
          <Space>
            <Button onClick={() => setDetailRun(null)}>关闭</Button>
            <Button type="primary" icon={<CheckCircle2 size={14} />} loading={ackAlertMutation.isPending} disabled={!canAckAlert} onClick={() => void handleAcknowledgeAlert()}>
              确认告警
            </Button>
          </Space>
        ) : (
          <Button onClick={() => setDetailRun(null)}>关闭</Button>
        )}
      >
        {detailRun && (
          <Space vertical style={{ width: '100%' }}>
            <Descriptions
              row
              size="small"
              data={[
                { key: '任务', value: `${detailRun.taskTitle} (${detailRun.taskName})` },
                { key: '模块', value: detailRun.module },
                { key: '类型', value: taskTypeMap[detailRun.taskType].label },
                { key: '触发', value: triggerTypeMap[detailRun.triggerType].label },
                { key: '状态', value: statusTag(detailRun.status) },
                { key: 'Job ID', value: detailRun.jobId ? <Typography.Text copyable={{ content: detailRun.jobId }}>{detailRun.jobId}</Typography.Text> : '-' },
                { key: '执行节点', value: renderNode(detailRun.nodeHostname, detailRun.nodePid) },
                { key: '开始时间', value: detailRun.startedAt },
                { key: '结束时间', value: detailRun.endedAt ?? '-' },
                { key: '耗时', value: formatDuration(detailRun.durationMs) },
                { key: '告警时间', value: detailRun.alertedAt ?? '-' },
                { key: '确认状态', value: detailRun.alertMessage ? (detailRun.alertAckAt ? `已确认：${detailRun.alertAckByName ?? detailRun.alertAckBy ?? '-'}` : '未确认') : '无告警' },
              ]}
            />
            {detailRun.alertMessage && (
              <div>
                <Typography.Title heading={6}>告警信息</Typography.Title>
                <Typography.Paragraph copyable={{ content: detailRun.alertMessage }} style={{ whiteSpace: 'pre-wrap' }}>{detailRun.alertMessage}</Typography.Paragraph>
              </div>
            )}
            {(detailRun.errorMessage || detailRun.resultMessage) && (
              <div>
                <Typography.Title heading={6}>{detailRun.errorMessage ? '错误信息' : '执行输出'}</Typography.Title>
                <Typography.Paragraph copyable={{ content: detailRun.errorMessage ?? detailRun.resultMessage ?? '' }} style={{ whiteSpace: 'pre-wrap' }}>
                  {detailRun.errorMessage ?? detailRun.resultMessage}
                </Typography.Paragraph>
              </div>
            )}
            {detailQuery.isFetching && <Typography.Text type="tertiary">正在刷新详情...</Typography.Text>}
          </Space>
        )}
      </AppModal>
    </div>
  );
}
