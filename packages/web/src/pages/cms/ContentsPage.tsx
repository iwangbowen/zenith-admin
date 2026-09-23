import { lazy, Suspense, useRef, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Tag, Toast, Tooltip, Modal, Tabs, TabPane, Tree, TreeSelect, Typography, Dropdown, Form, SplitButtonGroup, Space, Select } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { ChevronDown, Image as ImageIcon, Film, Paperclip, FolderTree } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import AppModal from '@/components/AppModal';
import { ExportButton } from '@/components/ExportButton';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import ImportButton from '@/components/ImportButton';
import {
  useCmsChannelTree, useCmsContentList, useCmsContentAction, useCmsContentBatch,
  useAllCmsSites, useAllCmsTags, useCmsContentBatchOps, useCmsContentBatchStatus, useDuplicateCmsContent, cmsContentKeys,
  useCmsContentPersistentLock, useAllCmsModels, useCmsEditorialMetrics, useSuppressCmsContent, useUnsuppressCmsContent,
} from '@/hooks/queries/cms';
import { CMS_CONTENT_STATUS_LABELS, CMS_CONTENT_TYPE_LABELS, CMS_CONTENT_TYPE_OPTIONS } from '@zenith/shared/cms';
import type { CmsChannel, CmsContentListItem, CmsContentStatus, CmsContentType, CmsEditorialStatus, CmsModelField } from '@zenith/shared/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { CmsWidgetSourceRefsSheet, type CmsWidgetSourceTarget } from './CmsWidgetSourceRefsSheet';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, DateRangeFilter } from '@/components/search-filters';
import { DATE_TIME_COLUMN_WIDTH, EMPTY_PLACEHOLDER, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import OverflowTagList, { type OverflowTagItem } from '@/components/OverflowTagList';
import { abortSubmit } from '@/lib/abort-submit';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { useAuth } from '@/hooks/useAuth';
import { useAllUsers } from '@/hooks/queries/users';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { copyTextWithToast } from '@/utils/clipboard';
import { CMS_EDITORIAL_STATUS_LABELS, CMS_EDITORIAL_STATUS_COLORS } from './cms-content-view-state';
import CmsContentCalendar from './CmsContentCalendar';
import { cmsFieldDisplayText } from './cms-field-display';

import { useUrlTabState } from '@/hooks/useUrlTabState';
import { channelsToSelectTree } from './channel-tree';
import { mapTree } from '@zenith/shared/core';
import { confirmAndDelete, deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
const STATUS_COLORS: Record<CmsContentStatus, 'grey' | 'orange' | 'green' | 'red' | 'violet'> = {
  draft: 'grey',
  pending: 'orange',
  published: 'green',
  offline: 'violet',
  rejected: 'red',
};
const CmsContentWorkflowSheet = lazy(() => import('./CmsContentWorkflowSheet'));

type TabKey = 'all' | 'pending' | 'published' | 'archived' | 'recycle' | 'calendar';
interface ContentFilters { keyword: string; modelId?: number; ownerId?: number; locale: string; editorialStatus?: CmsEditorialStatus; hasUnpublishedChanges?: boolean; tags?: string; timeRange: [Date, Date] | null }
const DEFAULT_FILTERS: ContentFilters = { keyword: '', locale: '', timeRange: null };
interface SavedContentView { name: string; filters: ContentFilters; channelId?: number; contentType?: CmsContentType; tab?: TabKey }


/** 栏目筛选树：仅 key / label，不带 value */
function channelsToTree(nodes: CmsChannel[]): TreeNodeData[] {
  return mapTree<CmsChannel, TreeNodeData>(nodes, (n) => ({ key: String(n.id), label: n.name }));
}

/** 标题列的标记标签：顶 / 类型 / 荐 / 热 / 投稿 / 映射 / 锁定 / 原创 / 附件数（一篇文章可同时命中多枚） */
function titleFlagItems(record: CmsContentListItem): OverflowTagItem[] {
  const items: OverflowTagItem[] = [];
  if (record.isTop) items.push({ key: 'top', label: record.topWeight > 0 ? `顶${record.topWeight}` : '顶', color: 'blue' });
  if (record.contentType !== 'article') items.push({ key: 'type', label: CMS_CONTENT_TYPE_LABELS[record.contentType], color: 'light-blue' });
  if (record.isRecommend) items.push({ key: 'recommend', label: '荐', color: 'cyan' });
  if (record.isHot) items.push({ key: 'hot', label: '热', color: 'red' });
  if (record.memberId) items.push({ key: 'contribute', label: '投稿', color: 'purple' });
  if (record.mappingSourceId) items.push({ key: 'mapping', label: '映射', color: 'teal' });
  if (record.lockedAt) items.push({ key: 'locked', label: '锁定', color: 'red' });
  if (record.isOriginal) items.push({ key: 'original', label: '原创', color: 'green' });
  if (record.attachments?.length) items.push({ key: 'attachments', label: `附${record.attachments.length}`, color: 'grey' });
  return items;
}

export default function ContentsPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const [urlParams] = useSearchParams();
  const { user } = useAuth();
  const { data: users } = useAllUsers();
  const queryClient = useQueryClient();

  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useUrlTabState(['all', 'pending', 'published', 'archived', 'recycle', 'calendar'] as const, 'all');
  const [channelId, setChannelId] = useState<number | undefined>(undefined);
  const [contentType, setContentType] = useState<CmsContentType | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  // 栏目 / 类型为即时筛选，仅关键字走「草稿 → 查询」；重置时一并清空即时筛选与选中行
  const {
    page, pageSize, setPage, buildPagination,
    bind, bindKeyword, submittedParams, handleSearch, handleReset, applySearch,
  } = useListSearch<ContentFilters>({
    defaults: DEFAULT_FILTERS,
    listKey: cmsContentKeys.lists,
    onSearch: () => setSelectedIds([]),
    onReset: () => { setChannelId(undefined); setContentType(undefined); setSelectedIds([]); },
  });
  const [widgetSourceTarget, setWidgetSourceTarget] = useState<CmsWidgetSourceTarget | null>(null);
  const [workflowTarget, setWorkflowTarget] = useState<CmsContentListItem | null>(null);
  // 窄屏单栏模式下的栏目树显隐（MasterDetailLayout 响应式）
  const [showChannelTree, setShowChannelTree] = useState(false);
  const [isLayoutNarrow, setIsLayoutNarrow] = useState(false);

  const treeQuery = useCmsChannelTree(siteId);
  const { data: sites } = useAllCmsSites();
  const { data: models } = useAllCmsModels(siteId);
  const metrics = useCmsEditorialMetrics(siteId);
  const suppressMutation = useSuppressCmsContent();
  const unsuppressMutation = useUnsuppressCmsContent();
  const viewStorageKey = `cms-content-views:${user?.id ?? 0}:${siteId ?? 0}`;
  const [savedViews, setSavedViews] = useState<SavedContentView[]>([]);
  const [selectedView, setSelectedView] = useState<string>();
  useEffect(() => {
    setSelectedView(undefined);
    try { const stored: unknown = JSON.parse(localStorage.getItem(viewStorageKey) ?? '[]'); setSavedViews(Array.isArray(stored) ? stored.filter((view) => typeof view?.name === 'string' && view.filters) : []); } catch { setSavedViews([]); }
  }, [viewStorageKey]);
  const appliedUrlView = useRef<string | undefined>(undefined);
  useEffect(() => {
    const raw = urlParams.get('view');
    if (!raw || appliedUrlView.current === raw) return;
    appliedUrlView.current = raw;
    try {
      const parsed = JSON.parse(raw) as Partial<ContentFilters> & { siteId?: number; channelId?: number; contentType?: CmsContentType; tab?: TabKey };
      if (parsed.siteId) setSiteId(parsed.siteId);
      setChannelId(parsed.channelId); setContentType(parsed.contentType);
      if (parsed.tab && ['all', 'pending', 'published', 'archived', 'recycle', 'calendar'].includes(parsed.tab)) setActiveTab(parsed.tab);
      applySearch({ ...DEFAULT_FILTERS, ...parsed, timeRange: parsed.timeRange ? [new Date(String(parsed.timeRange[0])), new Date(String(parsed.timeRange[1]))] : null });
    } catch { Toast.warning('无法读取分享视图'); }
  }, [urlParams, applySearch, setActiveTab]);
  function saveView() {
    let name = '';
    Modal.confirm({ title: '保存当前筛选视图', content: <Input placeholder="视图名称" maxLength={50} onChange={(value) => { name = value; }} />, onOk: () => {
      if (!name.trim()) { Toast.warning('请输入名称'); abortSubmit('validation'); }
      const next = [...savedViews.filter((view) => view.name !== name.trim()), { name: name.trim(), filters: submittedParams, channelId, contentType, tab: activeTab }];
      localStorage.setItem(viewStorageKey, JSON.stringify(next)); setSavedViews(next); setSelectedView(name.trim());
    } });
  }
  function emergencyVisibility(record: CmsContentListItem, action: 'suppress' | 'unsuppress') {
    let reason = '';
    Modal.confirm({ title: action === 'suppress' ? '紧急撤下内容' : '解除紧急撤下', content: <Input placeholder="请填写操作原因" maxLength={1000} onChange={(value) => { reason = value; }} />, onOk: async () => {
      if (!reason.trim()) { Toast.warning('请填写原因'); abortSubmit('validation'); }
      await (action === 'suppress' ? suppressMutation : unsuppressMutation).mutateAsync({ params: { id: record.id }, body: { reason: reason.trim() } });
      Toast.success(action === 'suppress' ? '源站访问已阻止，外部缓存刷新进入队列' : '已解除紧急撤下门禁');
    } });
  }

  function handleSiteChange(next: number) {
    setSiteId(next);
    setChannelId(undefined);
    setPage(1);
    setSelectedIds([]);
  }

  const statusFilter: CmsContentStatus | undefined =
    activeTab === 'published' ? 'published' : undefined;

  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useFilterQuery({
    siteId: siteId ?? 0, channelId, status: statusFilter, contentType,
    keyword: submittedParams.keyword, modelId: submittedParams.modelId, ownerId: submittedParams.ownerId,
    locale: submittedParams.locale, tags: submittedParams.tags, hasUnpublishedChanges: submittedParams.hasUnpublishedChanges,
    editorialStatus: activeTab === 'pending' ? 'pending' as const : submittedParams.editorialStatus,
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
    deleted: activeTab === 'recycle' ? true : undefined, archived: activeTab === 'archived' ? true : undefined,
  });
  const listQuery = useCmsContentList({
    page,
    pageSize,
    ...filterQuery,
    siteId: siteId ?? 0,
  }, siteId !== undefined && activeTab !== 'calendar');
  const list = listQuery.data?.list ?? [];
  const listModelFields = new Map<string, { modelId: number; modelName: string; field: CmsModelField }>();
  for (const record of list) {
    if (!record.modelId) continue;
    for (const field of (record.modelFields ?? []).filter((item) => item.showInList)) listModelFields.set(`${record.modelId}:${field.name}`, { modelId: record.modelId, modelName: models?.find((model) => model.id === record.modelId)?.name ?? '内容模型', field });
  }
  const versionsFor = (ids: number[]) => Object.fromEntries(ids.map((id) => [String(id), list.find((record) => record.id === id)?.version ?? 0]));

  const actionMutation = useCmsContentAction();
  const batchMutation = useCmsContentBatch();
  const batchOpsMutation = useCmsContentBatchOps();
  const batchStatusMutation = useCmsContentBatchStatus();
  const duplicateMutation = useDuplicateCmsContent();
  const persistentLockMutation = useCmsContentPersistentLock();
  const { data: allTags } = useAllCmsTags(siteId);
  // useEditModal 例外：以下三个是选中内容的批量操作参数表单（移动 / 打标 / 分发），非实体新增 / 编辑弹窗
  const moveFormApi = useRef<FormApi | null>(null);
  const tagFormApi = useRef<FormApi | null>(null);
  const distributeFormApi = useRef<FormApi | null>(null);
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [distributeModalVisible, setDistributeModalVisible] = useState(false);
  const [distributeTargetSiteId, setDistributeTargetSiteId] = useState<number | undefined>(undefined);
  // 复制到其他栏目（同站）：选中待复制内容与目标栏目
  const [copyTarget, setCopyTarget] = useState<CmsContentListItem | null>(null);
  const [copyChannelId, setCopyChannelId] = useState<number | undefined>(undefined);
  const distributeTargetTreeQuery = useCmsChannelTree(distributeTargetSiteId);

  function handleTabChange(key: string) {
    setActiveTab(key as TabKey);
    setPage(1);
    setSelectedIds([]);
  }

  async function runAction(id: number, action: 'submit' | 'publish' | 'offline', successMsg: string) {
    await actionMutation.mutateAsync({ id, action, expectedVersion: list.find((record) => record.id === id)!.version });
    Toast.success(action === 'publish' ? '已提交发布任务，请在发布中心查看生效结果' : successMsg);
  }

  function handleReject(record: CmsContentListItem) {
    let reason = '';
    Modal.confirm({
      title: `驳回「${record.title}」`,
      content: (
        <Input placeholder="请输入驳回原因" onChange={(v) => { reason = v; }} />
      ),
      onOk: async () => {
        if (!reason.trim()) {
          Toast.warning('请输入驳回原因');
          abortSubmit('validation');
        }

        await actionMutation.mutateAsync({ id: record.id, action: 'reject', reason, expectedVersion: record.version });
        Toast.success('已驳回');
      },
    });
  }

  function handlePersistentLock(record: CmsContentListItem) {
    if (record.lockedAt) {
      Modal.confirm({
        title: `解除「${record.title}」的持久锁？`,
        content: '解锁后内容可再次编辑和流转；已取消的计划发布时间不会自动恢复。',
        onOk: async () => {
          await persistentLockMutation.mutateAsync({ id: record.id, action: 'unlock', expectedVersion: record.version });
          Toast.success('已解除持久锁');
        },
      });
      return;
    }
    let reason = '';
    Modal.confirm({
      title: `持久锁定「${record.title}」`,
      content: <Input placeholder="请输入合规锁定原因" maxLength={500} onChange={(value) => { reason = value; }} />,
      onOk: async () => {
        if (!reason.trim()) {
          Toast.warning('请输入锁定原因');
          abortSubmit('validation');
        }
        await persistentLockMutation.mutateAsync({ id: record.id, action: 'lock', reason: reason.trim(), expectedVersion: record.version });
        Toast.success('内容已持久锁定');
      },
    });
  }

  async function runBatch(action: 'recycle' | 'restore' | 'purge' | 'archive' | 'unarchive', ids: number[], successMsg: string) {
    await batchMutation.mutateAsync({ action, ids, expectedVersions: versionsFor(ids) });
    setSelectedIds([]);
    Toast.success(successMsg);
  }

  /** 批量状态流转：部分成功时逐条明示失败原因（欠提示比误吞更危险） */
  async function runBatchStatus(action: 'submit' | 'publish' | 'reject' | 'offline', label: string, reason?: string) {
    const result = await batchStatusMutation.mutateAsync({ body: { ids: selectedIds, action, reason, expectedVersions: versionsFor(selectedIds) } });
    setSelectedIds([]);
    if (result.failed.length === 0) {
      Toast.success(action === 'publish' ? `已提交 ${result.okIds.length} 条发布任务，生效结果请在发布中心查看` : `已${label} ${result.okIds.length} 条内容`);
      return;
    }
    Modal.warning({
      title: `${label}完成：成功 ${result.okIds.length} 条，失败 ${result.failed.length} 条`,
      content: (
        <ul style={{ maxHeight: 240, overflow: 'auto', paddingLeft: 18 }}>
          {result.failed.map((f) => <li key={f.id}>#{f.id}：{f.reason}</li>)}
        </ul>
      ),
    });
  }

  function confirmBatchStatus(action: 'submit' | 'publish' | 'offline', label: string, content: string) {
    Modal.confirm({
      title: `${label} ${selectedIds.length} 条内容？`,
      content,
      onOk: () => runBatchStatus(action, label),
    });
  }

  function handleBatchReject() {
    let reason = '';
    Modal.confirm({
      title: `批量驳回 ${selectedIds.length} 条内容`,
      content: <Input placeholder="请输入驳回原因（对全部选中内容生效）" maxLength={500} onChange={(value) => { reason = value; }} />,
      onOk: async () => {
        if (!reason.trim()) {
          Toast.warning('请输入驳回原因');
          abortSubmit('validation');
        }
        await runBatchStatus('reject', '批量驳回', reason.trim());
      },
    });
  }

  // ─── P3 批量操作 ──────────────────────────────────────────────────────────
  async function handleBatchFlags(flags: Record<string, boolean>, label: string) {
    await batchOpsMutation.mutateAsync({ action: 'batch-flags', body: { ids: selectedIds, expectedVersions: versionsFor(selectedIds), ...flags } });
    setSelectedIds([]);
    Toast.success(`已${label} ${selectedIds.length} 条内容`);
  }

  /** 行级标记快捷切换（置顶/推荐/热门/原创，复用 batch-flags 单条调用） */
  async function handleRowFlag(record: CmsContentListItem, flag: 'isTop' | 'isRecommend' | 'isHot' | 'isOriginal', label: string) {
    const next = !record[flag];
    await batchOpsMutation.mutateAsync({ action: 'batch-flags', body: { ids: [record.id], expectedVersions: { [String(record.id)]: record.version }, [flag]: next } });
    Toast.success(`「${record.title}」${next ? '已' : '已取消'}${label}`);
  }

  async function handleBatchMoveOk() {
    const values = await moveFormApi.current?.validate().catch(() => null);
    if (!values?.channelId) abortSubmit('validation');
    await batchOpsMutation.mutateAsync({ action: 'batch-move', body: { ids: selectedIds, expectedVersions: versionsFor(selectedIds), channelId: values.channelId } });
    setSelectedIds([]);
    setMoveModalVisible(false);
    Toast.success('移动成功');
  }

  async function handleBatchTagOk() {
    const values = await tagFormApi.current?.validate().catch(() => null);
    if (!values?.tagIds || (values.tagIds as number[]).length === 0) abortSubmit('validation');
    await batchOpsMutation.mutateAsync({ action: 'batch-tag', body: { ids: selectedIds, expectedVersions: versionsFor(selectedIds), tagIds: values.tagIds } });
    setSelectedIds([]);
    setTagModalVisible(false);
    Toast.success('打标成功');
  }

  async function handleDistributeOk() {
    const values = await distributeFormApi.current?.validate().catch(() => null);
    if (!values?.targetSiteId || !values?.targetChannelId) abortSubmit('validation');
    await batchOpsMutation.mutateAsync({ action: 'distribute', body: { ids: selectedIds, targetSiteId: values.targetSiteId, targetChannelId: values.targetChannelId } });
    setSelectedIds([]);
    setDistributeModalVisible(false);
    Toast.success('分发成功（已在目标站点草稿箱创建独立快照）');
  }

  function previewContent(record: CmsContentListItem) {
    if (!record.previewUrl) {
      Toast.warning('当前内容暂无可用的预览地址');
      return;
    }
    window.open(record.previewUrl, '_blank');
  }

  const columns: ColumnProps<CmsContentListItem>[] = [
    {
      title: '标题',
      dataIndex: 'title',
      minWidth: 400,
      render: (v: string, record) => {
        const flags = titleFlagItems(record);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            {flags.length > 0 && (
              // 标记最多九枚（顶 / 类型 / 荐 / 热 / 投稿 / 映射 / 锁定 / 原创 / 附件数），放不下的收进 +N
              <div style={{ flex: '0 0 auto', maxWidth: '60%', minWidth: 0 }}>
                <OverflowTagList items={flags} contentWidth="100%" tagSize="small" popoverWidth={280} />
              </div>
            )}
            <Typography.Text
              ellipsis={{ showTooltip: true }}
              style={{
                flex: '1 1 auto',
                minWidth: 0,
                maxWidth: 360,
                ...(record.titleStyle?.bold ? { fontWeight: 700 } : {}),
                ...(record.titleStyle?.color ? { color: record.titleStyle.color } : {}),
              }}
            >
              {v}
            </Typography.Text>
          </div>
        );
      },
    },
    // 栏目名可达 190+px（如 QA-CMS-20260923-核验栏目），110 定宽下折成三行：按内容宽加宽并单行省略
    { title: '栏目', dataIndex: 'channelName', width: 240, render: renderEllipsis },
    {
      title: '属性', dataIndex: 'hasImage', width: 90,
      render: (_: boolean, record) => {
        const icons = [
          record.hasImage ? <ImageIcon key="img" size={14} aria-label="含图" /> : null,
          record.hasVideo ? <Film key="video" size={14} aria-label="含视频" /> : null,
          record.hasAttachment ? <Paperclip key="attach" size={14} aria-label="含附件" /> : null,
        ].filter(Boolean);
        return icons.length > 0
          ? <span style={{ display: 'inline-flex', gap: 6, color: 'var(--semi-color-text-2)' }}>{icons}</span>
          : EMPTY_PLACEHOLDER;
      },
    },
    { title: '语言', dataIndex: 'locale', width: 90 },
    { title: '负责人', dataIndex: 'ownerId', width: 110, render: (value: number | null) => users?.find((user) => user.id === value)?.nickname ?? EMPTY_PLACEHOLDER },
    dateTimeColumn('审稿截止', 'dueAt'),
    { title: '作者', dataIndex: 'author', width: 90, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    { title: '浏览', dataIndex: 'viewCount', width: 80, align: 'right' },
    { title: '赞/藏', dataIndex: 'likeCount', width: 90, align: 'right', render: (_: number, record) => `${record.likeCount}/${record.favoriteCount}` },
    {
      title: '发布时间', dataIndex: 'publishedAt', width: DATE_TIME_COLUMN_WIDTH,
      render: (v: string | null, record) => {
        if (v) return v;
        if (record.status !== 'published' && record.scheduledAt) {
          return (
            <Typography.Text type="tertiary" size="small">
              定时 {record.scheduledAt.slice(5, 16)}
            </Typography.Text>
          );
        }
        return EMPTY_PLACEHOLDER;
      },
    },
    dateTimeColumn('更新时间', 'updatedAt'),
    ...[...listModelFields.values()].map(({ modelId, modelName, field }): ColumnProps<CmsContentListItem> => ({
      // 模型自定义字段列：列头是「模型名 · 字段名」（模型名可达 30+ 字符），列级 ellipsis
      // 让表头与单元格都单行省略，表头还能靠原生 title 悬停看全名
      key: `model-${modelId}-${field.name}`, title: `${modelName} · ${field.label}`, width: 220, ellipsis: true,
      render: (_value: unknown, record) => {
        if (record.modelId !== modelId) return EMPTY_PLACEHOLDER;
        const value = record.listFields?.[field.name];
        if (value == null || value === '') return EMPTY_PLACEHOLDER;
        if (typeof value === 'boolean') return value ? '是' : '否';
        const rowField = record.modelFields?.find((item) => item.name === field.name);
        return <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 150 }}>{cmsFieldDisplayText(value, rowField)}</Typography.Text>;
      },
    })),
    {
      title: '线上 / 编辑状态',
      dataIndex: 'status',
      width: 210,
      fixed: 'right',
      render: (v: CmsContentStatus, record) => (
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <Space wrap spacing={4}><Tag size="small" color={STATUS_COLORS[v]}>{CMS_CONTENT_STATUS_LABELS[v]}</Tag><Tag size="small" color={CMS_EDITORIAL_STATUS_COLORS[record.editorialStatus]}>{CMS_EDITORIAL_STATUS_LABELS[record.editorialStatus]}</Tag>{record.hasUnpublishedChanges ? <Tag size="small" color="orange">有修改</Tag> : null}</Space>
          {v !== 'published' && record.scheduledAt ? (
            <Tooltip content={`定时发布：${record.scheduledAt}`}>
              <Tag size="small" color="blue">定时</Tag>
            </Tooltip>
          ) : null}
          {v === 'published' && record.expireAt ? (
            <Tooltip content={`到期下线：${record.expireAt}`}>
              <Tag size="small" color="orange">限时</Tag>
            </Tooltip>
          ) : null}
        </span>
      ),
    },
    createOperationColumn<CmsContentListItem>({
      // 预览是列表里最高频的动作，置于行内第一位；编辑/提交审核并列行内，
      // 发布、下线、查看审批等低频或危险动作收进更多菜单（width 按最宽内联组合重算）。
      width: activeTab === 'recycle' || activeTab === 'archived' ? 210 : 260,
      desktopInlineKeys: activeTab === 'recycle' ? ['restore', 'purge'] : activeTab === 'archived' ? ['preview', 'unarchive'] : ['preview', 'edit', 'submit'],
      actions: (record) => {
        const contentActions = record.lockedAt
        ? [
            ...(record.status === 'published' ? [{ key: 'preview', label: '预览', onClick: () => previewContent(record) }] : []),
            ...(hasPermission('cms:content:lock') ? [{
              key: 'unlock', label: '解锁', onClick: () => handlePersistentLock(record),
            }] : []),
          ]
        : activeTab === 'recycle'
        ? [
            ...(hasPermission('cms:content:delete') ? [
              { key: 'restore', label: '恢复', onClick: () => void runBatch('restore', [record.id], '已恢复为草稿') },
              deleteAction({
                key: 'purge',
                label: '彻底删除',
                title: '确定要彻底删除吗？',
                content: '删除后不可恢复',
                run: () => runBatch('purge', [record.id], '已彻底删除'),
                successMessage: null,
              }),
            ] : []),
            ...(hasPermission('cms:content:lock') ? [{ key: 'lock', label: '锁定', onClick: () => handlePersistentLock(record) }] : []),
          ]
        : activeTab === 'archived'
        ? [
            ...(record.status === 'published' ? [{
              key: 'preview',
              label: '预览',
              onClick: () => previewContent(record),
            }] : []),
            ...(hasPermission('cms:content:update') ? [{
              key: 'unarchive',
              label: '取消归档',
              onClick: () => void runBatch('unarchive', [record.id], '已取消归档'),
            }] : []),
            ...(hasPermission('cms:widget:list') ? [{
              key: 'widget-refs',
              label: '页面部件引用',
              onClick: () => setWidgetSourceTarget({ type: 'content', id: record.id, name: record.title }),
            }] : []),
            ...(hasPermission('cms:content:lock') ? [{ key: 'lock', label: '锁定', onClick: () => handlePersistentLock(record) }] : []),
          ]
        : [
            ...(record.status === 'published' ? [{
              key: 'preview',
              label: '预览',
              onClick: () => previewContent(record),
            }] : []),
            ...(hasPermission('cms:content:update') ? [{
              key: 'edit',
              label: '编辑',
              onClick: () => navigate(`/cms/contents/edit?id=${record.id}&siteId=${record.siteId}`),
            }] : []),
            ...(hasPermission('cms:widget:list') ? [{
              key: 'widget-refs',
              label: '页面部件引用',
              onClick: () => setWidgetSourceTarget({ type: 'content', id: record.id, name: record.title }),
            }] : []),
            ...(hasPermission('cms:content:update') && (record.editorialStatus === 'draft' || record.editorialStatus === 'rejected') ? [{
              key: 'submit',
              label: '提交审核',
              onClick: () => void runAction(record.id, 'submit', '已提交审核'),
            }] : []),
            ...(hasPermission('cms:content:publish') && (record.hasUnpublishedChanges || record.status !== 'published') ? [{
              key: 'publish',
              label: '发布',
              onClick: () => void runAction(record.id, 'publish', '发布成功'),
            }] : []),
            ...(hasPermission('cms:content:audit') && record.editorialStatus === 'pending' ? [{
              key: 'reject',
              label: '驳回',
              danger: true,
              onClick: () => handleReject(record),
            }] : []),
            ...(hasPermission('cms:content:publish') && record.status === 'published' ? [{
              key: 'offline',
              label: '下线',
              danger: true,
              onClick: () => void runAction(record.id, 'offline', '已下线'),
            }] : []),
            ...(hasPermission('cms:content:publish') ? [
              { key: 'suppress', label: '紧急撤下', danger: true, onClick: () => emergencyVisibility(record, 'suppress') },
              { key: 'unsuppress', label: '解除紧急撤下', onClick: () => emergencyVisibility(record, 'unsuppress') },
            ] : []),
            ...(hasPermission('cms:content:create') ? [{
              key: 'duplicate',
              label: '复制',
              onClick: () => {
                void duplicateMutation.mutateAsync({ params: { id: record.id }, body: {} }).then(() => Toast.success('已复制为草稿'));
              },
            }, {
              key: 'copy-to-channel',
              label: '复制到其他栏目',
              onClick: () => { setCopyTarget(record); setCopyChannelId(undefined); },
            }] : []),
            // 标记快捷切换（收纳在更多菜单，按当前值显示反向操作）
            ...(hasPermission('cms:content:update') ? [{
              key: 'toggle-top',
              label: record.isTop ? '取消置顶' : '置顶',
              onClick: () => void handleRowFlag(record, 'isTop', '置顶'),
            }, {
              key: 'toggle-recommend',
              label: record.isRecommend ? '取消推荐' : '推荐',
              onClick: () => void handleRowFlag(record, 'isRecommend', '推荐'),
            }, {
              key: 'toggle-hot',
              label: record.isHot ? '取消热门' : '设为热门',
              onClick: () => void handleRowFlag(record, 'isHot', '热门'),
            }, {
              key: 'toggle-original',
              label: record.isOriginal ? '取消原创' : '标记原创',
              onClick: () => void handleRowFlag(record, 'isOriginal', '标记原创'),
            }] : []),
            ...(hasPermission('cms:content:update') && (record.status === 'published' || record.status === 'offline') ? [{
              key: 'archive',
              label: '归档',
              onClick: () => {
                Modal.confirm({ title: `归档「${record.title}」？`, content: '归档后前台详情页保留，但不再出现在栏目列表/首页/标签页等聚合位', onOk: () => runBatch('archive', [record.id], '已归档') });
              },
            }] : []),
            ...(hasPermission('cms:content:delete') ? [{
              key: 'recycle',
              label: '回收站',
              danger: true,
              onClick: () => {
                Modal.confirm({ title: '移入回收站？', content: '已发布内容将同时下线', onOk: () => runBatch('recycle', [record.id], '已移入回收站') });
              },
            }] : []),
            ...(hasPermission('cms:content:lock') ? [{ key: 'lock', label: '锁定', onClick: () => handlePersistentLock(record) }] : []),
          ];
        return activeTab === 'recycle' ? contentActions : [
          { key: 'workflow', label: '查看审批', onClick: () => setWorkflowTarget(record) },
          ...contentActions,
        ];
      },
    }),
  ];

  const gotoCreate = (type: CmsContentType) => navigate(
    `/cms/contents/edit?siteId=${siteId}${channelId ? `&channelId=${channelId}` : ''}&contentType=${type}`,
  );

  /** 窄屏单栏模式下的「按栏目」入口（宽屏侧栏常驻时隐藏，与用户管理「按部门」一致） */
  const renderChannelTreeButton = (forceVisible = false) => (
    <Button
      theme="borderless"
      icon={<FolderTree size={14} />}
      onClick={() => setShowChannelTree(true)}
      style={{ display: forceVisible || isLayoutNarrow ? undefined : 'none' }}
    >
      按栏目
    </Button>
  );

  const batchBar = selectedIds.length > 0 ? (    activeTab === 'recycle' ? (hasPermission('cms:content:delete') ? (
      <>
        <Button onClick={() => void runBatch('restore', selectedIds, `已恢复 ${selectedIds.length} 条`)}>批量恢复</Button>
        <Button type="danger" onClick={() => {
          confirmAndDelete({
            title: `彻底删除 ${selectedIds.length} 条内容？`,
            content: '删除后不可恢复',
            run: () => runBatch('purge', selectedIds, '已彻底删除'),
            successMessage: null,
          });
        }}>批量删除</Button>
      </>
    ) : null) : activeTab === 'archived' ? (hasPermission('cms:content:update') ? (
      <Button onClick={() => void runBatch('unarchive', selectedIds, `已取消归档 ${selectedIds.length} 条`)}>批量取消归档</Button>
    ) : null) : (
      <>
        {hasPermission('cms:content:publish') ? (
          <Button onClick={() => confirmBatchStatus('publish', '批量发布', '仅草稿/待审核/已驳回/已下线内容会被发布并触发静态化')}>批量发布</Button>
        ) : null}
        {activeTab === 'pending' && hasPermission('cms:content:audit') ? (
          <Button onClick={handleBatchReject}>批量驳回</Button>
        ) : null}
        {activeTab !== 'pending' && hasPermission('cms:content:update') ? (
          <Button onClick={() => confirmBatchStatus('submit', '批量提审', '仅草稿/已驳回内容会进入待审核')}>批量提审</Button>
        ) : null}
        {hasPermission('cms:content:publish') ? (
          <Button onClick={() => confirmBatchStatus('offline', '批量下线', '仅已发布内容会被下线并清理静态页')}>批量下线</Button>
        ) : null}
        {hasPermission('cms:content:update') ? (
          <>
            <Button onClick={() => setMoveModalVisible(true)}>批量移动</Button>
            <Button onClick={() => setTagModalVisible(true)}>批量打标</Button>
            <Dropdown
              trigger="click"
              render={(
                <Dropdown.Menu>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isTop: true }, '置顶')}>置顶</Dropdown.Item>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isTop: false }, '取消置顶')}>取消置顶</Dropdown.Item>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isRecommend: true }, '推荐')}>推荐</Dropdown.Item>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isRecommend: false }, '取消推荐')}>取消推荐</Dropdown.Item>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isHot: true }, '设为热门')}>设为热门</Dropdown.Item>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isHot: false }, '取消热门')}>取消热门</Dropdown.Item>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isOriginal: true }, '标记原创')}>标记原创</Dropdown.Item>
                  <Dropdown.Item onClick={() => void handleBatchFlags({ isOriginal: false }, '取消原创')}>取消原创</Dropdown.Item>
                </Dropdown.Menu>
              )}
            >
              <Button icon={<ChevronDown size={14} />} iconPosition="right">批量属性</Button>
            </Dropdown>
            <Button onClick={() => {
              Modal.confirm({ title: `归档 ${selectedIds.length} 条内容？`, content: '仅已发布/已下线内容会被归档；归档后不参与前台列表聚合', onOk: () => runBatch('archive', selectedIds, '归档完成') });
            }}>批量归档</Button>
          </>
        ) : null}
        {hasPermission('cms:content:create') && hasPermission('cms:distribution:run') ? (
          <Button
            disabled={selectedIds.some((id) => list.find((content) => content.id === id)?.status !== 'published')}
            title="仅已发布内容可跨站分发"
            onClick={() => { setDistributeTargetSiteId(undefined); setDistributeModalVisible(true); }}
          >
            站群分发
          </Button>
        ) : null}
        {hasPermission('cms:content:delete') ? (
          <Button type="danger" onClick={() => {
            Modal.confirm({ title: `移入回收站 ${selectedIds.length} 条？`, content: '已发布内容将同时下线', onOk: () => runBatch('recycle', selectedIds, '已移入回收站') });
          }}>批量回收</Button>
        ) : null}
      </>
    )
  ) : null;

  const tableContent = (
    <>
      <Space wrap spacing={8} style={{ margin: '8px 0' }}>
        <Button size="small" onClick={() => applySearch({ ...DEFAULT_FILTERS, ownerId: user?.id, editorialStatus: 'draft' })}>我的工作稿</Button>
        <Button size="small" onClick={() => applySearch({ ...DEFAULT_FILTERS, editorialStatus: 'rejected' })}>已驳回</Button>
        <Button size="small" onClick={() => applySearch({ ...DEFAULT_FILTERS, hasUnpublishedChanges: true })}>未发布修改</Button>
        <Select showClear value={selectedView} placeholder="我的保存视图" style={{ width: 180 }} optionList={savedViews.map((view) => ({ value: view.name, label: view.name }))} onChange={(name) => { setSelectedView(name == null ? undefined : String(name)); const view = savedViews.find((item) => item.name === name); if (view) { setChannelId(view.channelId); setContentType(view.contentType); setActiveTab(view.tab ?? 'all'); applySearch({ ...view.filters, timeRange: view.filters.timeRange ? [new Date(String(view.filters.timeRange[0])), new Date(String(view.filters.timeRange[1]))] : null }); } }} />
        <Button size="small" onClick={saveView}>保存视图</Button>
        {selectedView ? <Button size="small" type="danger" theme="borderless" onClick={() => { const next = savedViews.filter((view) => view.name !== selectedView); localStorage.setItem(viewStorageKey, JSON.stringify(next)); setSavedViews(next); setSelectedView(undefined); }}>移除视图</Button> : null}
        <Button size="small" onClick={() => void copyTextWithToast(`${window.location.origin}${window.location.pathname}?view=${encodeURIComponent(JSON.stringify({ ...submittedParams, siteId, channelId, contentType, tab: activeTab }))}`)}>分享视图</Button>
      </Space>
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索标题/作者..." {...bindKeyword('keyword')} />}
        filters={(
          <>
          <FilterSelect
            placeholder="全部内容形态"
            items={CMS_CONTENT_TYPE_OPTIONS}
            value={contentType}
            onChange={(v) => { setContentType(v as CmsContentType | undefined); setPage(1); setSelectedIds([]); }}
            width={140}
          />
          <FilterSelect placeholder="内容模型" width={150} items={(models ?? []).map((model) => ({ value: model.id, label: model.name }))} {...bind('modelId')} />
          <FilterSelect placeholder="负责人" width={140} items={(users ?? []).map((user) => ({ value: user.id, label: user.nickname }))} {...bind('ownerId')} />
          <FilterSelect placeholder="编辑状态" width={130} items={Object.entries(CMS_EDITORIAL_STATUS_LABELS).map(([value, label]) => ({ value: value as CmsEditorialStatus, label }))} {...bind('editorialStatus')} />
          <Input placeholder="语言，如 zh-CN" {...bind('locale')} style={{ width: 130 }} showClear />
          <Select multiple showClear placeholder="标签" value={submittedParams.tags?.split(',').map(Number)} onChange={(value) => applySearch({ ...submittedParams, tags: Array.isArray(value) && value.length ? value.join(',') : undefined })} optionList={(allTags ?? []).map((tag) => ({ value: tag.id, label: tag.name }))} style={{ width: 180 }} />
          <DateRangeFilter {...bind('timeRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('cms:content:create') && siteId ? (
            <SplitButtonGroup>
              <CreateButton onClick={() => gotoCreate('article')} />
              <Dropdown
                trigger="click"
                position="bottomRight"
                clickToHide
                render={(
                  <Dropdown.Menu>
                    {CMS_CONTENT_TYPE_OPTIONS.map(({ value, label }) => (
                      <Dropdown.Item key={value} onClick={() => gotoCreate(value)}>
                        新增{label}
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                )}
              >
                <Button type="primary" icon={<ChevronDown size={14} />} />
              </Dropdown>
            </SplitButtonGroup>
          ) : null
        )}
        actions={<>{renderChannelTreeButton()}{batchBar}{siteId ? (
          <ExportButton
            entity="cms.contents"
            permission="cms:content:export"
            query={filterQuery}
          />
        ) : null}{hasPermission('cms:content:create') && siteId ? (
          <ImportButton
            entity="cms.contents"
            title="CMS 内容"
            context={{ siteId, channelId }}
            beforeSubmit={() => {
              if (!channelId) {
                Toast.warning('请先在左侧栏目树选择导入的目标栏目');
                return false;
              }
              return true;
            }}
            onFinished={() => void queryClient.invalidateQueries({ queryKey: cmsContentKeys.lists })}
          />
        ) : null}</>}
        mobileActions={renderChannelTreeButton(true)}
        filterTitle="筛选条件"
      />
      <ConfigurableTable
        columns={columns}
        {...listTableProps(listQuery, {
          rowKey: (record) => String(record?.id ?? ''),
          empty: '暂无内容',
          pagination: (total) => buildPagination(total, () => setSelectedIds([])),
          rowSelection: {
            selectedRowKeys: selectedIds.map(String),
            onChange: (keys) => setSelectedIds((keys ?? []).map(Number)),
          },
        })}
      />
      {/* P3 批量操作弹窗 */}
      <AppModal
        title={copyTarget ? `复制「${copyTarget.title}」到其他栏目` : '复制到其他栏目'}
        visible={copyTarget != null}
        onOk={() => {
          if (!copyTarget) return;
          if (!copyChannelId) { Toast.warning('请选择目标栏目'); return; }
          void duplicateMutation.mutateAsync({ params: { id: copyTarget.id }, body: { targetChannelId: copyChannelId } })
            .then(() => {
              Toast.success('已复制为草稿到目标栏目');
              setCopyTarget(null);
            });
        }}
        onCancel={() => setCopyTarget(null)}
        okButtonProps={{ loading: duplicateMutation.isPending }}
        width={480}
        closeOnEsc
      >
        <TreeSelect
          placeholder="选择目标栏目"
          style={{ width: '100%' }}
          treeData={channelsToSelectTree(treeQuery.data ?? [])}
          value={copyChannelId}
          onChange={(value: unknown) => setCopyChannelId(value == null ? undefined : Number(value))}
        />
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 8 }}>
          副本以草稿状态创建，URL 标识与自定义静态路径置空；移动或复制栏目不会改变内容模型。
        </Typography.Text>
      </AppModal>
      <AppModal
        title={`批量移动 ${selectedIds.length} 条内容`}
        visible={moveModalVisible}
        onOk={handleBatchMoveOk}
        onCancel={() => setMoveModalVisible(false)}
        okButtonProps={{ loading: batchOpsMutation.isPending }}
        width={480}
        closeOnEsc
      >
        <Form getFormApi={(api) => { moveFormApi.current = api; }} allowEmpty labelPosition="left" labelWidth={90}>
          <Form.TreeSelect field="channelId" label="目标栏目" style={{ width: '100%' }}
            treeData={channelsToSelectTree(treeQuery.data ?? [])}
            rules={[{ required: true, message: '请选择目标栏目' }]} />
        </Form>
      </AppModal>
      <AppModal
        title={`批量打标 ${selectedIds.length} 条内容`}
        visible={tagModalVisible}
        onOk={handleBatchTagOk}
        onCancel={() => setTagModalVisible(false)}
        okButtonProps={{ loading: batchOpsMutation.isPending }}
        width={480}
        closeOnEsc
      >
        <Form getFormApi={(api) => { tagFormApi.current = api; }} allowEmpty labelPosition="left" labelWidth={90}>
          <Form.Select field="tagIds" label="追加标签" multiple style={{ width: '100%' }}
            optionList={(allTags ?? []).map((t) => ({ value: t.id, label: t.name }))}
            rules={[{ required: true, message: '请选择标签' }]} />
        </Form>
      </AppModal>
      <AppModal
        title={`站群分发 ${selectedIds.length} 条内容`}
        visible={distributeModalVisible}
        onOk={handleDistributeOk}
        onCancel={() => setDistributeModalVisible(false)}
        okButtonProps={{ loading: batchOpsMutation.isPending }}
        width={520}
        closeOnEsc
      >
        <Form
          getFormApi={(api) => { distributeFormApi.current = api; }}
          allowEmpty
          labelPosition="left"
          labelWidth={90}
          onValueChange={(values) => {
            if (values.targetSiteId !== distributeTargetSiteId) setDistributeTargetSiteId(values.targetSiteId as number);
          }}
        >
          <Form.Select field="targetSiteId" label="目标站点" style={{ width: '100%' }}
            optionList={(sites ?? []).filter((s) => s.id !== siteId).map((s) => ({ value: s.id, label: s.name }))}
            rules={[{ required: true, message: '请选择目标站点' }]} />
          <Form.TreeSelect field="targetChannelId" label="目标栏目" style={{ width: '100%' }}
            treeData={channelsToSelectTree(distributeTargetTreeQuery.data ?? [])}
            rules={[{ required: true, message: '请选择目标栏目' }]} />
        </Form>
      </AppModal>
    </>
  );

  // ─── 栏目树侧栏（MasterDetailLayout：可拖宽/持久化/窄屏单栏切换，与用户管理一致）──
  const masterContent = (
    <>
      <MasterDetailLayout.Header>
        <CmsSiteSelect value={siteId} onChange={handleSiteChange} width="100%" />
      </MasterDetailLayout.Header>
      <MasterDetailLayout.Body padding={8}>
        <Tree
          treeData={[{ key: 'all', label: '全部栏目' }, ...channelsToTree(treeQuery.data ?? [])]}
          value={channelId ? String(channelId) : 'all'}
          filterTreeNode
          showFilteredOnly
          searchPlaceholder="搜索栏目"
          onSelect={(key) => {
            setChannelId(key === 'all' ? undefined : Number(key));
            setPage(1);
            setSelectedIds([]);
            setShowChannelTree(false);
          }}
          defaultExpandAll
          style={{ width: '100%' }}
        />
      </MasterDetailLayout.Body>
    </>
  );

  return (
    <div className="page-container page-container--stretch">
      <MasterDetailLayout
        master={masterContent}
        detail={(
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <StatGrid minItemWidth={140} style={{ padding: '0 0 12px' }}>
              <StatCard title="工作稿" value={metrics.data?.working ?? 0} />
              <StatCard title="待审核" value={metrics.data?.pending ?? 0} />
              <StatCard title="逾期事项" value={metrics.data?.overdue ?? 0} />
              <StatCard title="已排期" value={metrics.data?.scheduled ?? 0} />
              <StatCard title="未发布修改" value={metrics.data?.unpublishedChanges ?? 0} />
              <StatCard title="待处理批注" value={metrics.data?.unresolvedNotes ?? 0} />
            </StatGrid>
            {/* 标签栏固定，内容区独立滚动：否则矮窗口下表格尾部与分页会被 overflow: hidden 裁掉 */}
            <Tabs
              collapsible="auto"
              activeKey={activeTab}
              onChange={handleTabChange}
              type="line"
              lazyRender
              keepDOM={false}
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
              contentStyle={{ flex: 1, minHeight: 0, overflow: 'auto' }}
            >
              <TabPane tab="全部" itemKey="all">{tableContent}</TabPane>
              <TabPane tab="待审核" itemKey="pending">{tableContent}</TabPane>
              <TabPane tab="已发布" itemKey="published">{tableContent}</TabPane>
              <TabPane tab="归档" itemKey="archived">{tableContent}</TabPane>
              <TabPane tab="回收站" itemKey="recycle">{tableContent}</TabPane>
              <TabPane tab="内容日历" itemKey="calendar"><CmsContentCalendar siteId={siteId} onOpen={(id) => navigate(`/cms/contents/edit?id=${id}&siteId=${siteId}`)} /></TabPane>
            </Tabs>
          </div>
        )}
        defaultSize={216}
        minSize={160}
        maxSize={400}
        showDetail={!showChannelTree}
        onMasterBack={() => setShowChannelTree(false)}
        masterBackLabel="返回内容列表"
        onResponsiveChange={setIsLayoutNarrow}
        persistKey="cms-contents"
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
      />
      <CmsWidgetSourceRefsSheet
        target={widgetSourceTarget}
        onClose={() => setWidgetSourceTarget(null)}
      />
      {workflowTarget ? (
        <Suspense fallback={null}>
          <CmsContentWorkflowSheet key={workflowTarget.id} contentId={workflowTarget.id}
            title={workflowTarget.title} onClose={() => setWorkflowTarget(null)} />
        </Suspense>
      ) : null}
    </div>
  );
}
