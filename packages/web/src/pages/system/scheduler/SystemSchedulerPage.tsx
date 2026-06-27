import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, TabPane, Tabs, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { AlertTriangle, RefreshCw, RotateCcw, Search, Settings, Trash2 } from 'lucide-react';
import type {
  PaginatedResponse,
  SystemSchedulerRun,
  SystemSchedulerRunStatus,
  SystemSchedulerTask,
  SystemSchedulerTaskType,
  SystemSchedulerTriggerType,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { renderEllipsis } from '@/utils/table-columns';

type TabKey = 'tasks' | 'runs';

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
  startTime: string;
  endTime: string;
}

interface TaskConfigForm {
  logRetentionDays: number;
  logRetentionRuns: number;
  timeoutMs: number | null;
  failureAlertThreshold: number;
  alertEnabled: boolean;
  manualSingleton: boolean;
}

interface CleanupResult {
  message: string;
  deletedByAge: number;
  deletedByCount: number;
  totalBefore: number;
  totalAfter: number;
}

const defaultTaskSearch: TaskSearchParams = { keyword: '', module: '', taskType: '', status: '' };
const defaultRunSearch: RunSearchParams = { taskName: '', taskType: '', triggerType: '', status: '', startTime: '', endTime: '' };

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
  const { hasPermission } = usePermission();
  const [activeTab, setActiveTab] = useState<TabKey>('tasks');
  const [tasks, setTasks] = useState<SystemSchedulerTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskSearch, setTaskSearch] = useState<TaskSearchParams>(defaultTaskSearch);
  const [runs, setRuns] = useState<SystemSchedulerRun[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runSearch, setRunSearch] = useState<RunSearchParams>(defaultRunSearch);
  const [runningTaskName, setRunningTaskName] = useState<string | null>(null);
  const [configTask, setConfigTask] = useState<SystemSchedulerTask | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const { page, pageSize, setPage, buildPagination } = usePagination(20);

  const canRun = hasPermission('system:scheduler:run');
  const canConfig = hasPermission('system:scheduler:config');
  const canCleanup = hasPermission('system:scheduler:cleanup');

  const fetchTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const res = await request.get<SystemSchedulerTask[]>('/api/system-scheduler/tasks');
      if (res.code === 0) setTasks(res.data);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const fetchRuns = useCallback(async (p = page, ps = pageSize, params = runSearch) => {
    setRunsLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.taskName ? { taskName: params.taskName } : {}),
        ...(params.taskType ? { taskType: params.taskType } : {}),
        ...(params.triggerType ? { triggerType: params.triggerType } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.startTime ? { startTime: params.startTime } : {}),
        ...(params.endTime ? { endTime: params.endTime } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<SystemSchedulerRun>>(`/api/system-scheduler/runs?${query}`);
      if (res.code === 0) {
        setRuns(res.data.list);
        setRunsTotal(res.data.total);
      }
    } finally {
      setRunsLoading(false);
    }
  }, [page, pageSize, runSearch]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (activeTab === 'runs') void fetchRuns();
  }, [activeTab, fetchRuns]);

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
        setRunningTaskName(record.name);
        try {
          const res = await request.post<{ message: string; runId?: number; jobId?: string | null }>(`/api/system-scheduler/tasks/${encodeURIComponent(record.name)}/run`);
          if (res.code === 0) {
            Toast.success(res.data.message || '任务已投递后台执行');
            await Promise.all([fetchTasks(), fetchRuns(1, pageSize)]);
          }
        } finally {
          setRunningTaskName(null);
        }
      },
    });
  };

  const openTaskRuns = (record: SystemSchedulerTask) => {
    const next = { ...defaultRunSearch, taskName: record.name };
    setRunSearch(next);
    setPage(1);
    setActiveTab('runs');
    void fetchRuns(1, pageSize, next);
  };

  const openTaskConfig = (record: SystemSchedulerTask) => {
    setConfigTask(record);
  };

  const handleSaveConfig = async (values: TaskConfigForm) => {
    if (!configTask) return;
    setSavingConfig(true);
    try {
      const res = await request.put(`/api/system-scheduler/tasks/${encodeURIComponent(configTask.name)}/config`, {
        logRetentionDays: Number(values.logRetentionDays),
        logRetentionRuns: Number(values.logRetentionRuns),
        timeoutMs: values.timeoutMs ? Number(values.timeoutMs) : null,
        failureAlertThreshold: Number(values.failureAlertThreshold),
        alertEnabled: Boolean(values.alertEnabled),
        manualSingleton: Boolean(values.manualSingleton),
      });
      if (res.code === 0) {
        Toast.success('策略已保存');
        setConfigTask(null);
        await fetchTasks();
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const handleCleanupRuns = () => {
    Modal.confirm({
      title: '清理系统调度运行日志',
      content: runSearch.taskName ? '将按当前任务的留存策略清理运行日志。' : '将按所有任务的留存策略清理运行日志。',
      okText: '清理',
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        setCleanupLoading(true);
        try {
          const query = runSearch.taskName ? `?taskName=${encodeURIComponent(runSearch.taskName)}` : '';
          const res = await request.post<CleanupResult>(`/api/system-scheduler/runs/cleanup${query}`);
          if (res.code === 0) {
            Toast.success(res.data.message);
            await Promise.all([fetchTasks(), fetchRuns(1, pageSize)]);
          }
        } finally {
          setCleanupLoading(false);
        }
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
      width: 260,
      render: (_: unknown, record) => record.lastAlertMessage
        ? (
          <Space spacing={4}>
            <Tag color="red" prefixIcon={<AlertTriangle size={12} />}>{record.alertCount}</Tag>
            {renderEllipsis(record.lastAlertMessage)}
          </Space>
        )
        : <Typography.Text type="tertiary">无</Typography.Text>,
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
    createOperationColumn<SystemSchedulerTask>({
      width: 220,
      desktopInlineKeys: ['run', 'logs', 'config'],
      actions: (record) => [
        {
          key: 'run',
          label: '执行',
          type: 'primary',
          loading: runningTaskName === record.name,
          disabled: record.taskType !== 'recurring' || !record.allowManualRun || !canRun || record.running,
          disabledReason: record.taskType !== 'recurring'
            ? '队列 Worker 不支持手动执行'
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
          icon: <Settings size={14} />,
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
      width: 240,
      render: (value: string | null) => value ? renderEllipsis(value) : <Typography.Text type="tertiary">无</Typography.Text>,
    },
    {
      title: '输出',
      dataIndex: 'resultMessage',
      width: 320,
      render: (_: unknown, record) => renderEllipsis(record.errorMessage ?? record.resultMessage),
    },
  ];

  const handleRunSearch = () => {
    setPage(1);
    void fetchRuns(1, pageSize);
  };

  const handleRunReset = () => {
    setRunSearch(defaultRunSearch);
    setPage(1);
    void fetchRuns(1, pageSize, defaultRunSearch);
  };

  return (
    <>
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
            <Button type="primary" icon={<Search size={14} />} onClick={fetchTasks}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => setTaskSearch(defaultTaskSearch)}>重置</Button>
            <Button icon={<RefreshCw size={14} />} onClick={fetchTasks} loading={tasksLoading}>刷新</Button>
          </SearchToolbar>

          <ConfigurableTable
            bordered
            rowKey="name"
            columns={taskColumns}
            dataSource={filteredTasks}
            loading={tasksLoading}
            pagination={false}
            scroll={{ x: 2760 }}
            columnSettingsKey="system-scheduler-tasks"
            onRefresh={fetchTasks}
            refreshLoading={tasksLoading}
          />
        </TabPane>

        <TabPane tab="运行日志" itemKey="runs">
          <SearchToolbar>
            <Select
              value={runSearch.taskName}
              optionList={taskOptions}
              filter
              onChange={(value) => setRunSearch((prev) => ({ ...prev, taskName: String(value ?? '') }))}
              style={{ width: 220 }}
            />
            <Select
              value={runSearch.taskType}
              optionList={[
                { value: '', label: '全部类型' },
                { value: 'recurring', label: '周期任务' },
                { value: 'queue', label: '队列 Worker' },
              ]}
              onChange={(value) => setRunSearch((prev) => ({ ...prev, taskType: String(value ?? '') }))}
              style={{ width: 140 }}
            />
            <Select
              value={runSearch.triggerType}
              optionList={[
                { value: '', label: '全部触发' },
                { value: 'schedule', label: '自动调度' },
                { value: 'manual', label: '手动执行' },
                { value: 'queue', label: '队列触发' },
              ]}
              onChange={(value) => setRunSearch((prev) => ({ ...prev, triggerType: String(value ?? '') }))}
              style={{ width: 140 }}
            />
            <Select
              value={runSearch.status}
              optionList={[
                { value: '', label: '全部状态' },
                { value: 'running', label: '运行中' },
                { value: 'success', label: '成功' },
                { value: 'failed', label: '失败' },
              ]}
              onChange={(value) => setRunSearch((prev) => ({ ...prev, status: String(value ?? '') }))}
              style={{ width: 120 }}
            />
            <Input
              placeholder="开始时间"
              value={runSearch.startTime}
              onChange={(value) => setRunSearch((prev) => ({ ...prev, startTime: value }))}
              showClear
              style={{ width: 180 }}
            />
            <Input
              placeholder="结束时间"
              value={runSearch.endTime}
              onChange={(value) => setRunSearch((prev) => ({ ...prev, endTime: value }))}
              showClear
              style={{ width: 180 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleRunSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleRunReset}>重置</Button>
            <Button icon={<RefreshCw size={14} />} onClick={() => fetchRuns()} loading={runsLoading}>刷新</Button>
            <Button
              type="danger"
              theme="light"
              icon={<Trash2 size={14} />}
              onClick={handleCleanupRuns}
              loading={cleanupLoading}
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
            loading={runsLoading}
            pagination={buildPagination(runsTotal, fetchRuns)}
            scroll={{ x: 2220 }}
            columnSettingsKey="system-scheduler-runs"
            onRefresh={() => fetchRuns()}
            refreshLoading={runsLoading}
          />
        </TabPane>
      </Tabs>

      <AppModal
        visible={!!configTask}
        title={configTask ? `调度策略 - ${configTask.title}` : '调度策略'}
        width={560}
        onCancel={() => setConfigTask(null)}
        footer={null}
        fullscreenable={false}
      >
        {configTask && (
          <Form<TaskConfigForm>
            labelPosition="left"
            labelWidth={130}
            initValues={{
              logRetentionDays: configTask.logRetentionDays,
              logRetentionRuns: configTask.logRetentionRuns,
              timeoutMs: configTask.timeoutMs,
              failureAlertThreshold: configTask.failureAlertThreshold,
              alertEnabled: configTask.alertEnabled,
              manualSingleton: configTask.manualSingleton,
            }}
            onSubmit={(values) => { void handleSaveConfig(values); }}
          >
            <Form.InputNumber field="logRetentionDays" label="留存天数" min={1} max={3650} style={{ width: '100%' }} rules={[{ required: true, message: '请输入留存天数' }]} />
            <Form.InputNumber field="logRetentionRuns" label="每任务保留条数" min={1} max={100000} style={{ width: '100%' }} rules={[{ required: true, message: '请输入保留条数' }]} />
            <Form.InputNumber field="timeoutMs" label="超时告警毫秒" min={100} max={86400000} style={{ width: '100%' }} placeholder="为空表示不启用" />
            <Form.InputNumber field="failureAlertThreshold" label="连续失败阈值" min={1} max={100} style={{ width: '100%' }} rules={[{ required: true, message: '请输入失败阈值' }]} />
            <Form.Switch field="alertEnabled" label="启用告警" />
            <Form.Switch field="manualSingleton" label="手动执行防重" disabled={!configTask.allowManualRun} />
            <Space style={{ width: '100%', justifyContent: 'flex-end', marginTop: 12 }}>
              <Button onClick={() => setConfigTask(null)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={savingConfig}>保存</Button>
            </Space>
          </Form>
        )}
      </AppModal>
    </>
  );
}
