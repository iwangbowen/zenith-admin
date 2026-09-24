import { useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dropdown, Form, Modal, Space, Spin, TabPane, Tabs, Tag, Toast, Tooltip, Typography, Empty, Tree } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { Upload, FileText, Film, Music, File as FileIcon, FolderPlus, FolderPen, FolderX, Move, ShieldCheck, MoreHorizontal, CheckCircle2, XCircle } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { FilePreviewLayer } from '@/components/FilePreviewLayer';
import { ExportButton } from '@/components/ExportButton';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { useFilePreview } from '@/hooks/useFilePreview';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import {
  cmsResourceKeys, useCmsResourceList, useCmsResourceReferences,
  useUpdateCmsResource, useCropCmsResource, useDeleteCmsResources,
  useCmsResourceFolders, useSaveCmsResourceFolder, useDeleteCmsResourceFolder,
  useCmsResourceGovernance, useMoveCmsResources, useReplaceCmsResource, useRebuildCmsResourceRefs,
} from '@/hooks/queries/cms';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import { CMS_RESOURCE_OWNER_TYPE_LABELS, CMS_RESOURCE_TYPE_LABELS, CMS_RESOURCE_TYPES } from '@zenith/shared/cms';
import type { CmsResource, CmsResourceFolder, CmsResourceReference, CmsResourceOwnerType, CmsResourceType } from '@zenith/shared/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { EMPTY_PLACEHOLDER, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { canPreviewFile } from '@/utils/file-utils';
import { abortSubmit } from '@/lib/abort-submit';
import { formatBytes, mapTree } from '@zenith/shared/core';
import { confirmAndDelete, deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import ModalFooter from '@/components/ModalFooter';
import { compactParams } from '@/lib/query';
import { EditFormModal } from '@/components/EditFormModal';
import { EditFormSheet } from '@/components/EditFormModal';
import AssetRightsFields from './AssetRightsFields';
import { useCmsAssetRights, useSaveCmsAssetRights, type CmsAssetRightsRecord } from '@/hooks/queries/cms-resources';
import type { BodyOf } from '@zenith/shared/core';
import { cmsResourceContract } from '@zenith/shared/cms';
import { formatDateTimeForApi } from '@/utils/date';
import { useCmsUploadQueue } from './useCmsUploadQueue';
import { Progress } from '@douyinfe/semi-ui';

const TYPE_COLORS: Record<CmsResourceType, 'blue' | 'purple' | 'cyan' | 'orange' | 'grey'> = {
  image: 'blue', video: 'purple', audio: 'cyan', document: 'orange', other: 'grey',
};
interface SearchParams {
  keyword: string;
  type?: CmsResourceType;
}
const defaultSearchParams: SearchParams = { keyword: '', type: undefined };

const REFERENCE_KIND_LABELS = CMS_RESOURCE_OWNER_TYPE_LABELS;

function foldersToTree(folders: CmsResourceFolder[]): TreeNodeData[] {
  return mapTree<CmsResourceFolder, TreeNodeData>(folders, (folder) => ({
    key: String(folder.id),
    value: folder.id,
    label: `${folder.name}${folder.resourceCount ? ` (${folder.resourceCount})` : ''}`,
  }));
}

function findFolder(folders: CmsResourceFolder[], id: number): CmsResourceFolder | null {
  for (const folder of folders) {
    if (folder.id === id) return folder;
    const child = folder.children ? findFolder(folder.children, id) : null;
    if (child) return child;
  }
  return null;
}

function TypeIcon({ type }: Readonly<{ type: CmsResourceType }>) {
  if (type === 'video') return <Film size={22} />;
  if (type === 'audio') return <Music size={22} />;
  if (type === 'document') return <FileText size={22} />;
  return <FileIcon size={22} />;
}

/** 裁剪弹窗：图片上拖拽画选区（映射回原图像素），调服务端 sharp 裁剪另存新素材 */
function CropModal({ resource, onClose }: Readonly<{ resource: CmsResource | null; onClose: () => void }>) {
  const cropMutation = useCropCmsResource();
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);

  function relativePoint(e: React.MouseEvent): { x: number; y: number } | null {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: Math.min(Math.max(e.clientX - box.left, 0), box.width),
      y: Math.min(Math.max(e.clientY - box.top, 0), box.height),
    };
  }

  function handleMouseDown(e: React.MouseEvent) {
    const p = relativePoint(e);
    if (!p) return;
    dragRef.current = { startX: p.x, startY: p.y };
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const p = relativePoint(e);
    if (!p) return;
    const { startX, startY } = dragRef.current;
    setRect({
      x: Math.min(startX, p.x),
      y: Math.min(startY, p.y),
      w: Math.abs(p.x - startX),
      h: Math.abs(p.y - startY),
    });
  }

  function handleMouseUp() {
    dragRef.current = null;
  }

  // 展示尺寸 → 原图像素的换算比例（图片加载/窗口变化后由拖拽重渲染自然刷新）
  const img = imgRef.current;
  const scale = img && resource?.width ? resource.width / img.clientWidth : 1;

  const originalRect = rect && rect.w > 4 && rect.h > 4
    ? {
        left: Math.round(rect.x * scale),
        top: Math.round(rect.y * scale),
        width: Math.round(rect.w * scale),
        height: Math.round(rect.h * scale),
      }
    : null;

  async function handleConfirm() {
    if (!resource || !originalRect) return;
    await cropMutation.mutateAsync({ params: { id: resource.id }, body: originalRect });
    Toast.success('裁剪成功，已另存为新素材');
    onClose();
  }

  return (
    <AppModal
      title={`裁剪图片 — ${resource?.name ?? ''}`}
      visible={resource !== null}
      onCancel={onClose}
      width={640}
      centered
      closeOnEsc
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button onClick={() => setRect(null)} disabled={!rect}>清除选区</Button>
          <Button type="primary" loading={cropMutation.isPending} disabled={!originalRect} onClick={() => void handleConfirm()}>
            裁剪并另存
          </Button>
        </Space>
      }
    >
      {resource ? (
        <>
          <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            在图片上按住鼠标拖拽框选裁剪区域（原图 {resource.width ?? '?'}×{resource.height ?? '?'}）
            {originalRect ? `，当前选区 ${originalRect.width}×${originalRect.height} @ (${originalRect.left}, ${originalRect.top})` : ''}
          </Typography.Text>
          {/* 阻断默认拖图行为，覆盖层画选区 */}
          <div
            ref={boxRef}
            role="presentation"
            style={{ position: 'relative', display: 'inline-block', cursor: 'crosshair', userSelect: 'none', maxWidth: '100%' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <img ref={imgRef} src={resource.url} alt={resource.name} draggable={false} style={{ maxWidth: '100%', maxHeight: 420, display: 'block' }} />
            {rect ? (
              <div style={{
                position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h,
                border: '1px dashed var(--semi-color-primary)', background: 'rgba(0, 100, 250, 0.15)', pointerEvents: 'none',
              }} />
            ) : null}
          </div>
        </>
      ) : null}
    </AppModal>
  );
}

/** 引用弹窗：列出素材被内容/栏目/广告等引用的位置 */
function ReferencesModal({ resource, onClose }: Readonly<{ resource: CmsResource | null; onClose: () => void }>) {
  const navigate = useNavigate();
  const refsQuery = useCmsResourceReferences(resource?.id ?? null);
  const refs = refsQuery.data ?? [];
  const columns: ColumnProps<CmsResourceReference>[] = [
    {
      title: '引用方', dataIndex: 'kind', width: 110,
      render: (v: CmsResourceOwnerType) => <Tag size="small">{REFERENCE_KIND_LABELS[v]}</Tag>,
    },
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '标题', dataIndex: 'title', render: renderEllipsis },
    { title: '查看', width: 80, render: (_value, row) => row.href ? <Button theme="borderless" onClick={() => { onClose(); navigate(row.href!); }}>打开</Button> : null },
    {
      title: '引用字段', dataIndex: 'field', width: 140,
      render: (v: string) => <Typography.Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 120, display: 'block' }}>{v}</Typography.Text>,
    },
  ];
  return (
    <AppModal
      title={`引用位置 — ${resource?.name ?? ''}`}
      visible={resource !== null}
      onCancel={onClose}
      footer={null}
      width={720}
      centered
      closeOnEsc
    >
      {refsQuery.isError ? (
        <Empty title="引用扫描失败" description="请稍后重试或检查权限" style={{ padding: 24 }} />
      ) : (
        <ConfigurableTable<CmsResourceReference>
          columnSettings={false}
          columns={columns}
          scroll={{ y: 360 }}
          {...listTableProps({ ...refsQuery, data: refs }, {
            // 同一属主可以在多个字段上引用同一素材（如封面 + 正文），仅用 kind+id 会产生重复 key
            rowKey: (record) => `${record?.kind}-${record?.id}-${record?.field}`,
            empty: '该素材未被站内内容、栏目或广告引用，可安全删除',
          })}
        />
      )}
    </AppModal>
  );
}

/**
 * 上传队列状态：放在页签栏右侧（固定高度的行），不进入表格上方的文档流。
 *
 * 排在内容里会随上传状态挂载/卸载，把表格推上推下，并触发 ConfigurableTable 的高度重算（视觉上就是“闪”）；
 * 因此这里：图标占固定 14px 槽位（Spin small 同为 14px）、计数用等宽数字、
 * 进度条在上传期间常驻不卸载，布局在整批上传过程中保持不变。
 */
function UploadQueueStatus({ queue }: Readonly<{ queue: ReturnType<typeof useCmsUploadQueue> }>) {
  const total = queue.items.length;
  if (total === 0) return null;
  const done = queue.items.filter((item) => item.state === 'success').length;
  const failed = queue.items.filter((item) => item.state === 'failed');
  const settled = done + failed.length;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 8, color: 'var(--semi-color-text-2)', fontSize: 12 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, flexShrink: 0 }}>
        {queue.busy
          ? <Spin size="small" />
          : failed.length > 0
            ? <XCircle size={14} color="var(--semi-color-danger)" />
            : <CheckCircle2 size={14} color="var(--semi-color-success)" />}
      </span>
      <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>素材上传 {done}/{total}</span>
      <Progress percent={Math.round((settled / total) * 100)} showInfo={false} width={80} strokeWidth={4} />
      {failed.length > 0 && (
        <Tooltip content={<div style={{ maxWidth: 320 }}>
          {failed.map((item) => <div key={item.id}>{item.file.name}：{item.error}</div>)}
        </div>}>
          <Tag size="small" color="red" style={{ cursor: 'default' }}>{failed.length} 个失败</Tag>
        </Tooltip>
      )}
      {failed.length > 0 && (
        <Button theme="borderless" size="small" disabled={queue.busy} onClick={queue.retry}>重试</Button>
      )}
      <Button theme="borderless" size="small" disabled={queue.busy} onClick={queue.clear}>清除</Button>
    </div>
  );
}

/** CmsResource → 预览设施的最小文件形状（预览列点击与图集构建共用） */
const toPreviewFile = (r: CmsResource) => ({ id: String(r.id), url: r.url, originalName: r.name, mimeType: r.mimeType });

export default function ResourcesPage() {
  const { hasPermission } = usePermission();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [folderKey, setFolderKey] = useState('all');
  /** 窄屏单栏模式下当前展示素材列表（宽屏忽略）：默认进列表，「返回」回到文件夹树 */
  const [showListOnNarrow, setShowListOnNarrow] = useState(true);
  /** 素材列表与素材治理的数据集、工具栏完全不同，拆成两个页签，避免两张大表同屏堆叠 */
  const [activeTab, setActiveTab] = useUrlTabState(['resources', 'governance'] as const, 'resources');
  const [governanceRange, setGovernanceRange] = useState<[Date, Date] | null>(null);
  const {
    page, pageSize, setPage, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({
    defaults: defaultSearchParams,
    listKey: cmsResourceKeys.lists,
    onSearch: () => setSelectedIds([]),
    onReset: () => setSelectedIds([]),
  });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CmsResource | null>(null);
  const [cropTarget, setCropTarget] = useState<CmsResource | null>(null);
  const [refsTarget, setRefsTarget] = useState<CmsResource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<CmsResource | null>(null);

  const folderId = folderKey === 'all' ? undefined : Number(folderKey);
  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useMemo(() => ({
    siteId: siteId ?? 0,
    ...compactParams({
      type: submittedParams.type,
      keyword: submittedParams.keyword,
      folderId,
    }),
  }), [submittedParams, siteId, folderId]);
  const listQuery = useCmsResourceList({
    page,
    pageSize,
    ...filterQuery,
  }, siteId !== undefined);
  // 点击预览列内容进入预览，与文件列表页同一套设施（图集 / 文件弹窗 / 兜底新窗口）
  const preview = useFilePreview(() => (listQuery.data?.list ?? []).map(toPreviewFile));
  const foldersQuery = useCmsResourceFolders(siteId);
  const updateMutation = useUpdateCmsResource();
  const deleteMutation = useDeleteCmsResources();
  const saveFolderMutation = useSaveCmsResourceFolder();
  const folderModal = useEditModal<CmsResourceFolder, Partial<CmsResourceFolder>, Record<string, unknown>>({
    entityName: '素材文件夹',
    save: saveFolderMutation,
    defaults: () => ({ sort: 0, parentId: folderId && folderId > 0 ? folderId : 0 }),
    labelWidth: 80,
    toValues: (folder) => ({ name: folder.name, sort: folder.sort, parentId: folder.parentId ?? 0 }),
    beforeSave: (values, { isEdit }) => {
      if (!isEdit && !siteId) abortSubmit('validation');
      return {
        ...values,
        parentId: Number(values.parentId) > 0 ? Number(values.parentId) : null,
        ...(!isEdit ? { siteId } : {}),
      };
    },
    successMessage: () => '文件夹已保存',
  });
  const deleteFolderMutation = useDeleteCmsResourceFolder();
  const governanceMutation = useCmsResourceGovernance();
  const moveMutation = useMoveCmsResources();
  const replaceMutation = useReplaceCmsResource();
  const uploadQueue = useCmsUploadQueue();
  const rightsModal = useEditModal<CmsAssetRightsRecord, BodyOf<typeof cmsResourceContract.updateRights>>({
    entityName: '素材授权', save: useSaveCmsAssetRights(), useDetail: useCmsAssetRights,
    toValues: (record) => ({ source: record.source, license: record.license, expiresAt: record.expiresAt, revoked: record.revoked, tags: record.tags, alt: record.alt }),
    beforeSave: (values) => ({ ...values, expiresAt: values.expiresAt ? formatDateTimeForApi(values.expiresAt) : null }),
  });
  const rebuildRefsMutation = useRebuildCmsResourceRefs();
  const { tasks, loading: tasksLoading, refresh: refreshTasks } = useMyAsyncTasks({ taskTypes: ['cms-resource-governance', 'cms-resource-ref-rebuild'] });

  const canUpload = hasPermission('cms:resource:upload');
  const canUpdate = hasPermission('cms:resource:update');
  const canDelete = hasPermission('cms:resource:delete');
  const selectedFolder = folderId && folderId > 0 ? findFolder(foldersQuery.data ?? [], folderId) : null;

  function handleTabChange(key: string) {
    setActiveTab(key as 'resources' | 'governance');
    setSelectedIds([]);
  }

  function handleSiteChange(next: number) {
    setSiteId(next);
    setFolderKey('all');
    setPage(1);
    setSelectedIds([]);
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length || siteId === undefined) return;
    uploadQueue.add(files, siteId, folderId && folderId > 0 ? folderId : undefined);
  }

  async function handleReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = replaceTarget;
    setReplaceTarget(null);
    if (!file || !target) return;
    await replaceMutation.mutateAsync({ id: target.id, file });
    Toast.success('新文件版本已保存，已发布稿件保持原文件');
  }

  async function submitRebuildRefs() {
    if (!siteId) return;
    await rebuildRefsMutation.mutateAsync({ body: { siteId } });
    Toast.success('引用索引重建任务已提交');
    void refreshTasks();
  }

  async function submitGovernance(operation: 'scan' | 'cleanup', dryRun: boolean) {
    if (!siteId) return;
    await governanceMutation.mutateAsync({ body: { siteId, operation, dryRun } });
    Toast.success('素材治理任务已提交');
    void refreshTasks();
  }

  async function moveSelected(folderIdValue: number | null) {
    if (!siteId || selectedIds.length === 0) return;
    await moveMutation.mutateAsync({ body: { siteId, ids: selectedIds, folderId: folderIdValue } });
    setSelectedIds([]);
    Toast.success('批量移动任务已提交');
    void refreshTasks();
  }

  function handleDelete(ids: number[]) {
    confirmAndDelete({
      title: `删除 ${ids.length} 个素材？`,
      content: '存在站内引用的素材会被拒绝删除；删除会同步移除底层文件，不可恢复。',
      run: () => deleteMutation.mutateAsync({ body: { ids } }),
      onDeleted: () => setSelectedIds([]),
    });
  }

  const columns: ColumnProps<CmsResource>[] = [
    {
      title: '预览', dataIndex: 'url', width: 80,
      render: (_: string, record: CmsResource) => {
        // 与文件列表页一致：仅可预览类型渲染为可点击
        const previewable = canPreviewFile(record.mimeType, record.name);
        const content = record.type === 'image'
          ? <img src={record.thumbUrl ?? record.url} alt={record.name} draggable={false} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 'var(--semi-border-radius-medium)' }} />
          : <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--semi-color-text-2)', background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)' }}><TypeIcon type={record.type} /></div>;
        if (!previewable) return content;
        return (
          <button
            type="button"
            title={`预览 ${record.name}`}
            aria-label={`预览 ${record.name}`}
            onClick={() => void preview.handlePreview(toPreviewFile(record))}
            style={{
              padding: 0, border: 'none', background: 'none', lineHeight: 0, cursor: 'pointer',
              borderRadius: 'var(--semi-border-radius-medium)',
              opacity: preview.previewLoadingId === String(record.id) ? 0.6 : 1,
            }}
          >
            {content}
          </button>
        );
      },
    },
    { title: '名称', dataIndex: 'name', minWidth: 240, render: renderEllipsis },
    {
      title: '备注', dataIndex: 'remark', width: 200,
      render: (v: string | null) => (v
        ? <Typography.Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 180, display: 'block' }}>{v}</Typography.Text>
        : EMPTY_PLACEHOLDER),
    },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (v: CmsResourceType) => <Tag size="small" color={TYPE_COLORS[v]}>{CMS_RESOURCE_TYPE_LABELS[v]}</Tag>,
    },
    {
      title: '尺寸', dataIndex: 'width', width: 110,
      render: (_: number | null, record: CmsResource) => (record.width && record.height ? `${record.width}×${record.height}` : EMPTY_PLACEHOLDER),
    },
    { title: '大小', dataIndex: 'size', width: 100, align: 'right', render: (v: number) => formatBytes(v) },
    {
      title: '引用数', dataIndex: 'refCount', width: 90, align: 'right',
      render: (v: number | undefined) => (v ? <Tag size="small" color="blue">{v}</Tag> : <Tag size="small" color="grey">孤立</Tag>),
    },
    dateTimeColumn('上传时间', 'createdAt'),
    createOperationColumn<CmsResource>({
      width: 240,
      desktopInlineKeys: ['references', 'rename', 'delete'],
      actions: (record) => [
        { key: 'rights', label: '版本与授权', hidden: !canUpdate, onClick: () => rightsModal.openEdit({ id: record.id, resourceId: record.id, source: null, license: null, expiresAt: null, revoked: false, tags: [], alt: null }) },
        { key: 'references', label: '引用', onClick: () => setRefsTarget(record) },
        ...(canUpdate ? [{
          key: 'replace',
          label: '替换',
          onClick: () => { setReplaceTarget(record); replaceInputRef.current?.click(); },
        }] : []),
        ...(canUpdate && record.type === 'image' && record.fileId ? [{
          key: 'crop', label: '裁剪', onClick: () => setCropTarget(record),
        }] : []),
        ...(canUpdate ? [{ key: 'rename', label: '编辑', onClick: () => setRenameTarget(record) }] : []),
        deleteAction({
          hidden: !canDelete,
          title: '删除 1 个素材？',
          content: '存在站内引用的素材会被拒绝删除；删除会同步移除底层文件，不可恢复。',
          run: () => deleteMutation.mutateAsync({ body: { ids: [record.id] } }),
          onDeleted: () => setSelectedIds([]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container page-container--stretch">
      <MasterDetailLayout
        persistKey="cms-resources-folders"
        defaultSize={260}
        minSize={220}
        maxSize={380}
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        showDetail={showListOnNarrow}
        onBack={() => setShowListOnNarrow(false)}
        master={(
          <>
            <MasterDetailLayout.Header
              extra={(
                <>
                  {canUpdate ? (
                    <Tooltip content="新建文件夹">
                      <Button size="small" theme="borderless" icon={<FolderPlus size={15} />} onClick={folderModal.openCreate} />
                    </Tooltip>
                  ) : null}
                  {selectedFolder && (canUpdate || canDelete) ? (
                    <Dropdown
                      trigger="click"
                      clickToHide
                      position="bottomRight"
                      render={(
                        <Dropdown.Menu>
                          {canUpdate ? (
                            <Dropdown.Item
                              icon={<FolderPen size={14} />}
                              onClick={() => { folderModal.openEdit(selectedFolder); }}
                            >
                              重命名文件夹
                            </Dropdown.Item>
                          ) : null}
                          {canDelete ? (
                            <Dropdown.Item
                              type="danger"
                              icon={<FolderX size={14} />}
                              onClick={() => {
                                confirmAndDelete({
                                  title: `删除文件夹「${selectedFolder.name}」？`,
                                  content: '仅空文件夹可删除。',
                                  run: () => deleteFolderMutation.mutateAsync({ params: { id: selectedFolder.id } }),
                                  successMessage: '文件夹已删除',
                                  onDeleted: () => setFolderKey('all'),
                                });
                              }}
                            >
                              删除文件夹
                            </Dropdown.Item>
                          ) : null}
                        </Dropdown.Menu>
                      )}
                    >
                      <Button size="small" theme="borderless" type="tertiary" icon={<MoreHorizontal size={16} />} />
                    </Dropdown>
                  ) : null}
                </>
              )}
            >
              <CmsSiteSelect value={siteId} onChange={handleSiteChange} width="100%" />
            </MasterDetailLayout.Header>
            <MasterDetailLayout.Body padding={8}>
              {foldersQuery.isError ? <Empty title="文件夹加载失败" description="请刷新重试" /> : <Tree
                treeData={[
                  { key: 'all', label: '全部素材' },
                  { key: '0', label: '根目录（未分类）' },
                  ...foldersToTree(foldersQuery.data ?? []),
                ]}
                value={folderKey}
                // 文件夹只筛选素材列表，选中后回到列表页签，避免停在治理页签看不到变化
                onChange={(key) => { setFolderKey(String(key)); setPage(1); setSelectedIds([]); setShowListOnNarrow(true); setActiveTab('resources'); }}
                defaultExpandAll
              />}
            </MasterDetailLayout.Body>
          </>
        )}
        detail={(
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '0 0 0 16px' }}>
            {/* 页签栏固定，内容区独立滚动（同 ContentsPage）：矮窗口下表尾与分页不会被裁掉 */}
            <Tabs
              collapsible="auto"
              activeKey={activeTab}
              onChange={handleTabChange}
              type="line"
              lazyRender
              keepDOM={false}
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
              contentStyle={{ flex: 1, minHeight: 0, overflow: 'auto' }}
              tabBarExtraContent={<UploadQueueStatus queue={uploadQueue} />}
            >
              <TabPane tab="素材列表" itemKey="resources">
                <ListSearchToolbar
                  keyword={<KeywordInput placeholder="搜索素材名称" {...bindKeyword('keyword')} width={200} />}
                  filters={(
                    <FilterSelect
                      placeholder="全部素材类型"
                      items={CMS_RESOURCE_TYPES.map((t) => ({ label: CMS_RESOURCE_TYPE_LABELS[t], value: t }))}
                      {...bind('type')}
                      width={140}
                    />
                  )}
                  onSearch={handleSearch}
                  onReset={handleReset}
                  create={canUpload ? (
                    <Button type="primary" icon={<Upload size={14} />} loading={uploadQueue.busy} disabled={siteId === undefined} onClick={() => fileInputRef.current?.click()}>
                      上传素材
                    </Button>
                  ) : null}
                  actions={(
                    <>
                      {selectedIds.length > 0 && canDelete ? (
                        <Button type="danger" onClick={() => handleDelete(selectedIds)}>批量删除（{selectedIds.length}）</Button>
                      ) : null}
                      {selectedIds.length > 0 && canUpdate ? (
                        <Button icon={<Move size={14} />} onClick={() => setMoveModalVisible(true)}>
                          移动到目录（{selectedIds.length}）
                        </Button>
                      ) : null}
                    </>
                  )}
                />
                <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => void handleUploadFile(e)} />
                <input ref={replaceInputRef} type="file" style={{ display: 'none' }} onChange={(e) => void handleReplaceFile(e)} />
                <ConfigurableTable<CmsResource>
                  columns={columns}
                  {...listTableProps(listQuery, {
                    rowKey: (record) => String(record?.id ?? ''),
                    empty: '暂无素材，请先选择站点后上传',
                    pagination: (total) => buildPagination(total, () => setSelectedIds([])),
                    rowSelection: {
                      selectedRowKeys: selectedIds.map(String),
                      onChange: (keys) => setSelectedIds((keys ?? []).map(Number)),
                    },
                  })}
                />
              </TabPane>
              <TabPane tab="素材治理" itemKey="governance">
                <SearchToolbar>
                  {siteId && canDelete ? (
                    <>
                      <Button icon={<ShieldCheck size={14} />} onClick={() => void submitGovernance('scan', true)}>孤立扫描</Button>
                      <Button type="danger" onClick={() => {
                        confirmDelete({
                          title: '清理全部孤立素材？',
                          content: '任务会逐项复核完整引用后删除底层文件，支持取消与明细报告。',
                          onOk: () => submitGovernance('cleanup', false),
                        });
                      }}>清理孤立素材</Button>
                    </>
                  ) : null}
                  {siteId && canUpdate ? (
                    <Button onClick={() => {
                      Modal.confirm({
                        title: '重建素材引用索引？',
                        content: '引用索引由内容写入时实时维护，一般无需重建。存量数据首次接入或怀疑索引漂移时使用。',
                        onOk: () => submitRebuildRefs(),
                      });
                    }}>重建引用索引</Button>
                  ) : null}
                  <DateRangeFilter placeholder={['治理开始时间', '治理结束时间']} value={governanceRange} onChange={setGovernanceRange} />
                  {siteId ? <ExportButton entity="cms.resource-governance" permission="cms:resource:list" query={{
                    siteId,
                    ...formatDateTimeRangeForApi(governanceRange),
                  }} label="导出治理报告" /> : null}
                </SearchToolbar>
                {siteId ? <ConfigurableTable
                  columns={[
                    { title: '任务', dataIndex: 'title', width: 240 },
                    { title: '进度', width: 280, render: (_: unknown, record) => <AsyncTaskProgress task={record} /> },
                    {
                      title: '结果',
                      width: 220,
                      render: (_: unknown, record) => record.result
                        ? `孤立 ${Number(record.result.orphanCount ?? 0)} / 清理 ${Number(record.result.deletedCount ?? 0)}`
                        : (record.errorMessage ?? EMPTY_PLACEHOLDER),
                    },
                    dateTimeColumn('提交时间', 'createdAt'),
                  ]}
                  {...listTableProps({ data: tasks, isFetching: tasksLoading, refetch: refreshTasks }, { empty: '暂无素材治理任务' })}
                /> : <Empty description="请先选择站点后执行素材治理" style={{ padding: 48 }} />}
              </TabPane>
            </Tabs>
          </div>
        )}
      />

      <Modal
        visible={moveModalVisible}
        title={`移动 ${selectedIds.length} 个素材`}
        onCancel={() => setMoveModalVisible(false)}
        footer={null}
        closeOnEsc
      >
        <Form
          labelPosition="left"
          labelWidth={80}
          initValues={{ folderId: folderId && folderId > 0 ? folderId : 0 }}
          onSubmit={async (values: { folderId?: number | string | null }) => {
            const targetFolderId = Number(values.folderId) > 0 ? Number(values.folderId) : null;
            await moveSelected(targetFolderId);
            setMoveModalVisible(false);
          }}
        >
          {({ formApi }) => (
            <>
              <Form.TreeSelect
                field="folderId"
                label="目标目录"
                treeData={[{ key: '0', value: 0, label: '根目录', children: foldersToTree(foldersQuery.data ?? []) }]}
                defaultExpandAll
              />
              <div style={{ marginTop: 16 }}>
                <ModalFooter onCancel={() => setMoveModalVisible(false)} onOk={() => formApi.submitForm()} okText="移动" loading={moveMutation.isPending} />
              </div>
            </>
          )}
        </Form>
      </Modal>

      {/* 重命名/备注 */}
      <AppModal
        title={`编辑素材 — ${renameTarget?.name ?? ''}`}
        visible={renameTarget !== null}
        onCancel={() => setRenameTarget(null)}
        footer={null}
        width={440}
        centered
        closeOnEsc
      >
        {renameTarget ? (
          <Form
            labelPosition="left"
            labelWidth={80}
            initValues={{ name: renameTarget.name, remark: renameTarget.remark ?? '' }}
            onSubmit={async (values: { name: string; remark: string }) => {
              await updateMutation.mutateAsync({ params: { id: renameTarget.id }, body: { name: values.name, remark: values.remark || null } });
              Toast.success('已保存');
              setRenameTarget(null);
            }}
          >
            {({ formApi }) => (
              <>
                <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入素材名称' }]} maxLength={255} />
                <Form.Input field="remark" label="备注" maxLength={200} />
                <div style={{ marginTop: 8, paddingBottom: 12 }}>
                  <ModalFooter onCancel={() => setRenameTarget(null)} onOk={() => formApi.submitForm()} okText="保存" loading={updateMutation.isPending} />
                </div>
              </>
            )}
          </Form>
        ) : null}
      </AppModal>

      <EditFormModal modal={folderModal} title={folderModal.isEdit ? '编辑素材文件夹' : '新建素材文件夹'} width={480}>
        <Form.Input field="name" label="名称" maxLength={100} rules={[{ required: true, message: '请输入文件夹名称' }]} />
        <Form.TreeSelect
          field="parentId"
          label="父文件夹"
          treeData={[{ key: '0', value: 0, label: '根目录', children: foldersToTree(foldersQuery.data ?? []) }]}
          style={{ width: '100%' }}
        />
        <Form.InputNumber field="sort" label="排序" style={{ width: '100%' }} />
      </EditFormModal>

      <CropModal resource={cropTarget} onClose={() => setCropTarget(null)} />
      <FilePreviewLayer preview={preview} />
      <EditFormSheet modal={rightsModal} width={760} title="素材版本与授权"><AssetRightsFields resourceId={rightsModal.editing?.id} /></EditFormSheet>
      <ReferencesModal resource={refsTarget} onClose={() => setRefsTarget(null)} />
    </div>
  );
}
