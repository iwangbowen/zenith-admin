import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Tag, Toast, Tooltip, Modal, Tabs, TabPane, Tree, TreeSelect, Typography, Dropdown, Form, SplitButtonGroup } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { ChevronDown, Image as ImageIcon, Film, Paperclip, FolderTree } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { ExportButton } from '@/components/ExportButton';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import ImportButton from '@/components/ImportButton';
import {
  useCmsChannelTree, useCmsContentList, useCmsContentAction, useCmsContentBatch,
  useAllCmsSites, useAllCmsTags, useCmsContentBatchOps, useCmsContentBatchStatus, useDuplicateCmsContent, cmsContentKeys,
  useCmsContentPersistentLock,
} from '@/hooks/queries/cms';
import { CMS_CONTENT_STATUS_LABELS, CMS_CONTENT_TYPE_LABELS, CMS_CONTENT_TYPE_OPTIONS } from '@zenith/shared/cms';
import type { CmsChannel, CmsContent, CmsContentStatus, CmsContentType } from '@zenith/shared/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { CmsWidgetSourceRefsSheet, type CmsWidgetSourceTarget } from './CmsWidgetSourceRefsSheet';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { DATE_TIME_COLUMN_WIDTH, dateTimeColumn } from '@/utils/table-columns';
import { abortSubmit } from '@/lib/abort-submit';

import { useUrlTabState } from '@/hooks/useUrlTabState';
import { channelsToSelectTree } from './channel-tree';
import { mapTree } from '@zenith/shared/core';
const STATUS_COLORS: Record<CmsContentStatus, 'grey' | 'orange' | 'green' | 'red' | 'violet'> = {
  draft: 'grey',
  pending: 'orange',
  published: 'green',
  offline: 'violet',
  rejected: 'red',
};

type TabKey = 'all' | 'pending' | 'published' | 'archived' | 'recycle';

/** 栏目筛选树：仅 key / label，不带 value */
function channelsToTree(nodes: CmsChannel[]): TreeNodeData[] {
  return mapTree<CmsChannel, TreeNodeData>(nodes, (n) => ({ key: String(n.id), label: n.name }));
}

export default function ContentsPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useUrlTabState(['all', 'pending', 'published', 'archived', 'recycle'] as const, 'all');
  const [channelId, setChannelId] = useState<number | undefined>(undefined);
  const [contentType, setContentType] = useState<CmsContentType | undefined>(undefined);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [widgetSourceTarget, setWidgetSourceTarget] = useState<CmsWidgetSourceTarget | null>(null);
  // 窄屏单栏模式下的栏目树显隐（MasterDetailLayout 响应式）
  const [showChannelTree, setShowChannelTree] = useState(false);
  const [isLayoutNarrow, setIsLayoutNarrow] = useState(false);

  const treeQuery = useCmsChannelTree(siteId);
  const { data: sites } = useAllCmsSites();

  function handleSiteChange(next: number) {
    setSiteId(next);
    setChannelId(undefined);
    setPage(1);
    setSelectedIds([]);
  }

  const statusFilter: CmsContentStatus | undefined =
    activeTab === 'pending' ? 'pending' : activeTab === 'published' ? 'published' : undefined;

  const listQuery = useCmsContentList({
    page,
    pageSize,
    siteId: siteId ?? 0,
    channelId,
    status: statusFilter,
    contentType,
    keyword: submittedKeyword || undefined,
    deleted: activeTab === 'recycle' ? true : undefined,
    archived: activeTab === 'archived' ? true : undefined,
  }, siteId !== undefined);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const actionMutation = useCmsContentAction();
  const batchMutation = useCmsContentBatch();
  const batchOpsMutation = useCmsContentBatchOps();
  const batchStatusMutation = useCmsContentBatchStatus();
  const duplicateMutation = useDuplicateCmsContent();
  const persistentLockMutation = useCmsContentPersistentLock();
  const { data: allTags } = useAllCmsTags(siteId);
  const moveFormApi = useRef<FormApi | null>(null);
  const tagFormApi = useRef<FormApi | null>(null);
  const distributeFormApi = useRef<FormApi | null>(null);
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [distributeModalVisible, setDistributeModalVisible] = useState(false);
  const [distributeTargetSiteId, setDistributeTargetSiteId] = useState<number | undefined>(undefined);
  // 复制到其他栏目（同站）：选中待复制内容与目标栏目
  const [copyTarget, setCopyTarget] = useState<CmsContent | null>(null);
  const [copyChannelId, setCopyChannelId] = useState<number | undefined>(undefined);
  const distributeTargetTreeQuery = useCmsChannelTree(distributeTargetSiteId);

  function handleSearch() {
    setPage(1);
    setSelectedIds([]);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: cmsContentKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftKeyword('');
    setSubmittedKeyword('');
    setChannelId(undefined);
    setContentType(undefined);
    setSelectedIds([]);
    void queryClient.invalidateQueries({ queryKey: cmsContentKeys.lists });
  }

  function handleTabChange(key: string) {
    setActiveTab(key as TabKey);
    setPage(1);
    setSelectedIds([]);
  }

  async function runAction(id: number, action: 'submit' | 'publish' | 'offline', successMsg: string) {
    await actionMutation.mutateAsync({ id, action });
    Toast.success(successMsg);
  }

  function handleReject(record: CmsContent) {
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

        await actionMutation.mutateAsync({ id: record.id, action: 'reject', reason });
        Toast.success('已驳回');
      },
    });
  }

  function handlePersistentLock(record: CmsContent) {
    if (record.lockedAt) {
      Modal.confirm({
        title: `解除「${record.title}」的持久锁？`,
        content: '解锁后内容可再次编辑和流转；已取消的计划发布时间不会自动恢复。',
        onOk: async () => {
          await persistentLockMutation.mutateAsync({ id: record.id, action: 'unlock' });
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
        await persistentLockMutation.mutateAsync({ id: record.id, action: 'lock', reason: reason.trim() });
        Toast.success('内容已持久锁定');
      },
    });
  }

  async function runBatch(action: 'recycle' | 'restore' | 'purge' | 'archive' | 'unarchive', ids: number[], successMsg: string) {
    await batchMutation.mutateAsync({ action, ids });
    setSelectedIds([]);
    Toast.success(successMsg);
  }

  /** 批量状态流转：部分成功时逐条明示失败原因（欠提示比误吞更危险） */
  async function runBatchStatus(action: 'submit' | 'publish' | 'reject' | 'offline', label: string, reason?: string) {
    const result = await batchStatusMutation.mutateAsync({ body: { ids: selectedIds, action, reason } });
    setSelectedIds([]);
    if (result.failed.length === 0) {
      Toast.success(`已${label} ${result.okIds.length} 条内容`);
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
    await batchOpsMutation.mutateAsync({ action: 'batch-flags', body: { ids: selectedIds, ...flags } });
    setSelectedIds([]);
    Toast.success(`已${label} ${selectedIds.length} 条内容`);
  }

  /** 行级标记快捷切换（置顶/推荐/热门/原创，复用 batch-flags 单条调用） */
  async function handleRowFlag(record: CmsContent, flag: 'isTop' | 'isRecommend' | 'isHot' | 'isOriginal', label: string) {
    const next = !record[flag];
    await batchOpsMutation.mutateAsync({ action: 'batch-flags', body: { ids: [record.id], [flag]: next } });
    Toast.success(`「${record.title}」${next ? '已' : '已取消'}${label}`);
  }

  async function handleBatchMoveOk() {
    const values = await moveFormApi.current?.validate().catch(() => null);
    if (!values?.channelId) abortSubmit('validation');
    await batchOpsMutation.mutateAsync({ action: 'batch-move', body: { ids: selectedIds, channelId: values.channelId } });
    setSelectedIds([]);
    setMoveModalVisible(false);
    Toast.success('移动成功');
  }

  async function handleBatchTagOk() {
    const values = await tagFormApi.current?.validate().catch(() => null);
    if (!values?.tagIds || (values.tagIds as number[]).length === 0) abortSubmit('validation');
    await batchOpsMutation.mutateAsync({ action: 'batch-tag', body: { ids: selectedIds, tagIds: values.tagIds } });
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

  function previewContent(record: CmsContent) {
    if (!record.previewUrl) {
      Toast.warning('当前内容暂无可用的预览地址');
      return;
    }
    window.open(record.previewUrl, '_blank');
  }

  const columns: ColumnProps<CmsContent>[] = [
    {
      title: '标题',
      dataIndex: 'title',
      minWidth: 320,
      render: (v: string, record) => (
        <span>
          {record.isTop ? <Tag size="small" color="blue" style={{ marginRight: 4 }}>{record.topWeight > 0 ? `顶${record.topWeight}` : '顶'}</Tag> : null}
          {record.contentType !== 'article' ? <Tag size="small" color="light-blue" style={{ marginRight: 4 }}>{CMS_CONTENT_TYPE_LABELS[record.contentType]}</Tag> : null}
          {record.isRecommend ? <Tag size="small" color="cyan" style={{ marginRight: 4 }}>荐</Tag> : null}
          {record.isHot ? <Tag size="small" color="red" style={{ marginRight: 4 }}>热</Tag> : null}
          {record.memberId ? <Tag size="small" color="purple" style={{ marginRight: 4 }}>投稿</Tag> : null}
          {record.mappingSourceId ? <Tag size="small" color="teal" style={{ marginRight: 4 }}>映射</Tag> : null}
          {record.lockedAt ? <Tag size="small" color="red" style={{ marginRight: 4 }}>锁定</Tag> : null}
          {record.isOriginal ? <Tag size="small" color="green" style={{ marginRight: 4 }}>原创</Tag> : null}
          {(record.attachments?.length ?? 0) > 0 ? <Tag size="small" color="grey" style={{ marginRight: 4 }}>{`附${record.attachments.length}`}</Tag> : null}
          <Typography.Text
            ellipsis={{ showTooltip: true }}
            style={{
              maxWidth: 240,
              verticalAlign: 'middle',
              ...(record.titleStyle?.bold ? { fontWeight: 700 } : {}),
              ...(record.titleStyle?.color ? { color: record.titleStyle.color } : {}),
            }}
          >
            {v}
          </Typography.Text>
        </span>
      ),
    },
    { title: '栏目', dataIndex: 'channelName', width: 110 },
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
          : '-';
      },
    },
    { title: '作者', dataIndex: 'author', width: 90, render: (v: string | null) => v ?? '-' },
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
        return '—';
      },
    },
    dateTimeColumn('更新时间', 'updatedAt'),
    {
      title: '状态',
      dataIndex: 'status',
      width: 130,
      fixed: 'right',
      render: (v: CmsContentStatus, record) => (
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <Tag size="small" color={STATUS_COLORS[v]}>{CMS_CONTENT_STATUS_LABELS[v]}</Tag>
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
    createOperationColumn<CmsContent>({
      // 回收站 / 已归档 Tab 只有两个内联动作 + 更多，默认 Tab 草稿态为 编辑 / 预览 / 提交审核 + 更多
      width: activeTab === 'recycle' || activeTab === 'archived' ? 210 : 260,
      desktopInlineKeys: activeTab === 'recycle' ? ['restore', 'purge'] : activeTab === 'archived' ? ['unarchive', 'preview'] : ['edit', 'preview', 'submit', 'publish', 'offline'],
      actions: (record) => record.lockedAt
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
              {
                key: 'purge',
                label: '彻底删除',
                danger: true,
                onClick: () => {
                  confirmDelete({ title: '确定要彻底删除吗？', content: '删除后不可恢复', onOk: () => runBatch('purge', [record.id], '已彻底删除') });
                },
              },
            ] : []),
            ...(hasPermission('cms:content:lock') ? [{ key: 'lock', label: '锁定', onClick: () => handlePersistentLock(record) }] : []),
          ]
        : activeTab === 'archived'
        ? [
            ...(hasPermission('cms:content:update') ? [{
              key: 'unarchive',
              label: '取消归档',
              onClick: () => void runBatch('unarchive', [record.id], '已取消归档'),
            }] : []),
            ...(record.status === 'published' ? [{
              key: 'preview',
              label: '预览',
              onClick: () => previewContent(record),
            }] : []),
            ...(hasPermission('cms:widget:list') ? [{
              key: 'widget-refs',
              label: '页面部件引用',
              onClick: () => setWidgetSourceTarget({ type: 'content', id: record.id, name: record.title }),
            }] : []),
            ...(hasPermission('cms:content:lock') ? [{ key: 'lock', label: '锁定', onClick: () => handlePersistentLock(record) }] : []),
          ]
        : [
            ...(hasPermission('cms:content:update') ? [{
              key: 'edit',
              label: '编辑',
              onClick: () => navigate(`/cms/contents/edit?id=${record.id}&siteId=${record.siteId}`),
            }] : []),
            ...(record.status === 'published' ? [{
              key: 'preview',
              label: '预览',
              onClick: () => previewContent(record),
            }] : []),
            ...(hasPermission('cms:widget:list') ? [{
              key: 'widget-refs',
              label: '页面部件引用',
              onClick: () => setWidgetSourceTarget({ type: 'content', id: record.id, name: record.title }),
            }] : []),
            ...(hasPermission('cms:content:update') && (record.status === 'draft' || record.status === 'rejected') ? [{
              key: 'submit',
              label: '提交审核',
              onClick: () => void runAction(record.id, 'submit', '已提交审核'),
            }] : []),
            ...(hasPermission('cms:content:publish') && record.status !== 'published' ? [{
              key: 'publish',
              label: '发布',
              onClick: () => void runAction(record.id, 'publish', '发布成功'),
            }] : []),
            ...(hasPermission('cms:content:audit') && record.status === 'pending' ? [{
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
          ],
    }),
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="搜索标题/作者..." value={draftKeyword} onChange={setDraftKeyword} onSearch={handleSearch} />
  );
  const renderTypeFilter = () => (
    <FilterSelect
      placeholder="全部内容形态"
      items={CMS_CONTENT_TYPE_OPTIONS}
      value={contentType}
      onChange={(v) => { setContentType(v as CmsContentType | undefined); setPage(1); setSelectedIds([]); }}
      width={140}
    />
  );
  const renderSearchButton = () => (
    <SearchButton onClick={handleSearch} />
  );
  const renderResetButton = () => (
    <ResetButton onClick={handleReset} />
  );
  const gotoCreate = (type: CmsContentType) => navigate(
    `/cms/contents/edit?siteId=${siteId}${channelId ? `&channelId=${channelId}` : ''}&contentType=${type}`,
  );
  const renderCreateButton = () => hasPermission('cms:content:create') && siteId ? (
    <SplitButtonGroup>
      <CreateButton onClick={() => gotoCreate('article')} />
      <Dropdown
        trigger="click"
        position="bottomRight"
        clickToHide
        render={(
          <Dropdown.Menu>
            {Object.entries(CMS_CONTENT_TYPE_LABELS).map(([value, label]) => (
              <Dropdown.Item key={value} onClick={() => gotoCreate(value as CmsContentType)}>
                新增{label}
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        )}
      >
        <Button type="primary" icon={<ChevronDown size={14} />} />
      </Dropdown>
    </SplitButtonGroup>
  ) : null;
  const renderImportButton = () => hasPermission('cms:content:create') && siteId ? (
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
  ) : null;
  const renderExportButton = () => siteId && hasPermission('cms:content:export') ? (
    <ExportButton
      entity="cms.contents"
      permission="cms:content:export"
      query={{
        siteId,
        channelId,
        status: statusFilter,
        keyword: submittedKeyword || undefined,
      }}
    />
  ) : null;

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
          confirmDelete({ title: `彻底删除 ${selectedIds.length} 条内容？`, content: '删除后不可恢复', onOk: () => runBatch('purge', selectedIds, '已彻底删除') });
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
      <SearchToolbar
        primary={(
          <>
            {renderChannelTreeButton()}
            {renderKeywordSearch()}
            {renderTypeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {batchBar}
          </>
        )}
        actions={(
          <>
            {renderExportButton()}
            {renderImportButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderTypeFilter()}
          </>
        )}
        mobileActions={renderChannelTreeButton(true)}
        filterTitle="筛选条件"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey={(record) => String(record?.id ?? '')}
        size="small"
        empty="暂无内容"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total, () => setSelectedIds([]))}
        rowSelection={{
          selectedRowKeys: selectedIds.map(String),
          onChange: (keys) => setSelectedIds((keys ?? []).map(Number)),
        }}
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
          副本以草稿状态创建，URL 标识与自定义静态路径置空；换栏目后扩展字段按目标栏目模型解释。
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
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Tabs collapsible="auto" activeKey={activeTab} onChange={handleTabChange} type="line" lazyRender keepDOM={false}>
              <TabPane tab="全部" itemKey="all">{tableContent}</TabPane>
              <TabPane tab="待审核" itemKey="pending">{tableContent}</TabPane>
              <TabPane tab="已发布" itemKey="published">{tableContent}</TabPane>
              <TabPane tab="归档" itemKey="archived">{tableContent}</TabPane>
              <TabPane tab="回收站" itemKey="recycle">{tableContent}</TabPane>
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
    </div>
  );
}
