import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Breadcrumb,
  Checkbox,
  Dropdown,
  Modal,
  RadioGroup,
  SideSheet,
  Space,
  Spin,
  Tag,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { Folder, ChevronLeft, ChevronRight, LayoutGrid, List as ListIcon, MoreHorizontal } from 'lucide-react';
import type { FileStorageConfig, FileVisibility, FolderEntry, ManagedFile, StorageBrowseFile, StorageBrowseMode } from '@zenith/shared/platform';
import { FILE_VISIBILITY_OPTIONS, STORAGE_BROWSE_MODE_OPTIONS, fileContract } from '@zenith/shared/platform';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { formatBytes } from '@zenith/shared/core';
import { api } from '@/lib/contract-query';
import { config as appConfig } from '@/config';
import { useIsPlatformAdmin } from '@/hooks/useIsPlatformAdmin';
import { usePermission } from '@/hooks/usePermission';
import { confirmDangerAsync } from '@/utils/confirm';
import { copyTextWithToast } from '@/utils/clipboard';
import { getFileFullUrl, getFileTypeIcon, canPreviewFile } from '@/utils/file-utils';
import { buildManagedFileActions } from '@/utils/managed-file-actions';
import DateTimeText from '@/components/DateTimeText';
import { FileNameCell } from '@/components/FileNameCell';
import ConfigurableTable from '@/components/ConfigurableTable';
import { CursorContextDropdown } from '@/components/CursorContextDropdown';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { FilePreviewLayer } from '@/components/FilePreviewLayer';
import { FileDetailModal } from '@/components/FileDetailModal';
import { useFilePreview } from '@/hooks/useFilePreview';
import { useDeleteFiles, useFileDetail } from '@/hooks/queries/files';
import {
  useRegisterStorageObject,
  useRegisterStorageObjects,
  useRemoveStorageObject,
  useStorageBrowse,
} from '@/hooks/queries/file-storage-configs';
import { FileGridCard } from '../files/components/FileGridCard';
import './StorageFileBrowser.css';

const { Text } = Typography;
const PAGE_SIZE = 100;

interface StorageFileBrowserProps {
  config: FileStorageConfig | null;
  onClose: () => void;
}

type BrowserRow =
  | { kind: 'folder'; key: string; folder: FolderEntry }
  | { kind: 'file'; key: string; entry: StorageBrowseFile };

interface StorageObjectCardProps {
  entry: StorageBrowseFile;
  canRegister: boolean;
  canRemove: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onRegister: () => void;
  onRemove: () => void;
}

function StorageObjectCard({
  entry,
  canRegister,
  canRemove,
  onPreview,
  onDownload,
  onRegister,
  onRemove,
}: Readonly<StorageObjectCardProps>) {
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const ext = entry.name.includes('.') ? entry.name.split('.').pop()?.toUpperCase() ?? '' : '';
  const previewable = canPreviewFile(null, entry.name);
  const runAndClose = (action: () => void) => {
    setCtxPos(null);
    action();
  };

  return (
    <>
      <div
        className="storage-browser__object-card"
        onContextMenu={(event) => {
          event.preventDefault();
          setCtxPos({ x: event.clientX, y: event.clientY });
        }}
      >
        <button
          type="button"
          className="storage-browser__object-card-main"
          aria-label={previewable ? `预览 ${entry.name}` : entry.name}
          style={{ cursor: previewable ? 'pointer' : 'default' }}
          onClick={() => {
            if (previewable) onPreview();
          }}
        >
          <span className="storage-browser__object-card-media">
            <span className="storage-browser__object-card-icon">{getFileTypeIcon(undefined, 34, entry.name)}</span>
            {ext && <span className="storage-browser__object-card-type">{ext}</span>}
          </span>
          <Tooltip content={entry.name} position="top">
            <span className="storage-browser__object-card-name">{entry.name}</span>
          </Tooltip>
        </button>
        <div className="storage-browser__object-card-footer">
          <span className="storage-browser__object-card-meta">{entry.size === null ? '—' : formatBytes(entry.size)}</span>
          <button
            type="button"
            className="storage-browser__object-card-more"
            aria-label="更多操作"
            title="更多操作"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setCtxPos({ x: rect.right, y: rect.bottom });
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
      {ctxPos && (
        <CursorContextDropdown
          point={ctxPos}
          contextKey={entry.key}
          onClose={() => setCtxPos(null)}
          render={(
            <Dropdown.Menu>
              {previewable && <Dropdown.Item onClick={() => runAndClose(onPreview)}>预览</Dropdown.Item>}
              <Dropdown.Item onClick={() => runAndClose(onDownload)}>下载</Dropdown.Item>
              {canRegister && <Dropdown.Item onClick={() => runAndClose(onRegister)}>收录到文件列表</Dropdown.Item>}
              {canRemove && (
                <>
                  <Dropdown.Divider />
                  <Dropdown.Item type="danger" onClick={() => runAndClose(onRemove)}>删除</Dropdown.Item>
                </>
              )}
            </Dropdown.Menu>
          )}
        />
      )}
    </>
  );
}

export default function StorageFileBrowser({ config, onClose }: Readonly<StorageFileBrowserProps>) {
  const isPlatformAdmin = useIsPlatformAdmin();
  const canBrowseStorage = !appConfig.multiTenantMode || isPlatformAdmin;
  const { hasPermission } = usePermission();
  const canRegister = hasPermission('system:file:upload');
  const canRemoveUnregistered = hasPermission('system:file:delete');

  const [mode, setMode] = useState<StorageBrowseMode>(canBrowseStorage ? 'all' : 'registered');
  const [currentPath, setCurrentPath] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [historyStack, setHistoryStack] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [detailFile, setDetailFile] = useState<ManagedFile | null>(null);
  const [registerTargets, setRegisterTargets] = useState<StorageBrowseFile[] | null>(null);
  const [registerVisibility, setRegisterVisibility] = useState<FileVisibility>('public');
  const [registerComputeHash, setRegisterComputeHash] = useState(false);

  const cursor = cursorStack[cursorIndex];
  const browseQuery = useStorageBrowse(config?.id, currentPath, mode, cursor, PAGE_SIZE, !!config, !canBrowseStorage);
  const browseData = browseQuery.data ?? null;
  const loading = browseQuery.isFetching;
  const items: BrowserRow[] = useMemo(() => [
    ...(browseData?.folders ?? []).map((folder) => ({ kind: 'folder' as const, key: `folder:${folder.path}`, folder })),
    ...(browseData?.files ?? []).map((entry) => ({ kind: 'file' as const, key: `file:${entry.key}`, entry })),
  ], [browseData]);
  const registeredFiles = useMemo(
    () => (browseData?.files ?? []).map((entry) => entry.file).filter((file): file is ManagedFile => file !== null),
    [browseData],
  );
  const unregisteredFiles = useMemo(
    () => (browseData?.files ?? []).filter((entry) => !entry.registered),
    [browseData],
  );
  const preview = useFilePreview(() => registeredFiles);
  const deleteMutation = useDeleteFiles();
  const detailQuery = useFileDetail(detailFile?.id, !!detailFile);
  const displayedDetailFile = detailQuery.data ?? detailFile;
  const registerMutation = useRegisterStorageObject();
  const registerBatchMutation = useRegisterStorageObjects();
  const removeMutation = useRemoveStorageObject();

  // 切换配置 / 模式 / 路径时重置游标与预览状态
  useEffect(() => {
    if (config) {
      setMode(canBrowseStorage ? 'all' : 'registered');
      setCurrentPath('');
      setViewMode('list');
      setCursorStack([undefined]);
      setCursorIndex(0);
      setHistoryStack(['']);
      setHistoryIndex(0);
      setDetailFile(null);
      setRegisterTargets(null);
      preview.resetPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, canBrowseStorage]);

  const resetCursors = () => {
    setCursorStack([undefined]);
    setCursorIndex(0);
  };

  const changeMode = (next: StorageBrowseMode) => {
    setMode(next);
    resetCursors();
  };

  const navigateTo = (path: string, pushHistory = true) => {
    setCurrentPath(path);
    resetCursors();
    if (pushHistory) {
      setHistoryStack((prev) => {
        const next = prev.slice(0, historyIndex + 1);
        next.push(path);
        return next;
      });
      setHistoryIndex((i) => i + 1);
    }
  };

  const navigateToFolder = (folder: FolderEntry) => navigateTo(folder.path);
  const navigateToPath = (path: string) => navigateTo(path);

  const goBack = () => {
    const nextIndex = historyIndex - 1;
    const path = historyStack[nextIndex] ?? '';
    setHistoryIndex(nextIndex);
    setCurrentPath(path);
    resetCursors();
  };

  const goForward = () => {
    const nextIndex = historyIndex + 1;
    const path = historyStack[nextIndex] ?? '';
    setHistoryIndex(nextIndex);
    setCurrentPath(path);
    resetCursors();
  };

  const goNextPage = () => {
    const nextCursor = browseData?.nextCursor;
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev.slice(0, cursorIndex + 1), nextCursor]);
    setCursorIndex((index) => index + 1);
  };

  const goPrevPage = () => {
    if (cursorIndex === 0) return;
    setCursorIndex((index) => index - 1);
  };

  const handleDelete = async (file: ManagedFile) => {
    await deleteMutation.mutateAsync([file.id]);
    Toast.success('文件已删除');
    void browseQuery.refetch();
  };

  const handleOpenDetail = (file: ManagedFile) => {
    setDetailFile(file);
  };

  const handleCopyUrl = async (file: ManagedFile) => {
    await copyTextWithToast(getFileFullUrl(file.url), { success: '链接已复制', error: '复制失败，请手动复制' });
  };

  const openObject = async (entry: StorageBrowseFile, purpose: 'preview' | 'download' = 'preview') => {
    if (!config) return;
    try {
      const access = await api(fileContract.storageObjectAccessUrl, {
        // 预览内容由浏览器 fetch 后转 blob；对象存储通常未对本站开放 CORS，改走同源服务端代理
        query: { storageConfigId: config.id, key: entry.key, purpose, proxy: purpose === 'preview' },
      }, { silent: true });
      if (purpose === 'preview') {
        await preview.handlePreview({
          id: `storage:${entry.key}`,
          url: access.url,
          originalName: entry.name,
          mimeType: null,
        });
        return;
      }
      const anchor = document.createElement('a');
      anchor.href = access.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.click();
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '获取文件访问地址失败');
    }
  };

  const openRegister = (targets: StorageBrowseFile[]) => {
    setRegisterVisibility('public');
    setRegisterComputeHash(false);
    setRegisterTargets(targets);
  };

  const submitRegister = async () => {
    if (!config || !registerTargets?.length) return;
    const keys = registerTargets.map((target) => target.key);
    try {
      if (keys.length === 1) {
        await registerMutation.mutateAsync({
          body: { storageConfigId: config.id, key: keys[0], visibility: registerVisibility, computeHash: registerComputeHash },
        });
      } else {
        const result = await registerBatchMutation.mutateAsync({
          body: { storageConfigId: config.id, keys, visibility: registerVisibility, computeHash: registerComputeHash },
        });
        if (result.failed.length > 0) Toast.warning(`${result.failed.length} 个文件收录失败`);
      }
      Toast.success(keys.length === 1 ? '文件已收录' : `已收录 ${keys.length} 个文件`);
      setRegisterTargets(null);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '收录失败');
    }
  };

  const confirmRemove = async (entry: StorageBrowseFile) => {
    if (!config) return;
    if (!(await confirmDangerAsync({
      title: entry.registered ? '删除已收录文件？' : '删除存储文件？',
      content: entry.registered
        ? `将删除已收录文件记录与存储对象 ${entry.key}，该操作不可恢复。`
        : `将永久删除 ${entry.key}，该操作不可恢复。`,
      okText: '确认删除',
    }))) return;
    try {
      await removeMutation.mutateAsync({ body: { storageConfigId: config.id, key: entry.key } });
      Toast.success('文件已删除');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  const listColumns: ColumnProps<BrowserRow>[] = [
    {
      title: '名称',
      key: 'name',
      ellipsis: { showTitle: false },
      render: (_: unknown, row: BrowserRow) => {
        if (row.kind === 'folder') {
          return (
            <FileNameCell
              name={row.folder.name}
              icon={<Folder size={15} className="storage-browser__folder-icon" />}
              onClick={() => navigateToFolder(row.folder)}
            />
          );
        }
        const entry = row.entry;
        const file = entry.file;
        const previewable = file
          ? canPreviewFile(file.mimeType, file.originalName)
          : canPreviewFile(null, entry.name);
        const openPreview = file
          ? () => void preview.handlePreview(file)
          : () => void openObject(entry);
        return (
          <FileNameCell
            name={entry.name}
            mimeType={file?.mimeType}
            onClick={previewable ? openPreview : undefined}
          />
        );
      },
    },
    {
      title: '大小',
      key: 'size',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, row: BrowserRow) => {
        if (row.kind === 'folder') return <span className="table-cell-placeholder">—</span>;
        return row.entry.size === null ? <span className="table-cell-placeholder">—</span> : formatBytes(row.entry.size);
      },
    },
    {
      title: '修改时间',
      key: 'lastModified',
      width: 180,
      render: (_: unknown, row: BrowserRow) => {
        if (row.kind === 'folder' || !row.entry.lastModified) return <span className="table-cell-placeholder">—</span>;
        return <DateTimeText value={row.entry.lastModified} />;
      },
    },
    {
      title: '收录状态',
      key: 'registered',
      width: 100,
      align: 'center' as const,
      render: (_: unknown, row: BrowserRow) => {
        if (row.kind === 'folder') return <span className="table-cell-placeholder">—</span>;
        return <Tag size="small" color={row.entry.registered ? 'green' : 'grey'}>{row.entry.registered ? '已收录' : '未收录'}</Tag>;
      },
    },
    createOperationColumn<BrowserRow>({
      width: 220,
      desktopInlineKeys: ['open', 'preview', 'download', 'register'],
      actions: (row) => {
        if (row.kind === 'folder') {
          return [{ key: 'open', label: '打开', onClick: () => navigateToFolder(row.folder) }];
        }
        const entry = row.entry;
        if (entry.file) {
          const actions = buildManagedFileActions(entry.file, {
            preview,
            onDetail: (file) => { void handleOpenDetail(file); },
            onCopyUrl: handleCopyUrl,
            onDelete: handleDelete,
            canDelete: hasPermission('system:file:delete') && !entry.canDelete,
          });
          if (entry.canDelete && hasPermission('system:file:delete')) {
            actions.push({ key: 'remove-registered', label: '删除', danger: true, onClick: () => void confirmRemove(entry) });
          }
          return actions;
        }
        const previewable = canPreviewFile(null, entry.name);
        return [
          { key: 'preview', label: '预览', disabled: !previewable, onClick: () => void openObject(entry) },
          { key: 'download', label: '下载', onClick: () => void openObject(entry, 'download') },
          { key: 'register', label: '收录', hidden: !canRegister, onClick: () => openRegister([entry]) },
          { key: 'remove', label: '删除', danger: true, hidden: !canRemoveUnregistered, onClick: () => void confirmRemove(entry) },
        ];
      },
    }),
  ];

  const breadcrumbSegments = currentPath ? currentPath.split('/') : [];
  const folderCount = browseData?.folders.length ?? 0;
  const fileCount = browseData?.files.length ?? 0;
  const currentPage = cursorIndex + 1;
  const modeOptions = STORAGE_BROWSE_MODE_OPTIONS.filter((option) => canBrowseStorage || option.value === 'registered');
  const emptyText = mode === 'registered'
    ? '当前目录没有已收录文件'
    : mode === 'unregistered' ? '当前目录没有未收录文件' : '当前目录没有文件';

  return (
    <>
      <SideSheet
        title={config ? `文件浏览 · ${config.name}` : '文件浏览'}
        visible={!!config}
        onCancel={onClose}
        size="large"
        bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column' }}
        headerStyle={{ borderBottom: '1px solid var(--semi-color-border)' }}
      >
        <div className="storage-browser__toolbar">
          <Space spacing={4} style={{ flexShrink: 0 }}>
            <Button size="small" theme="borderless" type="tertiary" icon={<ChevronLeft size={15} />} disabled={historyIndex === 0} onClick={goBack} />
            <Button size="small" theme="borderless" type="tertiary" icon={<ChevronRight size={15} />} disabled={historyIndex >= historyStack.length - 1} onClick={goForward} />
          </Space>
          <Breadcrumb className="storage-browser__breadcrumb">
            <Breadcrumb.Item
              onClick={() => navigateToPath('')}
              style={{ cursor: currentPath ? 'pointer' : 'default', color: currentPath ? 'var(--semi-color-primary)' : undefined }}
            >
              根目录
            </Breadcrumb.Item>
            {breadcrumbSegments.map((segment, index) => {
              const segmentPath = breadcrumbSegments.slice(0, index + 1).join('/');
              const isLast = index === breadcrumbSegments.length - 1;
              return (
                <Breadcrumb.Item
                  key={segmentPath}
                  onClick={isLast ? undefined : () => navigateToPath(segmentPath)}
                  style={{ cursor: isLast ? 'default' : 'pointer', color: isLast ? undefined : 'var(--semi-color-primary)' }}
                >
                  {segment}
                </Breadcrumb.Item>
              );
            })}
          </Breadcrumb>
          <div className="storage-browser__toolbar-actions">
            {canBrowseStorage && mode !== 'registered' && unregisteredFiles.length > 0 && canRegister && (
              <Button size="small" theme="light" onClick={() => openRegister(unregisteredFiles)}>
                收录本页未收录文件 ({unregisteredFiles.length})
              </Button>
            )}
            {canBrowseStorage && (
              <RadioGroup
                type="button"
                value={mode}
                options={modeOptions}
                onChange={(event) => changeMode(event.target.value as StorageBrowseMode)}
                disabled={loading}
              />
            )}
            <Space spacing={0}>
              <Button
                size="small"
                theme={viewMode === 'list' ? 'solid' : 'light'}
                type={viewMode === 'list' ? 'primary' : 'tertiary'}
                icon={<ListIcon size={14} />}
                aria-label="列表视图"
                title="列表视图"
                style={{ borderRadius: '4px 0 0 4px' }}
                onClick={() => setViewMode('list')}
              />
              <Button
                size="small"
                theme={viewMode === 'grid' ? 'solid' : 'light'}
                type={viewMode === 'grid' ? 'primary' : 'tertiary'}
                icon={<LayoutGrid size={14} />}
                aria-label="网格视图"
                title="网格视图"
                style={{ borderRadius: '0 4px 4px 0' }}
                onClick={() => setViewMode('grid')}
              />
            </Space>
          </div>
        </div>

        <div className="storage-browser__content">
          <Spin spinning={loading} size="large" wrapperClassName="storage-browser__spin">
            {browseQuery.isError && !loading && (
              <div className="storage-browser__empty">
                <Space vertical align="center">
                  <Text type="danger">{browseQuery.error instanceof Error ? browseQuery.error.message : '读取存储文件失败'}</Text>
                  {canBrowseStorage && mode !== 'registered' && (
                    <Button size="small" onClick={() => changeMode('registered')}>切换到已收录文件</Button>
                  )}
                  <Button size="small" onClick={() => void browseQuery.refetch()}>重试</Button>
                </Space>
              </div>
            )}

            {!browseQuery.isError && !loading && items.length === 0 && (
              <div className="storage-browser__empty">{emptyText}</div>
            )}

            {!browseQuery.isError && viewMode === 'list' && items.length > 0 && (
              <ConfigurableTable
                bordered
                columns={listColumns}
                dataSource={items}
                rowKey={(row) => (row ? row.key : '')}
                loading={false}
                onRefresh={() => void browseQuery.refetch()}
                refreshLoading={loading}
                size="small"
                pagination={false}
                onRow={(row) => row?.kind === 'folder'
                  ? { onClick: () => navigateToFolder(row.folder), style: { cursor: 'pointer' } }
                  : {}}
              />
            )}

            {!browseQuery.isError && viewMode === 'grid' && items.length > 0 && (
              <div className="storage-browser__grid-wrap">
                {folderCount > 0 && (
                  <div className="storage-browser__grid-section">
                    <div className="storage-browser__grid-section-label">文件夹</div>
                    <div className="storage-browser__folder-grid">
                      {(browseData?.folders ?? []).map((folder) => (
                        <button key={folder.path} type="button" className="storage-browser__folder-card" onClick={() => navigateToFolder(folder)}>
                          <Folder size={32} className="storage-browser__folder-card-icon" />
                          <Tooltip content={folder.name} position="top">
                            <span className="storage-browser__folder-card-name">{folder.name}</span>
                          </Tooltip>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {registeredFiles.length > 0 && (
                  <div className="storage-browser__grid-section">
                    <div className="storage-browser__grid-section-label">已收录文件</div>
                    <div className="storage-browser__file-grid">
                      {registeredFiles.map((file) => (
                        <FileGridCard
                          key={file.id}
                          file={file}
                          selected={false}
                          canSelect={false}
                          onSelect={() => {}}
                          onPreview={preview.handlePreview}
                          onDownload={preview.handleDownload}
                          onDelete={handleDelete}
                          onDetail={handleOpenDetail}
                          onCopyUrl={handleCopyUrl}
                          canDelete={hasPermission('system:file:delete')}
                          previewLoading={preview.previewLoadingId === file.id}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {unregisteredFiles.length > 0 && (
                  <div className="storage-browser__grid-section">
                    <div className="storage-browser__grid-section-label">未收录文件</div>
                    <div className="storage-browser__file-grid">
                      {unregisteredFiles.map((entry) => (
                        <StorageObjectCard
                          key={entry.key}
                          entry={entry}
                          canRegister={canRegister}
                          canRemove={canRemoveUnregistered}
                          onPreview={() => void openObject(entry)}
                          onDownload={() => void openObject(entry, 'download')}
                          onRegister={() => openRegister([entry])}
                          onRemove={() => void confirmRemove(entry)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Spin>
        </div>

        <div className="storage-browser__footer">
          <Text type="secondary" size="small">
            {folderCount} 个文件夹 · {fileCount} 个文件
            {mode !== 'registered' && ` · 已收录 ${fileCount - unregisteredFiles.length} · 未收录 ${unregisteredFiles.length}`}
            {browseQuery.isError && ' · 读取失败'}
          </Text>
          <Space spacing={8}>
            <Button size="small" disabled={cursorIndex === 0 || loading} onClick={goPrevPage}>上一页</Button>
            <Text type="secondary" size="small">第 {currentPage} 页</Text>
            <Button size="small" disabled={!browseData?.hasMore || loading} onClick={goNextPage}>下一页</Button>
          </Space>
        </div>
      </SideSheet>

      <Modal
        title={registerTargets && registerTargets.length > 1 ? `收录 ${registerTargets.length} 个文件` : '收录到文件列表'}
        visible={!!registerTargets}
        onCancel={() => setRegisterTargets(null)}
        onOk={() => void submitRegister()}
        confirmLoading={registerMutation.isPending || registerBatchMutation.isPending}
        okText="收录"
        cancelText="取消"
      >
        <Space vertical align="start" spacing={12} style={{ width: '100%' }}>
          <Text type="secondary" size="small">
            收录后会在文件列表中创建记录，不会移动或复制存储中的文件；受控文件会尝试将对象 ACL 设为私有。
          </Text>
          <div className="storage-browser__field">
            <Text type="secondary" size="small">文件 Key</Text>
            <div className="storage-browser__register-keys">
              {(registerTargets ?? []).slice(0, 5).map((target) => <div key={target.key}>{target.key}</div>)}
              {(registerTargets?.length ?? 0) > 5 && <Text type="tertiary" size="small">等 {registerTargets!.length} 个文件</Text>}
            </div>
          </div>
          <div className="storage-browser__field">
            <Text strong>可见性</Text>
            <RadioGroup
              value={registerVisibility}
              options={FILE_VISIBILITY_OPTIONS}
              onChange={(event) => setRegisterVisibility(event.target.value as FileVisibility)}
            />
            <Text type="secondary" size="small">
              {registerVisibility === 'restricted'
                ? '受控文件会尝试将对象 ACL 设为私有，并纳入引用计数；不支持对象 ACL 的存储会拒绝收录。'
                : '公开文件可经文件中心读取；不会修改已有对象的 ACL。'}
            </Text>
          </div>
          <Checkbox checked={registerComputeHash} onChange={(event) => setRegisterComputeHash(Boolean(event.target.checked))}>
            计算 SHA-256（大文件会增加收录耗时）
          </Checkbox>
        </Space>
      </Modal>

      <FilePreviewLayer preview={preview} />

      <FileDetailModal
        visible={!!detailFile}
        file={displayedDetailFile}
        loading={detailQuery.isFetching}
        resolveUrl={(file) => getFileFullUrl(file.url)}
        onCopyUrl={(file) => void handleCopyUrl(file)}
        onClose={() => setDetailFile(null)}
      />
    </>
  );
}
