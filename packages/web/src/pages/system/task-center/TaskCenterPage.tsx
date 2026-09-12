import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Descriptions, InputNumber, Modal, Select, SideSheet, Spin, Switch, TabPane, Tabs, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Eraser, RefreshCw, Trash2, XCircle } from 'lucide-react';
import type { PaginatedResponse } from '@zenith/shared/core';
import { enumValueOf } from '@zenith/shared/core';
import { ASYNC_TASK_ITEM_STATUSES, ASYNC_TASK_STATUSES, isAsyncTaskTerminal } from '@zenith/shared/tasks';
import type { AsyncTask, AsyncTaskItem, AsyncTaskItemStatus, AsyncTaskStatus, AsyncTaskTypeMeta, AsyncTaskTypeStat } from '@zenith/shared/tasks';
import { asyncTaskItemColumns, asyncTaskStatusColumn } from '@/components/async-task-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import AppModal from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { confirmAndDelete, deleteAction, ListSearchToolbar, listTableProps, useRowSelection } from '@/components/list-page';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useTaskProgressEvents } from '@/hooks/useAsyncTasks';
import { compactParams } from '@/lib/query';
import { useListSearch } from '@/hooks/useListSearch';
import { ASYNC_TASK_STATUS_TAG_MAP as statusTagMap, asyncTaskRateColor as rateColor } from '@/utils/async-task';
import { formatDurationMs as formatDuration } from '@/utils/format';
import { formatDateTime } from '@/utils/date';
import { EMPTY_PLACEHOLDER, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import {
  asyncTaskKeys,
  useAsyncTaskAction,
  useAsyncTaskItems,
  useAsyncTaskList,
  useAsyncTaskStats,
  useAsyncTaskTypes,
  useBatchCancelAsyncTasks,
  useBatchDeleteAsyncTasks,
  useCleanupAsyncTasks,
  useDeleteAsyncTask,
  useUpdateAsyncTaskTypeConfig,
} from '@/hooks/queries/async-tasks';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { JsonBlock } from '@/components/JsonBlock';
import TaskStatsTab from './TaskStatsTab';

import { useUrlTabState } from '@/hooks/useUrlTabState';
type TabKey = 'tasks' | 'types' | 'stats';

/** 任务类型行：注册表配置 + 执行统计；retired 表示类型已下线但仍有历史记录 */
type TaskTypeRow = AsyncTaskTypeMeta & {
  retired: boolean;
  stat: AsyncTaskTypeStat | null;
};

interface SearchParams {
  taskType?: string;
  status?: string;
  keyword: string;
  content: string;
  createdBy: string;
}

const defaultSearchParams: SearchParams = { taskType: undefined, status: undefined, keyword: '', content: '', createdBy: '' };

const statusOptions: Array<{ value: AsyncTaskStatus; label: string }> = [
  { value: 'pending', label: '排队中' },
  { value: 'running', label: '执行中' },
  { value: 'success', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
];

const itemStatusOptions: Array<{ value: AsyncTaskItemStatus; label: string }> = [
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'skipped', label: '跳过' },
  { value: 'pending', label: '待处理' },
];

const refreshIntervalOptions = [
  { value: 0, label: '关闭' },
  { value: 5000, label: '5 秒' },
  { value: 10000, label: '10 秒' },
  { value: 30000, label: '30 秒' },
  { value: 60000, label: '60 秒' },
];

const EMPTY_TASKS: AsyncTask[] = [];
const EMPTY_TYPES: AsyncTaskTypeMeta[] = [];

function renderJson(value: Record<string, unknown> | null) {
  if (!value || Object.keys(value).length === 0) return <Typography.Text type="tertiary">{EMPTY_PLACEHOLDER}</Typography.Text>;
  return <JsonBlock value={value} />;
}

export default function TaskCenterPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const canManage = hasPermission('system:async-task:manage');
  const canCleanup = hasPermission('system:async-task:cleanup');
  const canConfig = hasPermission('system:async-task:config');

  const [activeTab, setActiveTab] = useUrlTabState(['tasks', 'types', 'stats'] as const, 'tasks');
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: asyncTaskKeys.lists });
  const [detailTask, setDetailTask] = useState<AsyncTask | null>(null);
  const { selectedRowKeys, setSelectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection();

  // 详情抽屉：任务项明细
  const [itemStatusFilter, setItemStatusFilter] = useState<string | undefined>();
  const { page: itemsPage, pageSize: itemsPageSize, setPage: setItemsPage, buildPagination: buildItemsPagination } = usePagination(10);

  // 类型策略弹窗
  const [configType, setConfigType] = useState<AsyncTaskTypeMeta | null>(null);
  const [configDraft, setConfigDraft] = useState({ enabled: true, allowConcurrent: true, maxAttempts: 1, retryDelayMs: 5000, retentionDays: null as number | null });
  const refetchInterval = refreshInterval > 0 && activeTab === 'tasks' ? refreshInterval : false;
  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    taskType: submittedParams.taskType,
    status: enumValueOf(ASYNC_TASK_STATUSES, submittedParams.status),
    keyword: submittedParams.keyword,
    content: submittedParams.content,
    createdBy: submittedParams.createdBy,
  }), [submittedParams]);

  const listQuery = useAsyncTaskList({ page, pageSize, ...filterQuery }, { refetchInterval });
  const statsQuery = useAsyncTaskStats({ refetchInterval });
  const typesQuery = useAsyncTaskTypes();
  const itemsQuery = useAsyncTaskItems({
    taskId: detailTask?.id ?? 0,
    page: itemsPage,
    pageSize: itemsPageSize,
    status: enumValueOf(ASYNC_TASK_ITEM_STATUSES, itemStatusFilter),
  }, detailTask != null);
  const data = listQuery.data?.list ?? EMPTY_TASKS;
  const total = listQuery.data?.total ?? 0;
  const stats = statsQuery.data ?? null;
  const types = typesQuery.data ?? EMPTY_TYPES;
  /**
   * 任务类型行 = 注册表配置 + 执行统计。
   * 两者本就是同一主键的两个侧面（配得对不对 / 跑得好不好），并排看才能直接决策；
   * 已下线但仍有历史记录的类型补在末尾，避免统计口径缺失。
   */
  const typeRows = useMemo<TaskTypeRow[]>(() => {
    const statByType = new Map((stats?.byType ?? []).map((item) => [item.taskType, item]));
    const registered: TaskTypeRow[] = types.map((meta) => ({
      ...meta,
      retired: false,
      stat: statByType.get(meta.taskType) ?? null,
    }));
    const registeredKeys = new Set(types.map((meta) => meta.taskType));
    const retired: TaskTypeRow[] = (stats?.byType ?? [])
      .filter((item) => !registeredKeys.has(item.taskType))
      .map((item) => ({
        taskType: item.taskType,
        title: item.title,
        module: item.module ?? '',
        description: null,
        allowConcurrent: false,
        enabled: false,
        maxAttempts: 1,
        retryDelayMs: 0,
        retentionDays: null,
        retired: true,
        stat: item,
      }));
    return [...registered, ...retired];
  }, [types, stats]);

  // 类型页签同时依赖注册表与统计，刷新需一并拉取
  const typesLoading = typesQuery.isFetching || statsQuery.isFetching;
  const handleRefreshTypes = useCallback(() => {
    void typesQuery.refetch();
    void statsQuery.refetch();
  }, [typesQuery, statsQuery]);
  const cancelMutation = useAsyncTaskAction('cancel');
  const resumeMutation = useAsyncTaskAction('resume');
  const restartMutation = useAsyncTaskAction('restart');
  const deleteMutation = useDeleteAsyncTask();
  const batchCancelMutation = useBatchCancelAsyncTasks();
  const batchDeleteMutation = useBatchDeleteAsyncTasks();
  const cleanupMutation = useCleanupAsyncTasks();
  const updateTypeConfigMutation = useUpdateAsyncTaskTypeConfig();
  const actionLoadingId =
    (cancelMutation.isPending ? cancelMutation.variables?.params.id : null)
    ?? (resumeMutation.isPending ? resumeMutation.variables?.params.id : null)
    ?? (restartMutation.isPending ? restartMutation.variables?.params.id : null)
    ?? (deleteMutation.isPending ? deleteMutation.variables?.params.id : null)
    ?? null;
  const batchLoading = batchCancelMutation.isPending || batchDeleteMutation.isPending;
  const itemsTotal = itemsQuery.data?.total ?? 0;
  // 后台轮询不接管表格 loading，否则每次自动刷新都会闪一次遮罩；仅首屏与查询条件/页码变化时展示
  const tableLoading = listQuery.isLoading || (listQuery.isPlaceholderData && listQuery.isFetching);

  const handleRefresh = () => {
    setManualRefreshing(true);
    void Promise.all([listQuery.refetch(), statsQuery.refetch()]).finally(() => setManualRefreshing(false));
  };

  const typeOptions = useMemo(
    () => types.map((item) => ({ value: item.taskType, label: `${item.module} · ${item.title}` })),
    [types],
  );

  useEffect(() => {
    setSelectedRowKeys((prev) => prev.filter((id) => data.some((item) => item.id === id)));
  }, [data, setSelectedRowKeys]);

  // 自己提交的任务走 WS 实时合并（其他用户任务靠自动刷新兜底）
  useTaskProgressEvents(
    useCallback((task: AsyncTask) => {
      queryClient.setQueriesData<PaginatedResponse<AsyncTask>>({ queryKey: asyncTaskKeys.lists }, (old) => (
        old ? { ...old, list: old.list.map((item) => (item.id === task.id ? task : item)) } : old
      ));
      setDetailTask((prev) => (prev && prev.id === task.id ? task : prev));
    }, [queryClient]),
  );

  const runAction = async (record: AsyncTask, action: 'cancel' | 'resume' | 'restart', successMsg: string) => {
    const mutation = action === 'cancel' ? cancelMutation : action === 'resume' ? resumeMutation : restartMutation;
    await mutation.mutateAsync({ params: { id: record.id } });
    Toast.success(successMsg);
  };

  const handleBatchCancel = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: '批量取消任务',
      content: `将对选中的 ${selectedRowKeys.length} 个任务发起取消（已结束的任务自动跳过）。`,
      onOk: async () => {
        const data = await batchCancelMutation.mutateAsync({ body: { ids: selectedRowKeys } });
        Toast.success(`已请求取消 ${data.affected} 个任务`);
        clearSelection();
      },
    });
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    confirmAndDelete({
      title: '批量删除任务记录',
      content: `将删除选中任务中已结束的记录（进行中的自动跳过），不可恢复。`,
      run: () => batchDeleteMutation.mutateAsync({ body: { ids: selectedRowKeys } }),
      successMessage: (data) => `已删除 ${data.affected} 个任务记录`,
      onDeleted: clearSelection,
    });
  };

  const handleCleanup = () => {
    confirmAndDelete({
      title: '清理已结束任务',
      content: '将按保留策略删除过期的已结束任务记录（默认 30 天，任务类型可单独配置）。',
      run: () => cleanupMutation.mutateAsync({}),
      successMessage: (data) => `已清理 ${data.cleaned} 条任务记录`,
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
    setItemStatusFilter(undefined);
    setItemsPage(1);
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
    await updateTypeConfigMutation.mutateAsync({ params: { taskType: configType.taskType }, body: configDraft });
    Toast.success('策略已更新');
    setConfigType(null);
  };

  const columns: ColumnProps<AsyncTask>[] = [
    { title: '任务ID', dataIndex: 'id', width: 90 },
    { title: '任务名称', dataIndex: 'title', minWidth: 220, render: renderEllipsis },
    { title: '任务类型', dataIndex: 'taskType', width: 200, render: renderEllipsis },
    { title: '模块', dataIndex: 'module', width: 160, render: renderEllipsis },
    { title: '进度', dataIndex: 'processedCount', width: 190, render: (_: number, record: AsyncTask) => <AsyncTaskProgress task={record} noteDisplay="tooltip" /> },
    {
      title: '数量',
      align: 'right',
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
      align: 'right',
      dataIndex: 'attempts',
      width: 100,
      render: (value: number, record: AsyncTask) => (
        <Typography.Text size="small">{value} / {record.maxAttempts}</Typography.Text>
      ),
    },
    { title: '提交人', dataIndex: 'createdByName', width: 120, render: (value: string | null) => value || EMPTY_PLACEHOLDER },
    dateTimeColumn('提交时间', 'createdAt'),
    dateTimeColumn('完成时间', 'completedAt'),
    {
      title: '错误信息',
      dataIndex: 'errorMessage',
      width: 160,
      render: (value: string | null, record: AsyncTask) => (value ? (
        <Button theme="borderless" type="danger" size="small" onClick={() => handleShowError(record)}>查看失败原因</Button>
      ) : EMPTY_PLACEHOLDER),
    },
    asyncTaskStatusColumn<AsyncTask>(110),
    createOperationColumn<AsyncTask>({
      // 取消 / 断点恢复 / 重新开始 / 删除 随任务状态出现，统一进更多；行内只保留详情
      width: 120,
      desktopInlineKeys: ['detail'],
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
          hidden: !canManage || !isAsyncTaskTerminal(record.status),
          loading: actionLoadingId === record.id,
          onClick: () => void runAction(record, 'restart', '已重新开始'),
        },
        {
          ...deleteAction({
            hidden: !canManage || !isAsyncTaskTerminal(record.status),
            title: '删除任务记录',
            content: `将删除任务 #${record.id}「${record.title}」的记录（含任务项明细），不可恢复。`,
            run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
            successMessage: '已删除',
            onDeleted: () => setSelectedRowKeys((prev) => prev.filter((id) => id !== record.id)),
          }),
          dividerBefore: true,
        },
      ],
    }),
  ];

  const itemColumns = asyncTaskItemColumns();

  const typeColumns: ColumnProps<TaskTypeRow>[] = [
    {
      title: '任务类型',
      dataIndex: 'title',
      width: 200,
      render: (title: string, record: TaskTypeRow) => (
        <div>
          <div>
            {title}
            {record.retired && <Tag size="small" color="grey" style={{ marginLeft: 6 }}>已下线</Tag>}
          </div>
          <Typography.Text type="tertiary" size="small">{record.taskType}</Typography.Text>
        </div>
      ),
    },
    { title: '模块', dataIndex: 'module', width: 110, render: (value: string) => value || EMPTY_PLACEHOLDER },
    { title: '说明', dataIndex: 'description', minWidth: 260, render: renderEllipsis },
    {
      title: '累计执行',
      dataIndex: 'stat',
      width: 100,
      render: (stat: AsyncTaskTypeStat | null) => (stat ? stat.total : <Typography.Text type="tertiary">—</Typography.Text>),
    },
    {
      title: '成功率',
      align: 'right',
      key: 'successRate',
      width: 110,
      render: (_: unknown, record: TaskTypeRow) => {
        const rate = record.stat?.successRate ?? null;
        if (rate === null) return <Typography.Text type="tertiary">—</Typography.Text>;
        return (
          <Typography.Text style={{ color: rateColor(rate) }}>
            {rate}%
            {record.stat!.failed > 0 && (
              <Typography.Text type="tertiary" size="small">（失败 {record.stat!.failed}）</Typography.Text>
            )}
          </Typography.Text>
        );
      },
    },
    {
      title: '平均耗时',
      align: 'right',
      key: 'avgDurationMs',
      width: 110,
      render: (_: unknown, record: TaskTypeRow) => formatDuration(record.stat?.avgDurationMs ?? null),
    },
    {
      title: '重复提交',
      dataIndex: 'allowConcurrent',
      width: 100,
      render: (value: boolean, record: TaskTypeRow) => (record.retired
        ? <Typography.Text type="tertiary">—</Typography.Text>
        : (value ? <Tag color="green">允许</Tag> : <Tag color="orange">禁止</Tag>)),
    },
    {
      title: '自动重试',
      dataIndex: 'maxAttempts',
      width: 150,
      render: (value: number, record: TaskTypeRow) => (record.retired
        ? <Typography.Text type="tertiary">—</Typography.Text>
        : (
          <Typography.Text size="small">
            {value > 1 ? `最多 ${value} 次 / 退避 ${Math.round(record.retryDelayMs / 1000)}s` : '不重试'}
          </Typography.Text>
        )),
    },
    {
      title: '保留天数',
      align: 'right',
      dataIndex: 'retentionDays',
      width: 100,
      render: (value: number | null, record: TaskTypeRow) => (record.retired
        ? <Typography.Text type="tertiary">—</Typography.Text>
        : (value != null ? `${value} 天` : '跟随全局')),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 100,
      fixed: 'right',
      render: (value: boolean, record: TaskTypeRow) => {
        if (record.retired) return <Tag color="grey">已下线</Tag>;
        return value ? <Tag color="green">开放提交</Tag> : <Tag color="red">暂停提交</Tag>;
      },
    },
    createOperationColumn<TaskTypeRow>({
      width: 100,
      desktopInlineKeys: ['config'],
      actions: (record) => [
        {
          key: 'config',
          label: '策略',
          hidden: !canConfig || record.retired,
          onClick: () => openConfig(record),
        },
      ],
    }),
  ];

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" type="line" activeKey={activeTab} onChange={(key) => setActiveTab(key as TabKey)} lazyRender>
        <TabPane tab="任务列表" itemKey="tasks">
          <ListSearchToolbar
            keyword={<KeywordInput placeholder="搜索任务标题/类型" {...bindKeyword('keyword')} width={190} />}
            filters={(
              <>
                <FilterSelect
                  placeholder="全部任务类型"
                  items={typeOptions}
                  {...bind('taskType')}
                  width={210}
                />
                <StatusSelect
                  items={statusOptions}
                  {...bind('status')}
                />
                <KeywordInput placeholder="任务内容包含…" {...bindKeyword('content')} width={170} />
                <KeywordInput placeholder="提交人（用户名/昵称）" {...bindKeyword('createdBy')} width={170} />
              </>
            )}
            onSearch={handleSearch}
            onReset={handleReset}
            actions={(
              <>
                <Button icon={<RefreshCw size={14} />} onClick={handleRefresh} loading={manualRefreshing}>刷新</Button>
                <Select
                  prefix="自动刷新"
                  value={refreshInterval}
                  optionList={refreshIntervalOptions}
                  onChange={(value) => setRefreshInterval(value as number)}
                  style={{ width: 150 }}
                />
                {refreshInterval > 0 && (
                  // 固定宽度占位，轮询指示的出现/消失不会挤动后面的按钮
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: 84 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16 }}>
                      {listQuery.isFetching
                        ? <Spin size="small" />
                        : <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--semi-color-success)' }} />}
                    </span>
                    <Typography.Text type="tertiary" size="small">
                      {listQuery.isFetching ? '刷新中…' : '已开启'}
                    </Typography.Text>
                  </span>
                )}
                {canCleanup && (
                  <Button icon={<Eraser size={14} />} loading={cleanupMutation.isPending} onClick={handleCleanup}>清理过期记录</Button>
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
              </>
            )}
            mobileActions={(
              <>
                {canCleanup && (
                  <Button theme="borderless" icon={<Eraser size={14} />} loading={cleanupMutation.isPending} onClick={handleCleanup}>清理过期记录</Button>
                )}
                {canManage && selectedRowKeys.length > 0 && (
                  <>
                    <Button theme="borderless" icon={<XCircle size={14} />} loading={batchLoading} onClick={handleBatchCancel}>
                      批量取消 ({selectedRowKeys.length})
                    </Button>
                    <Button type="danger" theme="borderless" icon={<Trash2 size={14} />} loading={batchLoading} onClick={handleBatchDelete}>
                      批量删除 ({selectedRowKeys.length})
                    </Button>
                  </>
                )}
              </>
            )}
            filterTitle="任务筛选"
            actionTitle="任务操作"
          />

          <ConfigurableTable
            bordered
            columns={columns}
            dataSource={data}
            loading={tableLoading}
            onRefresh={handleRefresh}
            refreshLoading={manualRefreshing}
            pagination={buildPagination(total)}
            rowKey="id"
            rowSelection={canManage ? rowSelection : undefined}
            size="small"
            empty="暂无异步任务"
            columnSettingsKey="task-center-tasks"
          />
        </TabPane>

        <TabPane tab="任务类型" itemKey="types">
          <SearchToolbar>
            <Button
              type="primary"
              icon={<RefreshCw size={14} />}
              onClick={handleRefreshTypes}
              loading={typesLoading}
            >
              刷新
            </Button>
          </SearchToolbar>
          <ConfigurableTable
            columns={typeColumns}
            {...listTableProps({ data: typeRows, isFetching: typesLoading, refetch: handleRefreshTypes }, {
              rowKey: 'taskType',
              empty: '暂无注册的任务类型',
            })}
            pagination={false}
            columnSettingsKey="task-center-types"
          />
        </TabPane>

        <TabPane tab="任务统计" itemKey="stats">
          <SearchToolbar>
            <Button
              type="primary"
              icon={<RefreshCw size={14} />}
              onClick={() => void statsQuery.refetch()}
              loading={statsQuery.isFetching}
            >
              刷新
            </Button>
          </SearchToolbar>
          <TaskStatsTab stats={stats} />
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
                { key: '所属模块', value: detailTask.module ?? EMPTY_PLACEHOLDER },
                { key: '状态', value: statusTagMap[detailTask.status].label },
                { key: '进度', value: `${detailTask.processedCount}${detailTask.totalCount != null ? ` / ${detailTask.totalCount}` : ''}${detailTask.failedCount > 0 ? `（失败 ${detailTask.failedCount}）` : ''}` },
                { key: '进度说明', value: detailTask.progressNote ?? EMPTY_PLACEHOLDER },
                { key: '执行次数', value: `${detailTask.attempts} / ${detailTask.maxAttempts}` },
                { key: '下次重试', value: detailTask.nextRunAt ? formatDateTime(detailTask.nextRunAt) : EMPTY_PLACEHOLDER },
                { key: '提交人', value: detailTask.createdByName ?? EMPTY_PLACEHOLDER },
                { key: '开始时间', value: detailTask.startedAt ? formatDateTime(detailTask.startedAt) : EMPTY_PLACEHOLDER },
                { key: '完成时间', value: detailTask.completedAt ? formatDateTime(detailTask.completedAt) : EMPTY_PLACEHOLDER },
                {
                  key: '链路 ID',
                  value: detailTask.traceId
                    ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <Typography.Text copyable size="small">{detailTask.traceId}</Typography.Text>
                          {hasPermission('system:trace:view') && (
                            <Button
                              size="small" theme="borderless" type="primary"
                              onClick={() => navigate(`/system/trace?traceId=${encodeURIComponent(detailTask.traceId!)}`)}
                            >
                              查看链路
                            </Button>
                          )}
                        </span>
                      )
                    : EMPTY_PLACEHOLDER,
                },
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
                <StatusSelect
                  items={itemStatusOptions}
                  value={itemStatusFilter}
                  onChange={(value) => {
                    const next = value;
                    setItemStatusFilter(next);
                    setItemsPage(1);
                  }}
                  size="small"
                />
              </div>
              <ConfigurableTable<AsyncTaskItem>
                columns={itemColumns}
                {...listTableProps(itemsQuery, { pagination: buildItemsPagination, empty: '该任务未上报行级明细' })}
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
        okButtonProps={{ loading: updateTypeConfigMutation.isPending }}
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
