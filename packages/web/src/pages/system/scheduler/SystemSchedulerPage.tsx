import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Select, Space, TabPane, Tabs, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RefreshCw, RotateCcw, Search } from 'lucide-react';
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
}

const defaultTaskSearch: TaskSearchParams = { keyword: '', module: '', taskType: '', status: '' };
const defaultRunSearch: RunSearchParams = { taskName: '', taskType: '', triggerType: '', status: '' };

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
  const { page, pageSize, setPage, buildPagination } = usePagination(20);

  const canRun = hasPermission('system:scheduler:run');

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
      content: `确定要立即执行「${record.title}」吗？`,
      okText: '执行',
      onOk: async () => {
        setRunningTaskName(record.name);
        try {
          const res = await request.post<{ message: string }>(`/api/system-scheduler/tasks/${encodeURIComponent(record.name)}/run`);
          if (res.code === 0) {
            Toast.success(res.data.message || '执行完成');
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

  const taskColumns: ColumnProps<SystemSchedulerTask>[] = [
    {
      title: '任务',
      dataIndex: 'title',
      width: 260,
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
      width: 110,
      render: (value: SystemSchedulerTaskType) => <Tag color={taskTypeMap[value].color}>{taskTypeMap[value].label}</Tag>,
    },
    {
      title: '调度',
      dataIndex: 'cronExpression',
      width: 170,
      render: (_: unknown, record) => record.taskType === 'recurring' ? <Typography.Text code>{record.cronExpression}</Typography.Text> : <Typography.Text type="tertiary">队列消费</Typography.Text>,
    },
    { title: '下次执行', dataIndex: 'nextRunAt', width: 200, render: (value: string | null) => value ?? '-' },
    { title: '最近状态', dataIndex: 'lastRunStatus', width: 110, render: statusTag },
    { title: '最近耗时', dataIndex: 'lastDurationMs', width: 100, render: formatDuration },
    {
      title: '运行次数',
      dataIndex: 'totalRuns',
      width: 110,
      render: (_: unknown, record) => `${record.totalRuns} / ${record.failedCount}`,
    },
    { title: '最近信息', dataIndex: 'lastRunMessage', width: 240, render: renderEllipsis },
    createOperationColumn<SystemSchedulerTask>({
      width: 180,
      desktopInlineKeys: ['run', 'logs'],
      actions: (record) => [
        {
          key: 'run',
          label: '执行',
          type: 'primary',
          loading: runningTaskName === record.name,
          disabled: !record.allowManualRun || !canRun,
          disabledReason: !record.allowManualRun ? '该任务未开放手动执行' : '缺少执行权限',
          hidden: record.taskType !== 'recurring',
          onClick: () => handleRunTask(record),
        },
        { key: 'logs', label: '日志', onClick: () => openTaskRuns(record) },
      ],
    }),
  ];

  const runColumns: ColumnProps<SystemSchedulerRun>[] = [
    {
      title: '任务',
      dataIndex: 'taskTitle',
      width: 240,
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
      width: 110,
      render: (value: SystemSchedulerTaskType) => <Tag color={taskTypeMap[value].color}>{taskTypeMap[value].label}</Tag>,
    },
    {
      title: '触发',
      dataIndex: 'triggerType',
      width: 110,
      render: (value: SystemSchedulerTriggerType) => <Tag color={triggerTypeMap[value].color}>{triggerTypeMap[value].label}</Tag>,
    },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: SystemSchedulerRunStatus) => statusTag(value) },
    { title: '开始时间', dataIndex: 'startedAt', width: 200 },
    { title: '结束时间', dataIndex: 'endedAt', width: 200, render: (value: string | null) => value ?? '-' },
    { title: '耗时', dataIndex: 'durationMs', width: 100, render: formatDuration },
    {
      title: '输出',
      dataIndex: 'resultMessage',
      width: 300,
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
            <Button
              type="tertiary"
              icon={<RotateCcw size={14} />}
              onClick={() => setTaskSearch(defaultTaskSearch)}
            >
              重置
            </Button>
            <Button icon={<RefreshCw size={14} />} onClick={fetchTasks} loading={tasksLoading}>刷新</Button>
          </SearchToolbar>

          <ConfigurableTable
            bordered
            rowKey="name"
            columns={taskColumns}
            dataSource={filteredTasks}
            loading={tasksLoading}
            pagination={false}
            scroll={{ x: 1580 }}
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
            <Button type="primary" icon={<Search size={14} />} onClick={handleRunSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleRunReset}>重置</Button>
            <Button icon={<RefreshCw size={14} />} onClick={() => fetchRuns()} loading={runsLoading}>刷新</Button>
          </SearchToolbar>

          <ConfigurableTable
            bordered
            rowKey="id"
            columns={runColumns}
            dataSource={runs}
            loading={runsLoading}
            pagination={buildPagination(runsTotal, fetchRuns)}
            scroll={{ x: 1470 }}
            columnSettingsKey="system-scheduler-runs"
            onRefresh={() => fetchRuns()}
            refreshLoading={runsLoading}
          />
        </TabPane>
      </Tabs>
    </>
  );
}
