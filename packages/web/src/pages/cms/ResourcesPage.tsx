import { useRef, useState } from 'react';
import { Button, DatePicker, Dropdown, Form, Modal, Space, Tag, Toast, Tooltip, Typography, Empty, Tree } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { Upload, FileText, Film, Music, File as FileIcon, FolderPlus, FolderPen, FolderX, Move, ShieldCheck, MoreHorizontal } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { ExportButton } from '@/components/ExportButton';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { usePagination } from '@/hooks/usePagination';
import {
  cmsResourceKeys, useCmsResourceList, useCmsResourceReferences,
  useUploadCmsResource, useUpdateCmsResource, useCropCmsResource, useDeleteCmsResources,
  useCmsResourceFolders, useSaveCmsResourceFolder, useDeleteCmsResourceFolder,
  useCmsResourceGovernance, useMoveCmsResources, useReplaceCmsResource, useRebuildCmsResourceRefs,
} from '@/hooks/queries/cms';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import { CMS_RESOURCE_OWNER_TYPE_LABELS, CMS_RESOURCE_TYPE_LABELS, CMS_RESOURCE_TYPES } from '@zenith/shared/cms';
import type { CmsResource, CmsResourceFolder, CmsResourceReference, CmsResourceOwnerType, CmsResourceType } from '@zenith/shared/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { formatDateTimeForApi } from '@/utils/date';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { dateTimeColumn } from '@/utils/table-columns';
import { abortSubmit } from '@/lib/abort-submit';
import { formatBytes, mapTree } from '@zenith/shared/core';

const TYPE_COLORS: Record<CmsResourceType, 'blue' | 'purple' | 'cyan' | 'orange' | 'grey'> = {
  image: 'blue', video: 'purple', audio: 'cyan', document: 'orange', other: 'grey',
};

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
  const refsQuery = useCmsResourceReferences(resource?.id ?? null);
  const refs = refsQuery.data ?? [];
  const columns: ColumnProps<CmsResourceReference>[] = [
    {
      title: '引用方', dataIndex: 'kind', width: 110,
      render: (v: CmsResourceOwnerType) => <Tag size="small">{REFERENCE_KIND_LABELS[v]}</Tag>,
    },
    { title: 'ID', dataIndex: 'id', width: 80 },
    {
      title: '标题', dataIndex: 'title',
      render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 260, display: 'block' }}>{v}</Typography.Text>,
    },
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
          bordered
          size="small"
          columnSettings={false}
          columns={columns}
          dataSource={refs}
          loading={refsQuery.isFetching}
          // 同一属主可以在多个字段上引用同一素材（如封面 + 正文），仅用 kind+id 会产生重复 key
          rowKey={(record) => `${record?.kind}-${record?.id}-${record?.field}`}
          pagination={false}
          scroll={{ y: 360 }}
          empty="该素材未被站内内容、栏目或广告引用，可安全删除"
          onRefresh={() => void refsQuery.refetch()}
          refreshLoading={refsQuery.isFetching}
        />
      )}
    </AppModal>
  );
}

export default function ResourcesPage() {
  const { hasPermission } = usePermission();
  const qc = useQueryClient();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [folderKey, setFolderKey] = useState('all');
  /** 窄屏单栏模式下当前展示素材列表（宽屏忽略）：默认进列表，「返回」回到文件夹树 */
  const [showListOnNarrow, setShowListOnNarrow] = useState(true);
  const [governanceStart, setGovernanceStart] = useState<Date | undefined>(undefined);
  const [governanceEnd, setGovernanceEnd] = useState<Date | undefined>(undefined);
  const [type, setType] = useState<CmsResourceType | undefined>(undefined);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState<string | undefined>(undefined);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CmsResource | null>(null);
  const [cropTarget, setCropTarget] = useState<CmsResource | null>(null);
  const [refsTarget, setRefsTarget] = useState<CmsResource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<CmsResource | null>(null);

  const folderId = folderKey === 'all' ? undefined : Number(folderKey);
  const listQuery = useCmsResourceList({ page, pageSize, siteId: siteId ?? 0, type, keyword, folderId }, siteId !== undefined);
  const foldersQuery = useCmsResourceFolders(siteId);
  const uploadMutation = useUploadCmsResource();
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
  const rebuildRefsMutation = useRebuildCmsResourceRefs();
  const { tasks, loading: tasksLoading, refresh: refreshTasks } = useMyAsyncTasks({ taskTypes: ['cms-resource-governance', 'cms-resource-ref-rebuild'] });

  const canUpload = hasPermission('cms:resource:upload');
  const canUpdate = hasPermission('cms:resource:update');
  const canDelete = hasPermission('cms:resource:delete');
  const selectedFolder = folderId && folderId > 0 ? findFolder(foldersQuery.data ?? [], folderId) : null;

  function handleSiteChange(next: number) {
    setSiteId(next);
    setFolderKey('all');
    setPage(1);
    setSelectedIds([]);
  }

  function handleSearch() {
    setKeyword(keywordDraft.trim() || undefined);
    setPage(1);
    setSelectedIds([]);
    void qc.invalidateQueries({ queryKey: cmsResourceKeys.lists });
  }

  function handleReset() {
    setKeywordDraft('');
    setKeyword(undefined);
    setType(undefined);
    setPage(1);
    setSelectedIds([]);
    void qc.invalidateQueries({ queryKey: cmsResourceKeys.lists });
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || siteId === undefined) return;
    await uploadMutation.mutateAsync({ siteId, folderId: folderId && folderId > 0 ? folderId : undefined, file });
    Toast.success('上传成功');
  }

  async function handleReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = replaceTarget;
    setReplaceTarget(null);
    if (!file || !target) return;
    await replaceMutation.mutateAsync({ id: target.id, file });
    Toast.success('替换成功，引用该素材的位置已自动指向新文件');
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
    confirmDelete({
      title: `删除 ${ids.length} 个素材？`,
      content: '存在站内引用的素材会被拒绝删除；删除会同步移除底层文件，不可恢复。',
      onOk: async () => {
        await deleteMutation.mutateAsync({ body: { ids } });
        setSelectedIds([]);
        Toast.success('删除成功');
      },
    });
  }

  const columns: ColumnProps<CmsResource>[] = [
    {
      title: '预览', dataIndex: 'url', width: 80,
      render: (_: string, record: CmsResource) => record.type === 'image'
        ? <img src={record.thumbUrl ?? record.url} alt={record.name} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 'var(--semi-border-radius-medium)' }} />
        : <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--semi-color-text-2)', background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)' }}><TypeIcon type={record.type} /></div>,
    },
    {
      title: '名称', dataIndex: 'name', minWidth: 240,
      render: (v: string) => (
        <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 220, display: 'block' }}>{v}</Typography.Text>
      ),
    },
    {
      title: '备注', dataIndex: 'remark', width: 200,
      render: (v: string | null) => (v
        ? <Typography.Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 180, display: 'block' }}>{v}</Typography.Text>
        : '-'),
    },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (v: CmsResourceType) => <Tag size="small" color={TYPE_COLORS[v]}>{CMS_RESOURCE_TYPE_LABELS[v]}</Tag>,
    },
    {
      title: '尺寸', dataIndex: 'width', width: 110,
      render: (_: number | null, record: CmsResource) => (record.width && record.height ? `${record.width}×${record.height}` : '-'),
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
        ...(canDelete ? [{ key: 'delete', label: '删除', danger: true, onClick: () => handleDelete([record.id]) }] : []),
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
                                confirmDelete({
                                  title: `删除文件夹「${selectedFolder.name}」？`,
                                  content: '仅空文件夹可删除。',
                                  onOk: async () => {
                                    await deleteFolderMutation.mutateAsync({ params: { id: selectedFolder.id } });
                                    setFolderKey('all');
                                    Toast.success('文件夹已删除');
                                  },
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
                onChange={(key) => { setFolderKey(String(key)); setPage(1); setSelectedIds([]); setShowListOnNarrow(true); }}
                defaultExpandAll
              />}
            </MasterDetailLayout.Body>
          </>
        )}
        detail={(
          <MasterDetailLayout.Body padding="0 0 0 16px">
            <SearchToolbar>
              <FilterSelect
                placeholder="全部素材类型"
                items={CMS_RESOURCE_TYPES.map((t) => ({ label: CMS_RESOURCE_TYPE_LABELS[t], value: t }))}
                value={type}
                onChange={(v) => { setType(v as CmsResourceType | undefined); setPage(1); setSelectedIds([]); }}
                width={140}
              />
              <KeywordInput placeholder="搜索素材名称" value={keywordDraft} onChange={setKeywordDraft} onSearch={handleSearch} width={200} />
              <SearchButton onClick={handleSearch} />
              <ResetButton onClick={handleReset} />
              {canUpload ? (
                <Button type="primary" icon={<Upload size={14} />} loading={uploadMutation.isPending} disabled={siteId === undefined} onClick={() => fileInputRef.current?.click()}>
                  上传素材
                </Button>
              ) : null}
              {selectedIds.length > 0 && canDelete ? (
                <Button type="danger" onClick={() => handleDelete(selectedIds)}>批量删除（{selectedIds.length}）</Button>
              ) : null}
              {selectedIds.length > 0 && canUpdate ? (
                <Button icon={<Move size={14} />} onClick={() => setMoveModalVisible(true)}>
                  移动到目录（{selectedIds.length}）
                </Button>
              ) : null}
            </SearchToolbar>
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={(e) => void handleUploadFile(e)} />
            <input ref={replaceInputRef} type="file" style={{ display: 'none' }} onChange={(e) => void handleReplaceFile(e)} />
            <ConfigurableTable
              bordered
              columns={columns}
              dataSource={listQuery.data?.list ?? []}
              loading={listQuery.isFetching}
              rowKey={(record) => String(record?.id ?? '')}
              size="small"
              empty="暂无素材，请先选择站点后上传"
              onRefresh={() => void listQuery.refetch()}
              refreshLoading={listQuery.isFetching}
              pagination={buildPagination(listQuery.data?.total ?? 0, () => setSelectedIds([]))}
              rowSelection={{
                selectedRowKeys: selectedIds.map(String),
                onChange: (keys) => setSelectedIds((keys ?? []).map(Number)),
              }}
            />
            <Typography.Title heading={6} style={{ margin: '18px 0 8px' }}>素材治理任务</Typography.Title>
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
              <DatePicker type="dateTime" value={governanceStart} onChange={(value) => setGovernanceStart(value as Date | undefined)} placeholder="治理开始时间" />
              <DatePicker type="dateTime" value={governanceEnd} onChange={(value) => setGovernanceEnd(value as Date | undefined)} placeholder="治理结束时间" />
              {siteId ? <ExportButton entity="cms.resource-governance" permission="cms:resource:list" query={{
                siteId,
                startTime: governanceStart ? formatDateTimeForApi(governanceStart) : undefined,
                endTime: governanceEnd ? formatDateTimeForApi(governanceEnd) : undefined,
              }} label="导出治理报告" /> : null}
            </SearchToolbar>
            <ConfigurableTable
              bordered
              columns={[
                { title: '任务', dataIndex: 'title', width: 240 },
                { title: '进度', width: 280, render: (_: unknown, record) => <AsyncTaskProgress task={record} /> },
                {
                  title: '结果',
                  width: 220,
                  render: (_: unknown, record) => record.result
                    ? `孤立 ${Number(record.result.orphanCount ?? 0)} / 清理 ${Number(record.result.deletedCount ?? 0)}`
                    : (record.errorMessage ?? '-'),
                },
                dateTimeColumn('提交时间', 'createdAt'),
              ]}
              dataSource={tasks}
              loading={tasksLoading}
              rowKey="id"
              pagination={false}
              empty="暂无素材治理任务"
              onRefresh={refreshTasks}
              refreshLoading={tasksLoading}
            />
          </MasterDetailLayout.Body>
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
          <Form.TreeSelect
            field="folderId"
            label="目标目录"
            treeData={[{ key: '0', value: 0, label: '根目录', children: foldersToTree(foldersQuery.data ?? []) }]}
            defaultExpandAll
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={() => setMoveModalVisible(false)}>取消</Button>
            <Button type="primary" htmlType="submit" loading={moveMutation.isPending}>移动</Button>
          </div>
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
            <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入素材名称' }]} maxLength={255} />
            <Form.Input field="remark" label="备注" maxLength={200} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8, paddingBottom: 12 }}>
              <Button onClick={() => setRenameTarget(null)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>保存</Button>
            </div>
          </Form>
        ) : null}
      </AppModal>

      <AppModal
        {...folderModal.modalProps}
        title={folderModal.isEdit ? '编辑素材文件夹' : '新建素材文件夹'}
        width={480}
      >
        <Form
          key={folderModal.formKey} {...folderModal.formProps}
        >
          <Form.Input field="name" label="名称" maxLength={100} rules={[{ required: true, message: '请输入文件夹名称' }]} />
          <Form.TreeSelect
            field="parentId"
            label="父文件夹"
            treeData={[{ key: '0', value: 0, label: '根目录', children: foldersToTree(foldersQuery.data ?? []) }]}
            style={{ width: '100%' }}
          />
          <Form.InputNumber field="sort" label="排序" style={{ width: '100%' }} />
        </Form>
      </AppModal>

      <CropModal resource={cropTarget} onClose={() => setCropTarget(null)} />
      <ReferencesModal resource={refsTarget} onClose={() => setRefsTarget(null)} />
    </div>
  );
}
