import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Descriptions, Modal, Select, SideSheet, Switch, Tag, Toast, Typography, Input } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Eraser, RefreshCw, RotateCcw, Search } from 'lucide-react';
import type { AsyncTask, AsyncTaskStatus, AsyncTaskTypeMeta, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useTaskProgressEvents } from '@/hooks/useAsyncTasks';
import { formatDateTime } from '@/utils/date';

interface SearchParams {
  taskType: string;
  status: string;
  keyword: string;
}

const defaultSearchParams: SearchParams = { taskType: '', status: '', keyword: '' };

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

export default function TaskCenterPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:async-task:manage');
  const canCleanup = hasPermission('system:async-task:cleanup');

  const [types, setTypes] = useState<AsyncTaskTypeMeta[]>([]);
  const [data, setData] = useState<AsyncTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [detailTask, setDetailTask] = useState<AsyncTask | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const { page, pageSize, setPage, buildPagination } = usePagination();

  const typeOptions = useMemo(
    () => [
      { value: '', label: '全部类型' },
      ...types.map((item) => ({ value: item.taskType, label: `${item.module} · ${item.title}` })),
    ],
    [types],
  );

  const fetchTypes = useCallback(async () => {
    const res = await request.get<AsyncTaskTypeMeta[]>('/api/async-tasks/types', { silent: true });
    if (res.code === 0) setTypes(res.data);
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
      }).toString();
      const res = await request.get<PaginatedResponse<AsyncTask>>(`/api/async-tasks?${query}`, { silent: opts?.silent });
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void fetchTypes();
  }, [fetchTypes]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // 自动刷新（5s），保证看到其他用户任务的进度推进
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchData(undefined, undefined, undefined, { silent: true });
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchData]);

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
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDelete = (record: AsyncTask) => {
    Modal.confirm({
      title: '删除任务记录',
      content: `将删除任务 #${record.id}「${record.title}」的记录，不可恢复。`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete<null>(`/api/async-tasks/${record.id}`);
        if (res.code === 0) {
          Toast.success('已删除');
          void fetchData();
        }
      },
    });
  };

  const handleCleanup = () => {
    Modal.confirm({
      title: '清理已结束任务',
      content: '将删除超过 30 天保留期的已结束任务记录（成功/失败/已取消）。',
      onOk: async () => {
        setCleaning(true);
        try {
          const res = await request.post<{ cleaned: number }>('/api/async-tasks/cleanup');
          if (res.code === 0) {
            Toast.success(`已清理 ${res.data.cleaned} 条任务记录`);
            void fetchData();
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
    { title: '执行次数', dataIndex: 'attempts', width: 90 },
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
        const meta = statusTagMap[value];
        return value === 'running' && record.cancelRequested
          ? <Tag color="orange">取消中</Tag>
          : <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    createOperationColumn<AsyncTask>({
      width: 150,
      desktopInlineKeys: ['detail', 'cancel'],
      actions: (record) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => setDetailTask(record),
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

  return (
    <div className="page-container">
      <SearchToolbar>
        <Select
          placeholder="任务类型"
          value={searchParams.taskType || undefined}
          optionList={typeOptions}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, taskType: (value as string) ?? '' }))}
          style={{ width: 220 }}
        />
        <Select
          placeholder="状态"
          value={searchParams.status || undefined}
          optionList={statusOptions}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
          style={{ width: 130 }}
        />
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索任务标题/类型"
          value={searchParams.keyword}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, keyword: value }))}
          onEnterPress={handleSearch}
          style={{ width: 220 }}
          showClear
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        <Button icon={<RefreshCw size={14} />} onClick={() => void fetchData()} loading={loading}>刷新</Button>
        {canCleanup && (
          <Button icon={<Eraser size={14} />} loading={cleaning} onClick={handleCleanup}>清理过期记录</Button>
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
        onRefresh={() => void fetchData()}
        refreshLoading={loading}
        pagination={buildPagination(total, fetchData)}
        rowKey="id"
        size="small"
        empty="暂无异步任务"
        scroll={{ x: 1800 }}
      />

      <SideSheet
        title={detailTask ? `任务详情 #${detailTask.id}` : '任务详情'}
        visible={!!detailTask}
        onCancel={() => setDetailTask(null)}
        width={640}
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
                { key: '执行次数', value: detailTask.attempts },
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
          </div>
        )}
      </SideSheet>
    </div>
  );
}
