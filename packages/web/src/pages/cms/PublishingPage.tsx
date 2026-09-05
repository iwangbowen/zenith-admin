import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Descriptions, Form, Input, Modal, Select, SideSheet, Space, TabPane, Tabs, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import dayjs from 'dayjs';
import { XCircle } from 'lucide-react';
import { CMS_PUBLISH_ARTIFACT_STATUS_LABELS, CMS_PUBLISH_TARGET_TYPE_LABELS, CMS_PUBLISH_TARGET_TYPES } from '@zenith/shared/cms';
import type { CmsPublishingTask, CmsPublishArtifact, CmsPublishArtifactStatus, CmsPublishTargetType } from '@zenith/shared/cms';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import AppModal from '@/components/AppModal';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useTaskProgressEvents } from '@/hooks/useAsyncTasks';
import { useAllCmsSites } from '@/hooks/queries/cms';
import {
  cmsPublishingKeys,
  useBatchCmsPublishingAction,
  useCmsPublishArtifactList,
  useCmsPublishingAction,
  useCmsPublishingDetail,
  useCmsPublishingList,
  useSubmitCmsPublish,
} from '@/hooks/queries/cms-stage3';
import { ASYNC_TASK_STATUS_TAG_MAP } from '@/utils/async-task';
import { formatDateTime, formatDateTimeRangeForApi } from '@/utils/date';
import { createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';

import { useUrlTabState } from '@/hooks/useUrlTabState';
type TabKey = 'queue' | 'history' | 'artifacts' | 'failed';

interface Filters {
  siteId?: number;
  targetType?: CmsPublishTargetType;
  /** 产物页专用：0 = 站点级产物（无归属通道） */
  publishChannelId?: number;
  taskType: string;
  createdBy: string;
  keyword: string;
  startTime?: string;
  endTime?: string;
}

const EMPTY_FILTERS: Filters = {
  siteId: undefined,
  targetType: undefined,
  publishChannelId: undefined,
  taskType: '',
  createdBy: '',
  keyword: '',
  startTime: undefined,
  endTime: undefined,
};

export default function PublishingPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const canBuild = hasPermission('cms:publish:build');
  const canManage = hasPermission('cms:publish:manage');
  const sitesQuery = useAllCmsSites();
  const sites = sitesQuery.data ?? [];
  const siteOptions = sites.map((site) => ({ value: site.id, label: site.name }));
  const [activeTab, setActiveTab] = useUrlTabState(['queue', 'history', 'artifacts', 'failed'] as const, 'queue');
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [submitted, setSubmitted] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<number[]>([]);
  const taskPagination = usePagination();
  const artifactPagination = usePagination();
  // 产物页按通道筛选：通道随所选站点变化，未选站点时不可用

  const taskStatus = activeTab === 'queue' ? 'active' : activeTab === 'failed' ? 'failed' : 'terminal';
  const taskListQuery = useCmsPublishingList({
    page: taskPagination.page,
    pageSize: taskPagination.pageSize,
    ...submitted,
    status: taskStatus,
  }, activeTab !== 'artifacts');
  const artifactListQuery = useCmsPublishArtifactList({
    page: artifactPagination.page,
    pageSize: artifactPagination.pageSize,
    siteId: submitted.siteId,
    targetType: submitted.targetType,
    startTime: submitted.startTime,
    endTime: submitted.endTime,
    keyword: submitted.keyword || undefined,
  }, activeTab === 'artifacts');
  const tasks = taskListQuery.data?.list ?? [];
  const artifacts = artifactListQuery.data?.list ?? [];

  // Keep the id independent from the currently loaded tab. Artifact rows can
  // point to a task that is not present in the history page cache.
  const [detailTaskId, setDetailTaskId] = useState<number | null>(null);
  const openTaskDetail = (taskId: number) => setDetailTaskId(taskId);
  const closeTaskDetail = () => setDetailTaskId(null);
  const detailQuery = useCmsPublishingDetail(detailTaskId ?? undefined, detailTaskId != null);
  const actionMutation = useCmsPublishingAction();
  const batchMutation = useBatchCmsPublishingAction();
  const submitMutation = useSubmitCmsPublish();
  const [submitVisible, setSubmitVisible] = useState(false);
  const [submitForm, setSubmitForm] = useState({
    siteId: undefined as number | undefined,
    targetType: 'site' as CmsPublishTargetType,
    contentIds: '',
    channelId: '',
    pageId: '',
    reason: '',
  });

  useTaskProgressEvents(useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: cmsPublishingKeys.all });
  }, [queryClient]));

  const applySearch = () => {
    setSubmitted(draft);
    taskPagination.setPage(1);
    artifactPagination.setPage(1);
    setSelected([]);
    void queryClient.invalidateQueries({ queryKey: cmsPublishingKeys.lists });
    void queryClient.invalidateQueries({ queryKey: cmsPublishingKeys.artifacts });
  };

  const resetSearch = () => {
    setDraft(EMPTY_FILTERS);
    setSubmitted(EMPTY_FILTERS);
    taskPagination.setPage(1);
    artifactPagination.setPage(1);
    setSelected([]);
    void queryClient.invalidateQueries({ queryKey: cmsPublishingKeys.lists });
    void queryClient.invalidateQueries({ queryKey: cmsPublishingKeys.artifacts });
  };

  const runAction = async (record: CmsPublishingTask, action: 'cancel' | 'resume' | 'restart' | 'rebuild') => {
    await actionMutation.mutateAsync({ params: { id: record.id, action } });
    Toast.success(action === 'cancel' ? '已请求取消' : action === 'resume' ? '已从断点恢复' : '已重新提交执行');
  };

  const runBatch = (action: 'cancel' | 'resume' | 'restart' | 'rebuild') => {
    if (!selected.length) return;
    Modal.confirm({
      title: '批量操作发布任务',
      content: `将对选中的 ${selected.length} 个发布任务执行「${action}」，不满足状态条件的任务会返回可行动错误。`,
      onOk: async () => {
        const result = await batchMutation.mutateAsync({ body: { ids: selected, action } });
        if (result.errors.length) {
          Toast.warning(`已处理 ${result.affected} 个，${result.errors.length} 个失败：${result.errors[0]?.message ?? '请刷新后重试'}`);
        } else {
          Toast.success(`已处理 ${result.affected} 个任务`);
        }
        setSelected([]);
      },
    });
  };

  const submitBuild = async () => {
    if (!submitForm.siteId) return Toast.warning('请选择站点');
    const contentIds = submitForm.contentIds.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0);
    await submitMutation.mutateAsync({
      body: {
        siteId: submitForm.siteId,
        targetType: submitForm.targetType,
        contentIds: ['content', 'contents'].includes(submitForm.targetType) ? contentIds : undefined,
        channelId: submitForm.targetType === 'channel' ? Number(submitForm.channelId) || undefined : undefined,
        pageId: submitForm.targetType === 'page' ? Number(submitForm.pageId) || undefined : undefined,
        reason: submitForm.reason || undefined,
      },
    });
    Toast.success('发布任务已提交');
    setSubmitVisible(false);
  };

  const taskColumns: ColumnProps<CmsPublishingTask>[] = [
    { title: '任务ID', dataIndex: 'id', width: 90 },
    {
      title: '任务', dataIndex: 'title', width: 240,
      render: (_: string, record) => <div><Typography.Text strong>{record.title}</Typography.Text><div><Typography.Text type="tertiary" size="small">{record.taskType}</Typography.Text></div></div>,
    },
    { title: '站点', dataIndex: 'siteName', minWidth: 140, render: (value: string | null) => value ?? '-' },
    { title: '目标', dataIndex: 'targetType', width: 120, render: (value: CmsPublishTargetType) => CMS_PUBLISH_TARGET_TYPE_LABELS[value] },
    { title: '进度', width: 220, render: (_: unknown, record) => <AsyncTaskProgress task={record} /> },
    { title: '产物', width: 110, render: (_: unknown, record) => record.failedArtifactCount ? <Typography.Text type="danger">{record.artifactCount}（失败 {record.failedArtifactCount}）</Typography.Text> : record.artifactCount },
    { title: '创建人', dataIndex: 'createdByName', width: 120, render: (value: string | null) => value ?? '-' },
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 110, fixed: 'right',
      render: (value: CmsPublishingTask['status'], record) => {
        const meta = ASYNC_TASK_STATUS_TAG_MAP[value];
        return <Tag color={record.cancelRequested && value === 'running' ? 'orange' : meta.color}>{record.cancelRequested && value === 'running' ? '取消中' : meta.label}</Tag>;
      },
    },
    createOperationColumn<CmsPublishingTask>({
      // 取消 / 断点恢复 / 重新开始 / 重建 随任务状态出现，进更多；行内只保留详情
      width: 120,
      desktopInlineKeys: ['detail'],
      actions: (record) => [
        { key: 'detail', label: '详情', onClick: () => openTaskDetail(record.id) },
        { key: 'cancel', label: '取消', danger: true, onClick: () => runAction(record, 'cancel'), hidden: !['pending', 'running'].includes(record.status), disabled: !canManage, disabledReason: '缺少发布管理权限' },
        { key: 'resume', label: '断点恢复', onClick: () => runAction(record, 'resume'), hidden: !['failed', 'cancelled'].includes(record.status), disabled: !canManage, disabledReason: '缺少发布管理权限' },
        { key: 'restart', label: '重新开始', onClick: () => runAction(record, 'restart'), hidden: !['success', 'failed', 'cancelled'].includes(record.status), disabled: !canManage, disabledReason: '缺少发布管理权限' },
        { key: 'rebuild', label: '重建', onClick: () => runAction(record, 'rebuild'), hidden: record.status !== 'success', disabled: !canManage, disabledReason: '缺少发布管理权限' },
      ],
    }),
  ];

  const artifactColumns: ColumnProps<CmsPublishArtifact>[] = [
    { title: '任务ID', dataIndex: 'taskId', width: 100 },
    { title: '目标', dataIndex: 'targetType', width: 120, render: (value: CmsPublishTargetType) => CMS_PUBLISH_TARGET_TYPE_LABELS[value] },
    { title: '路径', dataIndex: 'path', minWidth: 320, render: renderEllipsis },
    { title: 'URL', dataIndex: 'url', width: 320, render: renderEllipsis },
    { title: '大小', dataIndex: 'size', width: 100, align: 'right', render: (value: number | null) => value == null ? '-' : `${value} B` },
    dateTimeColumn('生成时间', 'generatedAt'),
    {
      title: '状态', dataIndex: 'status', width: 110, fixed: 'right',
      render: (value: CmsPublishArtifactStatus) => <Tag color={value === 'generated' ? 'green' : value === 'failed' ? 'red' : 'grey'}>{CMS_PUBLISH_ARTIFACT_STATUS_LABELS[value]}</Tag>,
    },
    createOperationColumn<CmsPublishArtifact>({
      desktopInlineKeys: ['task'],
      width: 150,
      actions: (record) => [
        { key: 'error', label: '失败原因', hidden: !record.error, danger: true, onClick: () => { Modal.error({ title: '产物生成失败', content: record.error }); } },
        { key: 'task', label: '任务详情', onClick: () => openTaskDetail(record.taskId) },
      ],
    }),
  ];

  const dateValue = useMemo<[Date, Date] | undefined>(() => {
    if (!draft.startTime || !draft.endTime) return undefined;
    return [dayjs(draft.startTime).toDate(), dayjs(draft.endTime).toDate()];
  }, [draft.endTime, draft.startTime]);

  const primary = (
    <>
      <KeywordInput placeholder="任务/路径关键词" value={draft.keyword} onChange={(keyword) => setDraft((prev) => ({ ...prev, keyword }))} />
      <SearchButton onClick={applySearch} />
      <ResetButton onClick={resetSearch} />
      {selected.length > 0 && canManage ? (
        <>
          <Button type="warning" onClick={() => runBatch('cancel')}>批量取消（{selected.length}）</Button>
          <Button onClick={() => runBatch('resume')}>批量重试</Button>
          <Button onClick={() => runBatch('rebuild')}>批量重建</Button>
        </>
      ) : null}
    </>
  );

  const filters = (
    <>
      <FilterSelect
        placeholder="全部站点"
        items={siteOptions}
        value={draft.siteId}
        onChange={(value) => setDraft((prev) => ({ ...prev, siteId: value }))}
        width={150}
      />
      <FilterSelect
        placeholder="全部目标类型"
        items={CMS_PUBLISH_TARGET_TYPES.map((value) => ({ value, label: CMS_PUBLISH_TARGET_TYPE_LABELS[value] }))}
        value={draft.targetType}
        onChange={(value) => setDraft((prev) => ({ ...prev, targetType: value ? value as CmsPublishTargetType : undefined }))}
        width={150}
      />
      <Input placeholder="创建人" value={draft.createdBy} onChange={(createdBy) => setDraft((prev) => ({ ...prev, createdBy }))} style={{ width: 130 }} />
      <DateRangeFilter value={dateValue} onChange={(value) => {
          const range = Array.isArray(value) ? value : [];
          setDraft((prev) => ({
            ...prev,
            ...formatDateTimeRangeForApi(range),
          }));
        }} width={340} />
    </>
  );

  const taskExportQuery = {
    ...submitted,
    taskStatus: activeTab === 'queue' ? 'active' : activeTab === 'failed' ? 'failed' : 'terminal',
  };
  const artifactExportQuery = submitted as unknown as Record<string, unknown>;

  const taskActions = (
    <>
      {canBuild ? <CreateButton onClick={() => { setSubmitVisible(true); setSubmitForm((prev) => ({ ...prev, siteId: sites[0]?.id })); }}>新建发布</CreateButton> : null}
      <ExportButton entity="cms.publish-artifacts" permission="cms:publish:view" label="导出产物" query={taskExportQuery as unknown as Record<string, unknown>} />
      <ExportButton entity="cms.publish-logs" permission="cms:publish:view" label="导出日志" query={taskExportQuery as unknown as Record<string, unknown>} />
    </>
  );

  const artifactActions = (
    <>
      {canBuild ? <CreateButton onClick={() => { setSubmitVisible(true); setSubmitForm((prev) => ({ ...prev, siteId: sites[0]?.id })); }}>新建发布</CreateButton> : null}
      <ExportButton entity="cms.publish-artifacts" permission="cms:publish:view" label="导出产物" query={artifactExportQuery} />
      <ExportButton entity="cms.publish-logs" permission="cms:publish:view" label="导出日志" query={artifactExportQuery} />
    </>
  );

  const taskPane = (tab: Exclude<TabKey, 'artifacts'>) => (
    <>
      <SearchToolbar
        primary={primary}
        filters={filters}
        actions={taskActions}
        mobilePrimary={primary}
        mobileActions={(
          <>
            {canBuild ? <Button theme="borderless" type="primary" onClick={() => setSubmitVisible(true)}>新建发布</Button> : null}
            <ExportButton entity="cms.publish-artifacts" permission="cms:publish:view" label="导出产物" query={taskExportQuery as unknown as Record<string, unknown>} variant="flat" />
            <ExportButton entity="cms.publish-logs" permission="cms:publish:view" label="导出日志" query={taskExportQuery as unknown as Record<string, unknown>} variant="flat" />
          </>
        )}
        onFilterApply={applySearch}
        onFilterReset={resetSearch}
      />
      {taskListQuery.isError ? <Banner type="danger" description="发布任务加载失败，请确认站点权限或网络后刷新重试。" /> : null}
      {tab === 'failed' && taskListQuery.data?.list.length === 0 ? <Banner type="success" description="当前筛选范围内没有失败任务。" /> : null}
      <ConfigurableTable
        bordered
        rowKey={(record) => String(record?.id ?? '')}
        columns={taskColumns}
        dataSource={tasks}
        loading={taskListQuery.isFetching}
        pagination={taskPagination.buildPagination(taskListQuery.data?.total ?? 0, () => setSelected([]))}
        rowSelection={canManage ? { selectedRowKeys: selected.map(String), onChange: (keys) => setSelected((keys ?? []).map(Number)) } : undefined}
        onRefresh={() => void taskListQuery.refetch()}
        refreshLoading={taskListQuery.isFetching}
      />
    </>
  );

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" type="line" activeKey={activeTab} onChange={(key) => { setActiveTab(key as TabKey); setSelected([]); }}>
        <TabPane tab="队列" itemKey="queue">{taskPane('queue')}</TabPane>
        <TabPane tab="历史" itemKey="history">{taskPane('history')}</TabPane>
        <TabPane tab="产物" itemKey="artifacts">
          <SearchToolbar
            primary={primary}
            filters={filters}
            actions={artifactActions}
            mobilePrimary={primary}
            mobileActions={artifactActions}
            onFilterApply={applySearch}
            onFilterReset={resetSearch}
          />
          {artifactListQuery.isError ? <Banner type="danger" description="发布产物加载失败，请确认任务/站点权限后刷新重试。" /> : null}
          <ConfigurableTable
            bordered
            rowKey={(record) => String(record?.id ?? '')}
            columns={artifactColumns}
            dataSource={artifacts}
            loading={artifactListQuery.isFetching}
            pagination={artifactPagination.buildPagination(artifactListQuery.data?.total ?? 0)}
            onRefresh={() => void artifactListQuery.refetch()}
            refreshLoading={artifactListQuery.isFetching}
          />
        </TabPane>
        <TabPane tab="失败" itemKey="failed">{taskPane('failed')}</TabPane>
      </Tabs>

      <AppModal title="新建 CMS 发布" visible={submitVisible} onCancel={() => setSubmitVisible(false)} onOk={() => void submitBuild()} confirmLoading={submitMutation.isPending} width={560} closeOnEsc>
        <Form labelPosition="left" labelWidth={90}>
          <Space vertical spacing={12} style={{ width: '100%' }}>
          <Select prefix="站点" optionList={siteOptions} value={submitForm.siteId} onChange={(value) => setSubmitForm((prev) => ({ ...prev, siteId: Number(value) }))} style={{ width: '100%' }} />
          <Select prefix="目标" optionList={CMS_PUBLISH_TARGET_TYPES.filter((value) => ['content', 'contents', 'channel', 'site', 'page'].includes(value)).map((value) => ({ value, label: CMS_PUBLISH_TARGET_TYPE_LABELS[value] }))} value={submitForm.targetType} onChange={(value) => setSubmitForm((prev) => ({ ...prev, targetType: value as CmsPublishTargetType }))} style={{ width: '100%' }} />
          {['content', 'contents'].includes(submitForm.targetType) ? <Input prefix="内容 ID" placeholder="逗号分隔，如 1,2,3" value={submitForm.contentIds} onChange={(contentIds) => setSubmitForm((prev) => ({ ...prev, contentIds }))} /> : null}
          {submitForm.targetType === 'channel' ? <Input prefix="栏目 ID" value={submitForm.channelId} onChange={(channelId) => setSubmitForm((prev) => ({ ...prev, channelId }))} /> : null}
          {submitForm.targetType === 'page' ? <Input prefix="页面 ID" value={submitForm.pageId} onChange={(pageId) => setSubmitForm((prev) => ({ ...prev, pageId }))} /> : null}
          <Input prefix="原因" placeholder="可选，便于任务审计" value={submitForm.reason} onChange={(reason) => setSubmitForm((prev) => ({ ...prev, reason }))} />
          <Banner type="info" description="任务复用通用 async_tasks 队列；相同活动任务会复用，已结束任务可再次合法重建，并支持进度、取消、断点恢复与自动重试。" />
          </Space>
        </Form>
      </AppModal>

      <SideSheet title={detailTaskId != null ? `发布详情 #${detailTaskId}` : '发布详情'} visible={detailTaskId != null} onCancel={closeTaskDetail} width={760}>
        {detailQuery.isError ? (
          <Banner type="danger" description="详情加载失败。请确认任务仍存在且你拥有该站点访问权限。" />
        ) : detailQuery.data ? (
          <Space vertical spacing={16} style={{ width: '100%' }}>
            <Descriptions
              data={[
                { key: '任务', value: detailQuery.data.task.title },
                { key: '站点', value: detailQuery.data.task.siteName ?? String(detailQuery.data.task.siteId) },
                { key: '目标', value: CMS_PUBLISH_TARGET_TYPE_LABELS[detailQuery.data.task.targetType] },
                { key: '状态', value: ASYNC_TASK_STATUS_TAG_MAP[detailQuery.data.task.status].label },
                { key: '执行次数', value: `${detailQuery.data.task.attempts}/${detailQuery.data.task.maxAttempts}` },
                { key: '创建时间', value: formatDateTime(detailQuery.data.task.createdAt) },
              ]}
            />
            <AsyncTaskProgress task={detailQuery.data.task} />
            {detailQuery.data.task.errorMessage ? <Banner type="danger" icon={<XCircle size={16} />} description={`${detailQuery.data.task.errorMessage}；可选择断点恢复或重新开始。`} /> : null}
            <Typography.Title heading={6}>逐路径明细</Typography.Title>
            {detailQuery.data.items.length ? detailQuery.data.items.map((item) => (
              <div key={item.id} style={{ padding: 10, borderBottom: '1px solid var(--semi-color-border)' }}>
                <Typography.Text strong>{item.label ?? item.itemKey}</Typography.Text>
                <div><Typography.Text type={item.status === 'failed' ? 'danger' : 'tertiary'} size="small">{item.message ?? item.status}</Typography.Text></div>
              </div>
            )) : <Typography.Text type="tertiary">暂无逐路径明细</Typography.Text>}
            <Typography.Title heading={6}>产物</Typography.Title>
            {detailQuery.data.artifacts.length ? detailQuery.data.artifacts.map((artifact) => (
              <div key={artifact.id} style={{ padding: 10, borderBottom: '1px solid var(--semi-color-border)' }}>
                <Typography.Text code>{artifact.path}</Typography.Text> <Tag color={artifact.status === 'failed' ? 'red' : 'green'}>{CMS_PUBLISH_ARTIFACT_STATUS_LABELS[artifact.status]}</Tag>
                {artifact.error ? <div><Typography.Text type="danger" size="small">{artifact.error}</Typography.Text></div> : null}
              </div>
            )) : <Typography.Text type="tertiary">暂无产物</Typography.Text>}
          </Space>
        ) : <Typography.Text>加载中…</Typography.Text>}
      </SideSheet>
    </div>
  );
}
