import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Breadcrumb, Button, Dropdown, Empty, Form, Progress, Space, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ChevronDown, Copy, Download, FolderPlus, LayoutGrid, List as ListIcon, Lock, MoveRight, Star, Trash2, Upload } from 'lucide-react';
import { formatBytes } from '@zenith/shared/core';
import { DRIVE_ROLE_LABELS, type DriveNode, type DriveNodeListResult } from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { CursorContextDropdown, type CursorPoint } from '@/components/CursorContextDropdown';
import { FileNameCell } from '@/components/FileNameCell';
import { FilePreviewLayer } from '@/components/FilePreviewLayer';
import { KeywordInput } from '@/components/search-filters';
import { createOperationColumn, type ResponsiveTableAction } from '@/components/ResponsiveTableActions';
import { useFilePreview } from '@/hooks/useFilePreview';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import { batchDownloadDriveNodes, driveKeys, useCopyDriveNodes, useCreateDriveFolder, useDeleteDriveNodes, useDriveDir, useLockDriveNode, useMoveDriveNodes, useRenameDriveNode, useStarDriveNode } from '@/hooks/queries/drive';
import { confirmDelete } from '@/utils/confirm';
import { canPreviewFile, fetchManagedFileBlob } from '@/utils/file-utils';
import { downloadBlob } from '@/utils/download';
import { dateTimeColumn } from '@/utils/table-columns';
import { DriveFolderPicker, type FolderTarget } from './DriveFolderPicker';
import { DriveNodeCard } from './DriveNodeCard';
import type { UploaderTarget } from '../hooks/useDriveUploader';
import { nodeDownloadUrl, nodeToManagedFile, roleAtLeast, usagePercent } from '../drive-utils';

type ViewMode = 'list' | 'grid';
type SortBy = 'name' | 'size' | 'updatedAt' | 'createdAt';
const VIEW_MODE_KEY = 'drive.viewMode';

interface SearchParams {
  keyword: string;
  sortBy: SortBy;
  order: 'asc' | 'desc';
}

interface DriveBrowserProps {
  readonly spaceId: number;
  readonly folderId: number | null;
  readonly onNavigate: (folderId: number | null) => void;
  readonly onOpenDetail: (nodeId: number) => void;
  readonly onUpload: (files: File[], target: UploaderTarget) => void;
  /** 由外部（外链创建等）触发的刷新计数 */
  readonly refreshToken?: number;
}

const SORT_OPTIONS: Array<{ value: SortBy; label: string }> = [
  { value: 'name', label: '按名称' },
  { value: 'updatedAt', label: '按修改时间' },
  { value: 'createdAt', label: '按创建时间' },
  { value: 'size', label: '按大小' },
];

/** 目录浏览器：面包屑 + 工具栏 + 列表 / 网格 + 拖拽上传 + 右键菜单 */
export function DriveBrowser({ spaceId, folderId, onNavigate, onOpenDetail, onUpload }: DriveBrowserProps) {
  const { hasPermission } = usePermission();
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem(VIEW_MODE_KEY) === 'grid' ? 'grid' : 'list'));
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [ctx, setCtx] = useState<{ node: DriveNode; point: CursorPoint } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [renaming, setRenaming] = useState<DriveNode | null>(null);
  const [creating, setCreating] = useState(false);
  const [picker, setPicker] = useState<{ mode: 'move' | 'copy'; nodes: DriveNode[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formApiRef = useRef<FormApi<{ name: string }> | null>(null);

  const listKey = driveKeys.dir(spaceId, folderId);
  const { page, pageSize, buildPagination, draftParams, setDraftParams, submittedParams, handleSearch, handleReset, setPage } =
    useListSearch<SearchParams>({ defaults: { keyword: '', sortBy: 'name', order: 'asc' }, listKey, pageSize: 50 });

  const dirQuery = useDriveDir({
    spaceId, parentId: folderId, page, pageSize,
    keyword: submittedParams.keyword || undefined, sortBy: submittedParams.sortBy, order: submittedParams.order,
  });
  const data: DriveNodeListResult | undefined = dirQuery.data;
  const list = useMemo(() => data?.list ?? [], [data?.list]);
  const myRole = data?.myRole ?? null;
  const canUpload = hasPermission('drive:node:upload') && roleAtLeast(myRole, 'editor');
  const canEdit = hasPermission('drive:node:edit') && roleAtLeast(myRole, 'editor');
  const canDelete = hasPermission('drive:node:delete');
  const canDownload = hasPermission('drive:node:download');

  useEffect(() => { setSelectedIds([]); }, [spaceId, folderId, page]);
  useEffect(() => { setPage(1); }, [spaceId, folderId, setPage]);

  const rename = useRenameDriveNode();
  const createFolder = useCreateDriveFolder();
  const move = useMoveDriveNodes();
  const copy = useCopyDriveNodes();
  const remove = useDeleteDriveNodes();
  const star = useStarDriveNode();
  const lock = useLockDriveNode();

  const preview = useFilePreview(() => list.filter((n) => n.type === 'file' && n.url).map(nodeToManagedFile));

  const openNode = useCallback((node: DriveNode) => {
    if (node.type === 'folder') { onNavigate(node.id); return; }
    if (canPreviewFile(node.mimeType, node.name) && node.url) {
      void preview.handlePreview(nodeToManagedFile(node));
    } else {
      onOpenDetail(node.id);
    }
  }, [onNavigate, onOpenDetail, preview]);

  const downloadOne = useCallback(async (node: DriveNode) => {
    if (node.type === 'folder') {
      const result = await batchDownloadDriveNodes([node.id]);
      if (result?.mode === 'task') Toast.info('文件较多，已转为后台打包，完成后会通知你');
      return;
    }
    const blob = await fetchManagedFileBlob(nodeDownloadUrl(node));
    downloadBlob(blob, node.name);
  }, []);

  const downloadSelected = useCallback(async () => {
    const result = await batchDownloadDriveNodes(selectedIds);
    if (result?.mode === 'task') Toast.info('文件较多，已转为后台打包，完成后会通知你');
  }, [selectedIds]);

  const deleteNodes = (nodes: DriveNode[]) => {
    confirmDelete({
      title: nodes.length === 1 ? `删除「${nodes[0].name}」？` : `删除选中的 ${nodes.length} 个项目？`,
      content: '将移入回收站，可在保留期内还原。',
      onOk: () => remove.mutateAsync({ nodes }).then(() => { Toast.success('已移入回收站'); setSelectedIds([]); }),
    });
  };

  const handlePickerOk = async (target: FolderTarget) => {
    if (!picker) return;
    const ids = picker.nodes.map((n) => n.id);
    if (picker.mode === 'move') {
      await move.mutateAsync({ body: { ids, targetSpaceId: target.spaceId, targetParentId: target.parentId }, sources: picker.nodes });
      Toast.success(`已移动到「${target.label}」`);
    } else {
      const result = await copy.mutateAsync({ body: { ids, targetSpaceId: target.spaceId, targetParentId: target.parentId } });
      Toast.success(result.mode === 'task' ? '项目较多，已转为后台复制' : `已复制到「${target.label}」`);
    }
    setPicker(null);
    setSelectedIds([]);
  };

  const submitName = async (mode: 'rename' | 'create') => {
    const api = formApiRef.current;
    if (!api) return;
    const { name } = await api.validate();
    if (mode === 'rename' && renaming) {
      await rename.mutateAsync({ params: { id: renaming.id }, body: { name } });
      setRenaming(null);
      Toast.success('已重命名');
    } else {
      await createFolder.mutateAsync({ body: { spaceId, parentId: folderId, name } });
      setCreating(false);
      Toast.success('文件夹已创建');
    }
  };

  const nodeActions = (node: DriveNode): ResponsiveTableAction[] => {
    const previewable = node.type === 'file' && canPreviewFile(node.mimeType, node.name);
    const nodeCanEdit = canEdit && roleAtLeast(node.myRole, 'editor');
    return [
      ...(previewable ? [{ key: 'preview', label: '预览', onClick: () => openNode(node) }] : []),
      ...(canDownload && roleAtLeast(node.myRole, 'downloader') ? [{ key: 'download', label: '下载', onClick: () => void downloadOne(node) }] : []),
      { key: 'detail', label: '详情', onClick: () => onOpenDetail(node.id) },
      { key: 'star', label: node.isStarred ? '取消收藏' : '收藏', onClick: () => star.mutate({ node, starred: !node.isStarred }) },
      ...(nodeCanEdit ? [
        { key: 'rename', label: '重命名', onClick: () => setRenaming(node), dividerBefore: true },
        { key: 'move', label: '移动到', onClick: () => setPicker({ mode: 'move', nodes: [node] }) },
        { key: 'copy', label: '复制到', onClick: () => setPicker({ mode: 'copy', nodes: [node] }) },
      ] : []),
      ...(nodeCanEdit && node.type === 'file' ? [{ key: 'lock', label: node.lockedBy ? '解除锁定' : '签出锁定', onClick: () => lock.mutate({ id: node.id, lock: !node.lockedBy }) }] : []),
      ...(canDelete && roleAtLeast(node.myRole, 'editor') ? [{ key: 'delete', label: '删除', danger: true, dividerBefore: true, onClick: () => deleteNodes([node]) }] : []),
    ];
  };

  const columns: ColumnProps<DriveNode>[] = [
    {
      title: '名称', dataIndex: 'name', minWidth: 220, ellipsis: { showTitle: false },
      render: (_: unknown, node: DriveNode) => (
        <div className="drive-name-cell">
          <FileNameCell name={node.name} mimeType={node.type === 'folder' ? 'inode/directory' : node.mimeType} onClick={() => openNode(node)} />
          {node.isStarred && <Star size={12} className="drive-name-cell__star" fill="currentColor" aria-label="已收藏" />}
          {node.lockedBy && <Tooltip content={`${node.lockedByName ?? ''} 签出锁定中`}><Lock size={12} className="drive-name-cell__lock" /></Tooltip>}
          {(node.tags ?? []).slice(0, 2).map((t) => <Tag key={t.id} size="small" color="blue">{t.name}</Tag>)}
        </div>
      ),
    },
    { title: '大小', dataIndex: 'size', width: 90, render: (v: number, node: DriveNode) => (node.type === 'folder' ? '—' : formatBytes(v)) },
    { title: '修改人', dataIndex: 'updatedByName', width: 100, render: (v: string | null) => v ?? '—' },
    dateTimeColumn('修改时间', 'updatedAt'),
    { title: '角色', dataIndex: 'myRole', width: 80, render: (v: DriveNode['myRole']) => (v ? DRIVE_ROLE_LABELS[v] : '—') },
    createOperationColumn<DriveNode>({ width: 170, desktopInlineKeys: ['preview', 'download'], actions: nodeActions }),
  ];

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!canUpload) { Toast.warning('当前目录没有上传权限'); return; }
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) onUpload(files, { spaceId, parentId: folderId });
  };

  const usage = data ? usagePercent(data.space) : null;
  const selectedNodes = useMemo(() => list.filter((n) => selectedIds.includes(n.id)), [list, selectedIds]);
  const toggleView = (mode: ViewMode) => { setViewMode(mode); localStorage.setItem(VIEW_MODE_KEY, mode); };

  return (
    <div
      className={`drive-browser${dragging ? ' drive-browser--dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
    >
      <div className="drive-browser__header">
        <Breadcrumb compact={false} className="drive-browser__crumbs">
          <Breadcrumb.Item onClick={() => onNavigate(null)}>{data?.space.name ?? '…'}</Breadcrumb.Item>
          {(data?.breadcrumbs ?? []).map((b, idx, arr) => (
            <Breadcrumb.Item key={b.id} onClick={idx < arr.length - 1 ? () => onNavigate(b.id) : undefined}>{b.name}</Breadcrumb.Item>
          ))}
        </Breadcrumb>
        {data && (
          <div className="drive-browser__usage">
            <Typography.Text type="tertiary" size="small">
              {formatBytes(data.space.usedBytes)}{data.space.quotaBytes ? ` / ${formatBytes(data.space.quotaBytes)}` : ' · 不限'}
            </Typography.Text>
            {usage !== null && <Progress percent={usage} size="small" style={{ width: 80 }} stroke={usage >= 90 ? 'var(--semi-color-danger)' : undefined} aria-label="空间用量" />}
          </div>
        )}
      </div>

      <div className="drive-browser__toolbar">
        <div className="drive-browser__toolbar-left">
          {canUpload && (
            <>
              <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { onUpload(Array.from(e.target.files ?? []), { spaceId, parentId: folderId }); e.target.value = ''; }} />
              <Button theme="solid" icon={<Upload size={14} />} onClick={() => fileInputRef.current?.click()}>上传</Button>
              <Button icon={<FolderPlus size={14} />} onClick={() => setCreating(true)}>新建文件夹</Button>
            </>
          )}
          {selectedIds.length > 0 && (
            <Space className="drive-browser__batch">
              <Typography.Text type="tertiary">已选 {selectedIds.length} 项</Typography.Text>
              {canDownload && <Button size="small" icon={<Download size={14} />} onClick={() => void downloadSelected()}>下载</Button>}
              {canEdit && <Button size="small" icon={<MoveRight size={14} />} onClick={() => setPicker({ mode: 'move', nodes: selectedNodes })}>移动</Button>}
              {canEdit && <Button size="small" icon={<Copy size={14} />} onClick={() => setPicker({ mode: 'copy', nodes: selectedNodes })}>复制</Button>}
              {canDelete && <Button size="small" type="danger" icon={<Trash2 size={14} />} onClick={() => deleteNodes(selectedNodes)}>删除</Button>}
              <Button size="small" theme="borderless" onClick={() => setSelectedIds([])}>取消</Button>
            </Space>
          )}
        </div>
        <div className="drive-browser__toolbar-right">
          <KeywordInput placeholder="搜索当前目录" width={200} value={draftParams.keyword}
            onChange={(v) => { setDraftParams((p) => ({ ...p, keyword: v })); if (v === '' && submittedParams.keyword) setTimeout(handleReset, 0); }}
            onSearch={handleSearch} />
          <Dropdown
            trigger="click"
            clickToHide
            render={(
              <Dropdown.Menu>
                {SORT_OPTIONS.map((o) => (
                  <Dropdown.Item key={o.value} active={submittedParams.sortBy === o.value}
                    onClick={() => { setDraftParams((p) => ({ ...p, sortBy: o.value })); setTimeout(handleSearch, 0); }}>{o.label}</Dropdown.Item>
                ))}
                <Dropdown.Divider />
                <Dropdown.Item onClick={() => { setDraftParams((p) => ({ ...p, order: p.order === 'asc' ? 'desc' : 'asc' })); setTimeout(handleSearch, 0); }}>
                  {submittedParams.order === 'asc' ? '切换为降序' : '切换为升序'}
                </Dropdown.Item>
              </Dropdown.Menu>
            )}
          >
            <Button theme="borderless" type="tertiary" icon={<ChevronDown size={14} />} iconPosition="right">
              {SORT_OPTIONS.find((o) => o.value === submittedParams.sortBy)?.label}
            </Button>
          </Dropdown>
          <Tooltip content={viewMode === 'list' ? '网格视图' : '列表视图'}>
            <Button theme="borderless" type="tertiary" icon={viewMode === 'list' ? <LayoutGrid size={16} /> : <ListIcon size={16} />}
              aria-label={viewMode === 'list' ? '切换到网格视图' : '切换到列表视图'} onClick={() => toggleView(viewMode === 'list' ? 'grid' : 'list')} />
          </Tooltip>
        </div>
      </div>

      <div className="drive-browser__body">
        {viewMode === 'list' ? (
          <ConfigurableTable<DriveNode>
            bordered
            size="small"
            rowKey="id"
            columns={columns}
            dataSource={list}
            loading={dirQuery.isFetching}
            onRefresh={() => void dirQuery.refetch()}
            refreshLoading={dirQuery.isFetching}
            pagination={buildPagination(data?.total ?? 0)}
            rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds((keys ?? []).map(Number)) }}
            onRow={(record) => ({
              onContextMenu: (e: React.MouseEvent) => { if (!record) return; e.preventDefault(); setCtx({ node: record, point: { x: e.clientX, y: e.clientY } }); },
              onDoubleClick: () => { if (record) openNode(record); },
            })}
            empty={dirQuery.isPending ? <span /> : <Empty description={submittedParams.keyword ? '没有匹配的项目' : (canUpload ? '空文件夹，拖拽文件到此处即可上传' : '空文件夹')} />}
          />
        ) : (
          <>
            {list.length === 0 && !dirQuery.isPending && !dirQuery.isFetching ? (
              <Empty description={submittedParams.keyword ? '没有匹配的项目' : (canUpload ? '空文件夹，拖拽文件到此处即可上传' : '空文件夹')} style={{ padding: 48 }} />
            ) : (
              <div className="drive-grid">
                {list.map((node) => (
                  <DriveNodeCard key={node.id} node={node} selected={selectedIds.includes(node.id)}
                    onSelect={(id, checked) => setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)))}
                    onOpen={openNode} onContextMenu={(n, point) => setCtx({ node: n, point })} />
                ))}
              </div>
            )}
            {(data?.total ?? 0) > pageSize && (
              <div className="drive-grid__pagination">
                <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
                <Typography.Text type="tertiary">第 {page} 页 · 共 {data?.total ?? 0} 项</Typography.Text>
                <Button size="small" disabled={page * pageSize >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>下一页</Button>
              </div>
            )}
          </>
        )}
      </div>

      {dragging && canUpload && <div className="drive-browser__drop-hint">释放以上传到当前目录</div>}

      {ctx && (
        <CursorContextDropdown point={ctx.point} contextKey={ctx.node.id} onClose={() => setCtx(null)} render={(
          <Dropdown.Menu>
            {nodeActions(ctx.node).map((a) => (
              <Dropdown.Item key={a.key} type={a.danger ? 'danger' : undefined} onClick={() => { void a.onClick?.(); setCtx(null); }}>{a.label}</Dropdown.Item>
            ))}
          </Dropdown.Menu>
        )} />
      )}

      <FilePreviewLayer preview={preview} />

      <AppModal visible={!!renaming || creating} title={renaming ? '重命名' : '新建文件夹'} width={460} closeOnEsc
        onCancel={() => { setRenaming(null); setCreating(false); }} onOk={() => submitName(renaming ? 'rename' : 'create')}
        okButtonProps={{ loading: rename.isPending || createFolder.isPending }}>
        <Form<{ name: string }> key={renaming ? `rename-${renaming.id}` : 'create'} getFormApi={(api) => { formApiRef.current = api; }}
          initValues={{ name: renaming?.name ?? '' }} labelPosition="left" labelWidth={70}
          onSubmit={() => void submitName(renaming ? 'rename' : 'create')}>
          <Form.Input field="name" label="名称" autoFocus maxLength={255}
            rules={[{ required: true, message: '名称不能为空' }, { pattern: /^[^\\/:*?"<>|]+$/, message: '名称不能包含 \\ / : * ? " < > |' }]} />
        </Form>
      </AppModal>

      <DriveFolderPicker visible={!!picker} title={picker?.mode === 'copy' ? '复制到' : '移动到'} okText={picker?.mode === 'copy' ? '复制' : '移动'}
        defaultSpaceId={spaceId} disabledNodeIds={picker?.nodes.filter((n) => n.type === 'folder').map((n) => n.id) ?? []}
        loading={move.isPending || copy.isPending} onCancel={() => setPicker(null)} onOk={(target) => void handlePickerOk(target)} />
    </div>
  );
}
