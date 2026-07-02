import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Descriptions, InputNumber, Modal, Select, SideSheet, Switch, TabPane, Tabs, Tag, Toast, Typography, Input } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Eraser, RefreshCw, RotateCcw, Search, Trash2, XCircle } from 'lucide-react';
import type { AsyncTask, AsyncTaskItem, AsyncTaskItemStatus, AsyncTaskStats, AsyncTaskStatus, AsyncTaskTypeMeta, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import AppModal from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useTaskProgressEvents } from '@/hooks/useAsyncTasks';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';

type TabKey = 'tasks' | 'types';

interface SearchParams {
  taskType: string;
  status: string;
  keyword: string;
  createdBy: string;
}

const defaultSearchParams: SearchParams = { taskType: '', status: '', keyword: '', createdBy: '' };

const statusOptions: Array<{ value: AsyncTaskStatus | ''; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '排队中' },
  { value: 'running', label: '执行中' },
  { value: 'success', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
];

const statusTagMap = {
  pending: { color: 'blue', label: '排队中' },
  running: { color: 'cyan', label: '执行中' },
  success: { color: 'green', label: '已完成' },
  failed: { color: 'red', label: '失败' },
  cancelled: { color: 'grey', label: '已取消' },
} as const satisfies Record<AsyncTaskStatus, { color: 'blue' | 'cyan' | 'green' | 'red' | 'grey'; label: string }>;

const itemStatusTagMap = {
  pending: { color: 'blue', label: '待处理' },
  success: { color: 'green', label: '成功' },
  failed: { color: 'red', label: '失败' },
  skipped: { color: 'grey', label: '跳过' },
} as const satisfies Record<AsyncTaskItemStatus, { color: 'blue' | 'green' | 'red' | 'grey'; label: string }>;

const itemStatusOptions: Array<{ value: AsyncTaskItemStatus | ''; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'skipped', label: '跳过' },
  { value: 'pending', label: '待处理' },
];

const AUTO_REFRESH_MS = 5000;

function renderJson(value: Record<string, unknown> | null) {
  if (!value || Object.keys(value).length === 0) return <Typography.Text type="tertiary">-</Typography.Text>;
  return (
    <pre style={{
      background: 'var(--semi-color-fill-0)', borderRadius: 6, padding: 12, margin: 0,
      overflowX: 'auto', fontSize: 12, lineHeight: 1.6,
      fontFamily: 'var(--semi-font-family-mono, ui-monospace, monospace)',
    }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

/** 统计卡片行 */
function StatsCards({ stats }: { stats: AsyncTaskStats | null }) {
  const items = [
    { label: '总任务', value: stats?.total ?? '-', color: 'var(--semi-color-text-0)' },
    { label: '进行中', value: stats ? stats.pending + stats.running : '-', color: 'var(--semi-color-info)' },
    { label: '已完成', value: stats?.success ?? '-', color: 'var(--semi-color-success)' },
    { label: '失败', value: stats?.failed ?? '-', color: 'var(--semi-color-danger)' },
    { label: '近24h平均耗时', value: stats ? formatDuration(stats.avgDurationMs) : '-', color: 'var(--semi-color-text-0)' },
  ];
  const maxDaily = Math.max(1, ...(stats?.daily.map((d) => d.submitted) ?? [1]));
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
      {items.map((item) => (
        <div key={item.label} style={{
          flex: '1 1 140px', minWidth: 140, padding: '10px 16px', borderRadius: 8,
          background: 'var(--semi-color-fill-0)', border: '1px solid var(--semi-color-border)',
        }}>
          <Typography.Text type="tertiary" size="small">{item.label}</Typography.Text>
          <div style={{ fontSize: 20, fontWeight: 600, color: item.color, lineHeight: 1.5 }}>{item.value}</div>
        </div>
      ))}
      <div style={{
        flex: '2 1 260px', minWidth: 260, padding: '10px 16px', borderRadius: 8,
        background: 'var(--semi-color-fill-0)', border: '1px solid var(--semi-color-border)',
      }}>
        <Typography.Text type="tertiary" size="small">近 7 天提交趋势（红色为失败）</Typography.Text>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 34, marginTop: 4 }}>
          {(stats?.daily ?? []).map((day) => (
            <div key={day.date} title={`${day.date}：提交 ${day.submitted}，失败 ${day.failed}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 1 }}>
              <div style={{ height: `${Math.max((day.failed / maxDaily) * 100, day.failed > 0 ? 8 : 0)}%`, background: 'var(--semi-color-danger)', borderRadius: 2 }} />
              <div style={{ height: `${Math.max(((day.submitted - day.failed) / maxDaily) * 100, day.submitted - day.failed > 0 ? 8 : 2)}%`, background: 'var(--semi-color-primary)', borderRadius: 2, opacity: 0.75 }} />
            </div>
          ))}
          {(!stats || stats.daily.length === 0) && <Typography.Text type="tertiary" size="small">暂无数据</Typography.Text>}
        </div>
      </div>
    </div>
  );
}

export default function TaskCenterPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:async-task:manage');
  const canCleanup = hasPermission('system:async-task:cleanup');
  const canConfig = hasPermission('system:async-task:config');

  const [activeTab, setActiveTab] = useState<TabKey>('tasks');
  const [types, setTypes] = useState<AsyncTaskTypeMeta[]>([]);
  const [typesLoading, setTypesLoading] = useState(false);
  const [data, setData] = useState<AsyncTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<AsyncTaskStats | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [detailTask, setDetailTask] = useState<AsyncTask | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const { page, pageSize, setPage, buildPagination } = usePagination();

  // 详情抽屉：任务项明细
  const [items, setItems] = useState<AsyncTaskItem[]>([]);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemStatusFilter, setItemStatusFilter] = useState('');
  const { pageSize: itemsPageSize, setPage: setItemsPage, buildPagination: buildItemsPagination } = usePagination(10);

  // 类型策略弹窗
  const [configType, setConfigType] = useState<AsyncTaskTypeMeta | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [configDraft, setConfigDraft] = useState({ enabled: true, allowConcurrent: true, maxAttempts: 1, retryDelayMs: 5000, retentionDays: null as number | null });

  const typeOptions = useMemo(
    () => [
      { value: '', label: '全部类型' },
      ...types.map((item) => ({ value: item.taskType, label: `${item.module} · ${item.title}` })),
    ],
    [types],
  );

  const fetchTypes = useCallback(async (opts?: { withLoading?: boolean }) => {
    if (opts?.withLoading) setTypesLoading(true);
    try {
      const res = await request.get<AsyncTaskTypeMeta[]>('/api/async-tasks/types', { silent: true });
      if (res.code === 0) setTypes(res.data);
    } finally {
      if (opts?.withLoading) setTypesLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    const res = await request.get<AsyncTaskStats>('/api/async-tasks/stats', { silent: true });
    if (res.code === 0) setStats(res.data);
  }, []);

  const fetchData = useCallback(async (p = page, ps = pageSize, params?: SearchParams, opts?: { silent?: boolean }) => {
    const activeParams = params ?? searchParamsRef.current;
    if (!opts?.silent) setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(activeParams.taskType ? { taskType: activeParams.taskType } : {}),
        ...(activeParams.status ? { status: activeParams.status } : {}),
        ...(activeParams.keyword ? { keyword: activeParams.keyword } : {}),
        ...(activeParams.createdBy ? { createdBy: activeParams.createdBy } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<AsyncTask>>(`/api/async-tasks?${query}`, { silent: opts?.silent });
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
        setSelectedRowKeys((prev) => prev.filter((id) => res.data.list.some((item) => item.id === id)));
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [page, pageSize]);

  const fetchItems = useCallback(async (taskId: number, p = 1, ps = itemsPageSize, status = itemStatusFilter) => {
    setItemsLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(status ? { status } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<AsyncTaskItem>>(`/api/async-tasks/${taskId}/items?${query}`, { silent: true });
      if (res.code === 0) {
        setItems(res.data.list);
        setItemsTotal(res.data.total);
      }
    } finally {
      setItemsLoading(false);
    }
  }, [itemsPageSize, itemStatusFilter]);

  useEffect(() => {
    void fetchTypes();
    void fetchStats();
  }, [fetchTypes, fetchStats]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // 自动刷新（5s），保证看到其他用户任务的进度推进
  useEffect(() => {
    if (!autoRefresh || activeTab !== 'tasks') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchData(undefined, undefined, undefined, { silent: true });
        void fetchStats();
      }
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, activeTab, fetchData, fetchStats]);

  // 自己提交的任务走 WS 实时合并（其他用户任务靠自动刷新兜底）
  useTaskProgressEvents(
    useCallback((task: AsyncTask) => {
      setData((prev) => prev.map((item) => (item.id === task.id ? task : item)));
      setDetailTask((prev) => (prev && prev.id === task.id ? task : prev));
    }, []),
  );

  const handleSearch = () => {
    setPage(1);
    void fetchData(1);
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchData(1, pageSize, defaultSearchParams);
  };

  const runAction = async (record: AsyncTask, action: 'cancel' | 'resume' | 'restart', successMsg: string) => {
    setActionLoadingId(record.id);
    try {
      const res = await request.post<AsyncTask>(`/api/async-tasks/${record.id}/${action}`);
      if (res.code === 0) {
        Toast.success(successMsg);
        void fetchData();
        void fetchStats();
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDelete = (record: AsyncTask) => {
    Modal.confirm({
      title: '删除任务记录',
      content: `将删除任务 #${record.id}「${record.title}」的记录（含任务项明细），不可恢复。`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete<null>(`/api/async-tasks/${record.id}`);
        if (res.code === 0) {
          Toast.success('已删除');
          setSelectedRowKeys((prev) => prev.filter((id) => id !== record.id));
          void fetchData();
          void fetchStats();
        }
      },
    });
  };

  const handleBatchCancel = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: '批量取消任务',
      content: `将对选中的 ${selectedRowKeys.length} 个任务发起取消（已结束的任务自动跳过）。`,
      onOk: async () => {
        setBatchLoading(true);
        try {
          const res = await request.post<{ affected: number }>('/api/async-tasks/batch-cancel', { ids: selectedRowKeys });
          if (res.code === 0) {
            Toast.success(`已请求取消 ${res.data.affected} 个任务`);
            setSelectedRowKeys([]);
            void fetchData();
            void fetchStats();
          }
        } finally {
          setBatchLoading(false);
        }
      },
    });
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: '批量删除任务记录',
      content: `将删除选中任务中已结束的记录（进行中的自动跳过），不可恢复。`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        setBatchLoading(true);
        try {
          const res = await request.post<{ affected: number }>('/api/async-tasks/batch-delete', { ids: selectedRowKeys });
          if (res.code === 0) {
            Toast.success(`已删除 ${res.data.affected} 个任务记录`);
            setSelectedRowKeys([]);
            void fetchData();
            void fetchStats();
          }
        } finally {
          setBatchLoading(false);
        }
      },
    });
  };

  const handleCleanup = () => {
    Modal.confirm({
      title: '清理已结束任务',
      content: '将按保留策略删除过期的已结束任务记录（默认 30 天，任务类型可单独配置）。',
      onOk: async () => {
        setCleaning(true);
        try {
          const res = await request.post<{ cleaned: number }>('/api/async-tasks/cleanup');
          if (res.code === 0) {
            Toast.success(`已清理 ${res.data.cleaned} 条任务记录`);
            void fetchData();
            void fetchStats();
          }
        } finally {
          setCleaning(false);
        }
      },
    });
  };

  const handleShowError = (record: AsyncTask) => {
    Modal.error({
      title: `任务失败 #${record.id}`,
      content: (
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
          {record.errorMessage ?? '未返回失败原因'}
        </Typography.Paragraph>
      ),
      okText: '知道了',
    });
  };

  const openDetail = (record: AsyncTask) => {
    setDetailTask(record);
    setItemStatusFilter('');
    setItemsPage(1);
    void fetchItems(record.id, 1, itemsPageSize, '');
  };

  const openConfig = (meta: AsyncTaskTypeMeta) => {
    setConfigType(meta);
    setConfigDraft({
      enabled: meta.enabled,
      allowConcurrent: meta.allowConcurrent,
      maxAttempts: meta.maxAttempts,
      retryDelayMs: meta.retryDelayMs,
      retentionDays: meta.retentionDays,
    });
  };

  const handleConfigSave = async () => {
    if (!configType) return;
    setConfigSaving(true);
    try {
      const res = await request.put<AsyncTaskTypeMeta>(`/api/async-tasks/types/${configType.taskType}/config`, configDraft);
      if (res.code === 0) {
        Toast.success('策略已更新');
        setConfigType(null);
        void fetchTypes({ withLoading: true });
      }
    } finally {
      setConfigSaving(false);
    }
  };

  const columns: ColumnProps<AsyncTask>[] = [
    { title: '任务ID', dataIndex: 'id', width: 90 },
    {
      title: '任务',
      dataIndex: 'title',
      width: 240,
      render: (_: string, record: AsyncTask) => (
        <div>
          <Typography.Text strong>{record.title}</Typography.Text>
          <div><Typography.Text type="tertiary" size="small">{record.taskType}</Typography.Text></div>
        </div>
      ),
    },
    { title: '模块', dataIndex: 'module', width: 110, render: (value: string | null) => value ?? '-' },
    { title: '进度', dataIndex: 'processedCount', width: 210, render: (_: number, record: AsyncTask) => <AsyncTaskProgress task={record} /> },
    {
      title: '数量',
      dataIndex: 'totalCount',
      width: 140,
      render: (_: number | null, record: AsyncTask) => (
        <Typography.Text size="small">
          {record.processedCount}{record.totalCount != null ? ` / ${record.totalCount}` : ''}
          {record.failedCount > 0 ? <Typography.Text type="danger" size="small">（失败 {record.failedCount}）</Typography.Text> : null}
        </Typography.Text>
      ),
    },
    {
      title: '执行次数',
      dataIndex: 'attempts',
      width: 100,
      render: (value: number, record: AsyncTask) => (
        <Typography.Text size="small">{value} / {record.maxAttempts}</Typography.Text>
      ),
    },
    { title: '提交人', dataIndex: 'createdByName', width: 120, render: (value: string | null) => value ?? '-' },
    { title: '提交时间', dataIndex: 'createdAt', width: 190, render: (value: string) => formatDateTime(value) },
    { title: '完成时间', dataIndex: 'completedAt', width: 190, render: (value: string | null) => (value ? formatDateTime(value) : '-') },
    {
      title: '错误信息',
      dataIndex: 'errorMessage',
      width: 160,
      render: (value: string | null, record: AsyncTask) => (value ? (
        <Button theme="borderless" type="danger" size="small" onClick={() => handleShowError(record)}>查看失败原因</Button>
      ) : '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      fixed: 'right',
      render: (value: AsyncTaskStatus, record: AsyncTask) => {
        if (value === 'running' && record.cancelRequested) return <Tag color="orange">取消中</Tag>;
        if (value === 'pending' && record.nextRunAt) return <Tag color="orange">等待重试</Tag>;
        const meta = statusTagMap[value];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    createOperationColumn<AsyncTask>({
      width: 150,
      desktopInlineKeys: ['detail', 'cancel'],
      actions: (record) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => openDetail(record),
        },
        {
          key: 'cancel',
          label: '取消',
          hidden: !canManage || !['pending', 'running'].includes(record.status),
          loading: actionLoadingId === record.id,
          disabled: record.cancelRequested,
          disabledReason: '已请求取消，等待任务退出',
          onClick: () => void runAction(record, 'cancel', '已请求取消'),
        },
        {
          key: 'resume',
          label: '断点恢复',
          hidden: !canManage || !['failed', 'cancelled'].includes(record.status),
          loading: actionLoadingId === record.id,
          onClick: () => void runAction(record, 'resume', '已从断点恢复，重新入队'),
        },
        {
          key: 'restart',
          label: '重新开始',
          hidden: !canManage || !['success', 'failed', 'cancelled'].includes(record.status),
          loading: actionLoadingId === record.id,
          onClick: () => void runAction(record, 'restart', '已重新开始'),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          dividerBefore: true,
          hidden: !canManage || !['success', 'failed', 'cancelled'].includes(record.status),
          onClick: () => handleDelete(record),
        },
      ],
    }),
  ];

  const itemColumns: ColumnProps<AsyncTaskItem>[] = [
    { title: '标识', dataIndex: 'itemKey', width: 120 },
    { title: '名称', dataIndex: 'label', width: 150, render: (value: string | null) => value ?? '-' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: AsyncTaskItemStatus) => {
        const meta = itemStatusTagMap[value];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: '信息', dataIndex: 'message', width: 220, render: renderEllipsis },
    { title: '执行轮次', dataIndex: 'attempt', width: 90 },
  ];

  const typeColumns: ColumnProps<AsyncTaskTypeMeta>[] = [
    { title: '任务类型', dataIndex: 'taskType', width: 170, render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
    { title: '名称', dataIndex: 'title', width: 150 },
    { title: '模块', dataIndex: 'module', width: 110 },
    { title: '说明', dataIndex: 'description', width: 300, render: renderEllipsis },
    {
      title: '重复提交',
      dataIndex: 'allowConcurrent',
      width: 100,
      render: (value: boolean) => (value ? <Tag color="green">允许</Tag> : <Tag color="orange">禁止</Tag>),
    },
    {
      title: '自动重试',
      dataIndex: 'maxAttempts',
      width: 150,
      render: (value: number, record: AsyncTaskTypeMeta) => (
        <Typography.Text size="small">
          {value > 1 ? `最多 ${value} 次 / 退避 ${Math.round(record.retryDelayMs / 1000)}s` : '不重试'}
        </Typography.Text>
      ),
    },
    {
      title: '保留天数',
      dataIndex: 'retentionDays',
      width: 100,
      render: (value: number | null) => (value != null ? `${value} 天` : '跟随全局'),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 100,
      fixed: 'right',
      render: (value: boolean) => (value ? <Tag color="green">开放提交</Tag> : <Tag color="red">暂停提交</Tag>),
    },
    createOperationColumn<AsyncTaskTypeMeta>({
      width: 100,
      desktopInlineKeys: ['config'],
      actions: (record) => [
        {
          key: 'config',
          label: '策略',
          hidden: !canConfig,
          onClick: () => openConfig(record),
        },
      ],
    }),
  ];

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" activeKey={activeTab} onChange={(key) => setActiveTab(key as TabKey)} lazyRender>
        <TabPane tab="任务列表" itemKey="tasks">
          <StatsCards stats={stats} />
          <SearchToolbar>
            <Select
              placeholder="任务类型"
              value={searchParams.taskType || undefined}
              optionList={typeOptions}
              onChange={(value) => setSearchParams((prev) => ({ ...prev, taskType: (value as string) ?? '' }))}
              style={{ width: 210 }}
            />
            <Select
              placeholder="状态"
              value={searchParams.status || undefined}
              optionList={statusOptions}
              onChange={(value) => setSearchParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
              style={{ width: 120 }}
            />
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索任务标题/类型"
              value={searchParams.keyword}
              onChange={(value) => setSearchParams((prev) => ({ ...prev, keyword: value }))}
              onEnterPress={handleSearch}
              style={{ width: 190 }}
              showClear
            />
            <Input
              placeholder="提交人（用户名/昵称）"
              value={searchParams.createdBy}
              onChange={(value) => setSearchParams((prev) => ({ ...prev, createdBy: value }))}
              onEnterPress={handleSearch}
              style={{ width: 170 }}
              showClear
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            <Button icon={<RefreshCw size={14} />} onClick={() => { void fetchData(); void fetchStats(); }} loading={loading}>刷新</Button>
            {canCleanup && (
              <Button icon={<Eraser size={14} />} loading={cleaning} onClick={handleCleanup}>清理过期记录</Button>
            )}
            {canManage && selectedRowKeys.length > 0 && (
              <>
                <Button icon={<XCircle size={14} />} loading={batchLoading} onClick={handleBatchCancel}>
                  批量取消 ({selectedRowKeys.length})
                </Button>
                <Button type="danger" icon={<Trash2 size={14} />} loading={batchLoading} onClick={handleBatchDelete}>
                  批量删除 ({selectedRowKeys.length})
                </Button>
              </>
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
              <Typography.Text type="tertiary" size="small">自动刷新</Typography.Text>
            </span>
          </SearchToolbar>

          <ConfigurableTable
            bordered
            columns={columns}
            dataSource={data}
            loading={loading}
            onRefresh={() => { void fetchData(); void fetchStats(); }}
            refreshLoading={loading}
            pagination={buildPagination(total, fetchData)}
            rowKey="id"
            rowSelection={canManage ? {
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys((keys ?? []) as number[]),
            } : undefined}
            size="small"
            empty="暂无异步任务"
            columnSettingsKey="task-center-tasks"
            scroll={{ x: 1870 }}
          />
        </TabPane>

        <TabPane tab="任务类型" itemKey="types">
          <SearchToolbar>
            <Button type="primary" icon={<RefreshCw size={14} />} onClick={() => void fetchTypes({ withLoading: true })} loading={typesLoading}>刷新</Button>
          </SearchToolbar>
          <ConfigurableTable
            bordered
            columns={typeColumns}
            dataSource={types}
            loading={typesLoading}
            onRefresh={() => void fetchTypes({ withLoading: true })}
            refreshLoading={typesLoading}
            pagination={false}
            rowKey="taskType"
            size="small"
            empty="暂无注册的任务类型"
            columnSettingsKey="task-center-types"
            scroll={{ x: 1180 }}
          />
        </TabPane>
      </Tabs>

      <SideSheet
        title={detailTask ? `任务详情 #${detailTask.id}` : '任务详情'}
        visible={!!detailTask}
        onCancel={() => setDetailTask(null)}
        width={720}
      >
        {detailTask && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Descriptions
              data={[
                { key: '任务标题', value: detailTask.title },
                { key: '任务类型', value: detailTask.taskType },
                { key: '所属模块', value: detailTask.module ?? '-' },
                { key: '状态', value: statusTagMap[detailTask.status].label },
                { key: '进度', value: `${detailTask.processedCount}${detailTask.totalCount != null ? ` / ${detailTask.totalCount}` : ''}${detailTask.failedCount > 0 ? `（失败 ${detailTask.failedCount}）` : ''}` },
                { key: '进度说明', value: detailTask.progressNote ?? '-' },
                { key: '执行次数', value: `${detailTask.attempts} / ${detailTask.maxAttempts}` },
                { key: '下次重试', value: detailTask.nextRunAt ? formatDateTime(detailTask.nextRunAt) : '-' },
                { key: '提交人', value: detailTask.createdByName ?? '-' },
                { key: '开始时间', value: detailTask.startedAt ? formatDateTime(detailTask.startedAt) : '-' },
                { key: '完成时间', value: detailTask.completedAt ? formatDateTime(detailTask.completedAt) : '-' },
              ]}
              size="small"
            />
            <div>
              <Typography.Title heading={6} style={{ marginBottom: 8 }}>任务参数</Typography.Title>
              {renderJson(detailTask.payload)}
            </div>
            <div>
              <Typography.Title heading={6} style={{ marginBottom: 8 }}>执行结果</Typography.Title>
              {renderJson(detailTask.result)}
            </div>
            {detailTask.errorMessage && (
              <div>
                <Typography.Title heading={6} style={{ marginBottom: 8 }}>错误信息</Typography.Title>
                <Typography.Paragraph type="danger" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {detailTask.errorMessage}
                </Typography.Paragraph>
              </div>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <Typography.Title heading={6} style={{ margin: 0 }}>任务项明细（{itemsTotal}）</Typography.Title>
                <Select
                  placeholder="状态"
                  value={itemStatusFilter || undefined}
                  optionList={itemStatusOptions}
                  onChange={(value) => {
                    const next = (value as string) ?? '';
                    setItemStatusFilter(next);
                    setItemsPage(1);
                    void fetchItems(detailTask.id, 1, itemsPageSize, next);
                  }}
                  style={{ width: 120 }}
                  size="small"
                />
              </div>
              <ConfigurableTable
                bordered
                columns={itemColumns}
                dataSource={items}
                loading={itemsLoading}
                pagination={buildItemsPagination(itemsTotal, (p, ps) => void fetchItems(detailTask.id, p, ps))}
                rowKey="id"
                size="small"
                empty="该任务未上报行级明细"
                scroll={{ x: 670 }}
              />
            </div>
          </div>
        )}
      </SideSheet>

      <AppModal
        visible={!!configType}
        title={configType ? `任务类型策略 - ${configType.title}` : '任务类型策略'}
        width={520}
        onCancel={() => setConfigType(null)}
        onOk={() => void handleConfigSave()}
        okButtonProps={{ loading: configSaving }}
        closeOnEsc
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <Typography.Text>开放提交</Typography.Text>
              <div><Typography.Text type="tertiary" size="small">关闭后拒绝新任务提交，存量任务不受影响</Typography.Text></div>
            </div>
            <Switch checked={configDraft.enabled} onChange={(v) => setConfigDraft((prev) => ({ ...prev, enabled: v }))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <Typography.Text>允许重复提交</Typography.Text>
              <div><Typography.Text type="tertiary" size="small">关闭后同一用户存在未结束任务时拒绝再次提交</Typography.Text></div>
            </div>
            <Switch checked={configDraft.allowConcurrent} onChange={(v) => setConfigDraft((prev) => ({ ...prev, allowConcurrent: v }))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <Typography.Text>最大执行次数</Typography.Text>
              <div><Typography.Text type="tertiary" size="small">1 = 失败不自动重试；失败保留断点自动重试</Typography.Text></div>
            </div>
            <InputNumber min={1} max={10} value={configDraft.maxAttempts} onNumberChange={(v) => setConfigDraft((prev) => ({ ...prev, maxAttempts: v || 1 }))} style={{ width: 120 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <Typography.Text>重试退避基数（毫秒）</Typography.Text>
              <div><Typography.Text type="tertiary" size="small">实际延迟 = 基数 × 2^(已执行次数-1)，上限 15 分钟</Typography.Text></div>
            </div>
            <InputNumber min={1000} max={900000} step={1000} value={configDraft.retryDelayMs} onNumberChange={(v) => setConfigDraft((prev) => ({ ...prev, retryDelayMs: v || 5000 }))} style={{ width: 140 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <Typography.Text>保留天数</Typography.Text>
              <div><Typography.Text type="tertiary" size="small">已结束任务的记录保留期；留空跟随全局（30 天）</Typography.Text></div>
            </div>
            <InputNumber
              min={1}
              max={3650}
              placeholder="全局"
              value={configDraft.retentionDays ?? undefined}
              onChange={(v) => setConfigDraft((prev) => ({ ...prev, retentionDays: typeof v === 'number' ? v : null }))}
              style={{ width: 120 }}
            />
          </div>
        </div>
      </AppModal>
    </div>
  );
}
