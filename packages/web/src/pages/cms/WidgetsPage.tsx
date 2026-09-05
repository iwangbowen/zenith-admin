import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Modal, SideSheet, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CircleOff, Send, Trash2 } from 'lucide-react';
import { CMS_WIDGET_STATUS_LABELS, CMS_WIDGET_TYPE_LABELS, CMS_WIDGET_STATUS_OPTIONS, CMS_WIDGET_TYPE_OPTIONS } from '@zenith/shared/cms';
import type { CmsWidget, CmsWidgetRef, CmsWidgetStatus, CmsWidgetType } from '@zenith/shared/cms';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import {
  cmsWidgetKeys,
  useCmsWidgetBatch,
  useCmsWidgetList,
  useCmsWidgetRefs,
  useDeleteCmsWidget,
  useOfflineCmsWidget,
  usePublishCmsWidget,
} from '@/hooks/queries/cms-widgets';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { CmsSiteSelect } from './CmsSiteSelect';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete as confirmDeleteModal } from '@/utils/confirm';

interface SearchState {
  keyword: string;
  status?: CmsWidgetStatus;
  type?: CmsWidgetType;
}

const DEFAULT_SEARCH: SearchState = { keyword: '', status: undefined, type: undefined };

const STATUS_COLOR: Record<CmsWidgetStatus, 'grey' | 'green' | 'orange'> = {
  draft: 'grey',
  published: 'green',
  offline: 'orange',
};

export default function WidgetsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const { page, pageSize, resetPage, buildPagination } = usePagination();
  const [siteId, setSiteId] = useState<number | undefined>();
  const [draft, setDraft] = useState<SearchState>(DEFAULT_SEARCH);
  const [submitted, setSubmitted] = useState<SearchState>(DEFAULT_SEARCH);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedRecords, setSelectedRecords] = useState<Record<number, CmsWidget>>({});
  const [refsWidget, setRefsWidget] = useState<CmsWidget | null>(null);

  const listQuery = useCmsWidgetList({
    page,
    pageSize,
    siteId,
    keyword: submitted.keyword || undefined,
    status: submitted.status || undefined,
    type: submitted.type || undefined,
  });
  const refsQuery = useCmsWidgetRefs(refsWidget?.id, !!refsWidget);
  const publishMutation = usePublishCmsWidget();
  const offlineMutation = useOfflineCmsWidget();
  const deleteMutation = useDeleteCmsWidget();
  const batchMutation = useCmsWidgetBatch();
  const { tasks, refresh: refreshTasks } = useMyAsyncTasks({ taskTypes: ['cms-widget-batch', 'cms-widget-refresh'] });
  const taskStatusesRef = useRef(new Map<number, string>());
  const widgetTasks = tasks
    .filter((task) => task.taskType === 'cms-widget-batch' || task.taskType === 'cms-widget-refresh')
    .slice(0, 5);

  useEffect(() => {
    let batchCompleted = false;
    for (const task of tasks) {
      const previous = taskStatusesRef.current.get(task.id);
      if (
        task.taskType === 'cms-widget-batch'
        && (previous === 'pending' || previous === 'running')
        && (task.status === 'success' || task.status === 'failed' || task.status === 'cancelled')
      ) {
        batchCompleted = true;
      }
      taskStatusesRef.current.set(task.id, task.status);
    }
    if (batchCompleted) void queryClient.invalidateQueries({ queryKey: cmsWidgetKeys.all });
  }, [queryClient, tasks]);

  function handleSearch() {
    resetPage();
    setSelectedIds([]);
    setSelectedRecords({});
    setSubmitted({ ...draft, keyword: draft.keyword.trim() });
    void queryClient.invalidateQueries({ queryKey: cmsWidgetKeys.lists });
  }

  function handleReset() {
    resetPage();
    setSelectedIds([]);
    setSelectedRecords({});
    setDraft(DEFAULT_SEARCH);
    setSubmitted(DEFAULT_SEARCH);
    void queryClient.invalidateQueries({ queryKey: cmsWidgetKeys.lists });
  }

  function runSingle(action: 'publish' | 'offline', widget: CmsWidget) {
    const execute = async () => {
      if (action === 'publish') {
        await publishMutation.mutateAsync({ params: { id: widget.id } });
        Toast.success('发布成功，引用刷新任务已提交');
      } else {
        await offlineMutation.mutateAsync({ params: { id: widget.id } });
        Toast.success('下线成功，引用刷新任务已提交');
      }
    };
    if (action === 'publish') {
      Modal.confirm({
        title: `发布页面部件「${widget.name}」？`,
        content: widget.impactCount > 0
          ? `发布后将刷新 ${widget.impactCount} 个页面或首页${widget.highFanout ? '，该部件影响范围较大，请确认变更' : ''}。`
          : '当前没有页面或主题插槽引用，发布不会触发页面刷新。',
        onOk: execute,
      });
      return;
    }
    void execute();
  }

  function confirmDelete(widget: CmsWidget) {
    confirmDeleteModal({
      title: `删除页面部件「${widget.name}」？`,
      content: widget.referenceCount > 0
        ? `该部件仍有 ${widget.referenceCount} 个引用，无法删除。`
        : '删除后不可恢复。',
      okButtonProps: { disabled: widget.referenceCount > 0 },
      onOk: async () => {
        await deleteMutation.mutateAsync({ params: { id: widget.id } });
        Toast.success('删除成功');
      },
    });
  }

  function submitBatch(action: 'publish' | 'offline' | 'delete') {
    if (selectedIds.length === 0) return;
    const label = action === 'publish' ? '发布' : action === 'offline' ? '下线' : '删除';
    Modal.confirm({
      title: `批量${label} ${selectedIds.length} 个页面部件？`,
      content: action === 'delete'
        ? '仍被引用的部件会在任务明细中标记为跳过。'
        : action === 'publish'
          ? `操作将在任务中心异步执行，预计最多刷新 ${Object.values(selectedRecords)
              .reduce((sum, widget) => sum + widget.impactCount, 0)} 个目标（重叠目标会自动合并）。`
          : '操作将在任务中心异步执行。',
      okButtonProps: action === 'delete' ? { type: 'danger', theme: 'solid' } : undefined,
      onOk: async () => {
        const task = await batchMutation.mutateAsync({ body: { ids: selectedIds, action } });
        taskStatusesRef.current.set(task.id, task.status);
        await refreshTasks({ silent: true });
        setSelectedIds([]);
        setSelectedRecords({});
        Toast.success('批量任务已提交');
      },
    });
  }

  const columns: ColumnProps<CmsWidget>[] = [
    { title: '部件名称', dataIndex: 'name', minWidth: 190, render: renderEllipsis },
    { title: '编码', dataIndex: 'code', width: 180, render: renderEllipsis },
    {
      title: '类型',
      dataIndex: 'type',
      width: 110,
      render: (value: CmsWidgetType) => CMS_WIDGET_TYPE_LABELS[value],
    },
    {
      title: '线上修订',
      width: 110,
      render: (_value: unknown, record) => (
        <span>
          {record.publishedRevision || '—'}
          {record.hasUnpublishedChanges ? <Tag size="small" color="blue" style={{ marginLeft: 6 }}>有草稿</Tag> : null}
        </span>
      ),
    },
    { title: '引用数', dataIndex: 'referenceCount', width: 90, align: 'right' },
    {
      title: '影响页面',
      align: 'right',
      dataIndex: 'impactCount',
      width: 120,
      render: (value: number, record) => (
        <span>
          {value}
          {record.highFanout ? <Tag size="small" color="red" style={{ marginLeft: 6 }}>高</Tag> : null}
        </span>
      ),
    },
    dateTimeColumn('更新时间', 'updatedAt'),
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      fixed: 'right',
      render: (value: CmsWidgetStatus) => (
        <Tag size="small" color={STATUS_COLOR[value]}>{CMS_WIDGET_STATUS_LABELS[value]}</Tag>
      ),
    },
    createOperationColumn<CmsWidget>({
      width: 180,
      desktopInlineKeys: ['edit', 'publish'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('cms:widget:update'),
          onClick: () => navigate(`/cms/widgets/edit?id=${record.id}&siteId=${record.siteId}`),
        },
        {
          key: 'publish',
          label: '发布',
          hidden: !hasPermission('cms:widget:publish'),
          loading: publishMutation.isPending && publishMutation.variables?.params.id === record.id,
          onClick: () => runSingle('publish', record),
        },
        {
          key: 'offline',
          label: '下线',
          hidden: record.status !== 'published' || !hasPermission('cms:widget:offline'),
          loading: offlineMutation.isPending && offlineMutation.variables?.params.id === record.id,
          onClick: () => runSingle('offline', record),
        },
        {
          key: 'refs',
          label: `引用（${record.referenceCount}）`,
          onClick: () => setRefsWidget(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('cms:widget:delete'),
          disabled: record.referenceCount > 0,
          disabledReason: record.referenceCount > 0 ? '请先解除所有页面和主题插槽引用' : undefined,
          onClick: () => confirmDelete(record),
        },
      ],
    }),
  ];

  const keywordInput = (
    <KeywordInput placeholder="部件名称 / 编码" value={draft.keyword} onChange={(keyword) => setDraft((current) => ({ ...current, keyword }))} onSearch={handleSearch} />
  );
  const statusFilter = (
    <StatusSelect
      items={CMS_WIDGET_STATUS_OPTIONS}
      value={draft.status}
      onChange={(value) => { setDraft((current) => ({ ...current, status: value })); setSelectedIds([]); setSelectedRecords({}); }}
    />
  );
  const typeFilter = (
    <FilterSelect
      placeholder="全部类型"
      items={CMS_WIDGET_TYPE_OPTIONS}
      value={draft.type}
      onChange={(value) => { setDraft((current) => ({ ...current, type: value as CmsWidgetType | undefined })); setSelectedIds([]); setSelectedRecords({}); }}
      width={140}
    />
  );

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <CmsSiteSelect value={siteId} onChange={(value) => { setSiteId(value); resetPage(); setSelectedIds([]); setSelectedRecords({}); }} />
            {keywordInput}
            {statusFilter}
            {typeFilter}
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
          </>
        )}
        actions={(
          <>
            {selectedIds.length > 0 && hasPermission('cms:widget:publish') ? (
              <Button icon={<Send size={14} />} onClick={() => submitBatch('publish')}>批量发布（{selectedIds.length}）</Button>
            ) : null}
            {selectedIds.length > 0 && hasPermission('cms:widget:offline') ? (
              <Button icon={<CircleOff size={14} />} onClick={() => submitBatch('offline')}>批量下线</Button>
            ) : null}
            {selectedIds.length > 0 && hasPermission('cms:widget:delete') ? (
              <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={() => submitBatch('delete')}>批量删除</Button>
            ) : null}
            {hasPermission('cms:widget:create') ? (
              <CreateButton onClick={() => navigate(`/cms/widgets/edit?siteId=${siteId}`)} disabled={!siteId} />
            ) : null}
          </>
        )}
        mobilePrimary={(
          <>
            <CmsSiteSelect value={siteId} onChange={(value) => { setSiteId(value); resetPage(); setSelectedIds([]); setSelectedRecords({}); }} width={150} />
            {keywordInput}
            <SearchButton onClick={handleSearch} />
          </>
        )}
        mobileFilters={<>{statusFilter}{typeFilter}</>}
        mobileActions={(
          <>
            {selectedIds.length > 0 && hasPermission('cms:widget:publish') ? <Button theme="borderless" onClick={() => submitBatch('publish')}>批量发布</Button> : null}
            {selectedIds.length > 0 && hasPermission('cms:widget:offline') ? <Button theme="borderless" onClick={() => submitBatch('offline')}>批量下线</Button> : null}
            {selectedIds.length > 0 && hasPermission('cms:widget:delete') ? <Button theme="borderless" type="danger" onClick={() => submitBatch('delete')}>批量删除</Button> : null}
          </>
        )}
        filterTitle="页面部件筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable<CmsWidget>
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey={(record) => String(record?.id ?? '')}
        empty={siteId ? '暂无页面部件' : '请先选择站点'}
        pagination={buildPagination(listQuery.data?.total ?? 0, () => { setSelectedIds([]); setSelectedRecords({}); })}
        rowSelection={{
          selectedRowKeys: selectedIds.map(String),
          onChange: (keys) => {
            const nextIds = (keys ?? []).map(Number);
            const selected = new Set(nextIds);
            setSelectedIds(nextIds);
            setSelectedRecords((current) => {
              const next = Object.fromEntries(
                Object.entries(current).filter(([id]) => selected.has(Number(id))),
              ) as Record<number, CmsWidget>;
              for (const widget of listQuery.data?.list ?? []) {
                if (selected.has(widget.id)) next[widget.id] = widget;
              }
              return next;
            });
          },
        }}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
      />

      {widgetTasks.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <Typography.Title heading={6}>最近页面部件任务</Typography.Title>
          <div style={{ display: 'grid', gap: 10 }}>
            {widgetTasks.map((task) => {
              const result = task.result as { succeeded?: number; failed?: number; skipped?: number } | null;
              return (
                <div key={task.id} style={{ padding: 12, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
                  <Typography.Text strong>{task.title}</Typography.Text>
                  <AsyncTaskProgress task={task} />
                  {result && task.taskType === 'cms-widget-batch' ? (
                    <Typography.Text type="tertiary" size="small">
                      成功 {result.succeeded ?? 0} · 跳过 {result.skipped ?? 0} · 失败 {result.failed ?? 0}
                    </Typography.Text>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <SideSheet
        title={refsWidget ? `引用位置：${refsWidget.name}` : '引用位置'}
        visible={!!refsWidget}
        width={520}
        onCancel={() => setRefsWidget(null)}
      >
        <ConfigurableTable<CmsWidgetRef>
          bordered
          rowKey="id"
          columns={[
            {
              title: '类型',
              width: 100,
              render: (_value, record) => record.ownerType === 'page' ? '搭建页面' : '主题插槽',
            },
            { title: '位置', dataIndex: 'ownerName', width: 160, render: renderEllipsis },
            { title: '字段', dataIndex: 'field', width: 150, render: renderEllipsis },
          ]}
          dataSource={refsQuery.data ?? []}
          loading={refsQuery.isFetching}
          pagination={false}
          onRefresh={() => void refsQuery.refetch()}
          refreshLoading={refsQuery.isFetching}
        />
      </SideSheet>
    </div>
  );
}
