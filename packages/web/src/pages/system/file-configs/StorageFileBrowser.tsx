import { useEffect, useState } from 'react';
import {
  Button,
  Breadcrumb,
  Pagination,
  SideSheet,
  Space,
  Spin,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { Folder, ChevronLeft, ChevronRight, LayoutGrid, List as ListIcon } from 'lucide-react';
import type { FileStorageConfig, FolderEntry, ManagedFile } from '@zenith/shared/platform';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { formatDateTime } from '@/utils/date';
import { getFileFullUrl } from '@/utils/file-utils';
import { buildManagedFileActions } from '@/utils/managed-file-actions';
import { renderEllipsis } from '@/utils/table-columns';
import { copyTextWithToast } from '@/utils/clipboard';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { FilePreviewLayer } from '@/components/FilePreviewLayer';
import { FileDetailModal } from '@/components/FileDetailModal';
import { useFilePreview } from '@/hooks/useFilePreview';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { FileGridCard } from '../files/components/FileGridCard';
import { FileNameCell } from '@/components/FileNameCell';
import { useDeleteFiles, useFileDetail } from '@/hooks/queries/files';
import { useStorageBrowse } from '@/hooks/queries/file-storage-configs';
import { formatBytes } from '@zenith/shared/core';
import './StorageFileBrowser.css';

const { Text } = Typography;

interface StorageFileBrowserProps {
  config: FileStorageConfig | null;
  onClose: () => void;
}

export default function StorageFileBrowser({ config, onClose }: Readonly<StorageFileBrowserProps>) {
  const { hasPermission } = usePermission();
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [currentPath, setCurrentPath] = useState('');
  const { page, setPage } = usePagination();
  const PAGE_SIZE = 50;
  const browseQuery = useStorageBrowse(config?.id, currentPath, !!config);
  const browseData = browseQuery.data ?? null;
  const loading = browseQuery.isFetching;
  const deleteMutation = useDeleteFiles();

  // Navigation history for back/forward
  const [historyStack, setHistoryStack] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < historyStack.length - 1;

  // Preview state
  const preview = useFilePreview(() => browseData?.files ?? []);
  const [detailFile, setDetailFile] = useState<ManagedFile | null>(null);
  const detailQuery = useFileDetail(detailFile?.id, !!detailFile);
  const displayedDetailFile = detailQuery.data ?? detailFile;
  const detailFileLoading = detailQuery.isFetching;

  // Reset state whenever the config changes (different storage or re-open)
  useEffect(() => {
    if (config) {
      setCurrentPath('');
      setViewMode('list');
      setPage(1);
      setHistoryStack(['']);
      setHistoryIndex(0);
      setDetailFile(null);
      preview.resetPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, setPage]);

  const navigateTo = (path: string, pushHistory = true) => {
    setCurrentPath(path);
    setPage(1);
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
    const newIndex = historyIndex - 1;
    const path = historyStack[newIndex] ?? '';
    setHistoryIndex(newIndex);
    setCurrentPath(path);
    setPage(1);
  };

  const goForward = () => {
    const newIndex = historyIndex + 1;
    const path = historyStack[newIndex] ?? '';
    setHistoryIndex(newIndex);
    setCurrentPath(path);
    setPage(1);
  };

  // Build breadcrumb segments from currentPath
  const breadcrumbSegments = currentPath ? currentPath.split('/') : [];

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

  const listColumns: ColumnProps<ManagedFile | FolderEntry>[] = [
    {
      title: '名称',
      key: 'name',
      ellipsis: { showTitle: false },
      render: (_: unknown, record: ManagedFile | FolderEntry) => {
        if (!('id' in record)) {
          // Folder row
          return (
            <FileNameCell
              name={record.name}
              icon={<Folder size={15} className="storage-browser__folder-icon" />}
              onClick={() => navigateToFolder(record)}
            />
          );
        }
        return <FileNameCell name={record.originalName} mimeType={record.mimeType} />;
      },
    },
    {
      title: '大小',
      key: 'size',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, record: ManagedFile | FolderEntry) => {
        if (!('id' in record)) return <span className="table-cell-placeholder">—</span>;
        return formatBytes(record.size);
      },
    },
    {
      title: '上传时间',
      key: 'createdAt',
      width: 180,
      render: (_: unknown, record: ManagedFile | FolderEntry) => {
        if (!('id' in record)) return <span className="table-cell-placeholder">—</span>;
        return renderEllipsis(formatDateTime(record.createdAt));
      },
    },
    createOperationColumn<ManagedFile | FolderEntry>({
      width: 180,
      desktopInlineKeys: ['open', 'preview', 'download'],
      actions: (record) => {
        if (!('id' in record)) {
          return [
            {
              key: 'open',
              label: '打开',
              onClick: () => navigateToFolder(record),
            },
          ];
        }
        return buildManagedFileActions(record, {
          preview,
          onDetail: (file) => { void handleOpenDetail(file); },
          onCopyUrl: handleCopyUrl,
          onDelete: handleDelete,
          canDelete: hasPermission('system:file:delete'),
        });
      },
    }),
  ];

  const allItems: (ManagedFile | FolderEntry)[] = [
    ...(browseData?.folders ?? []),
    ...(browseData?.files ?? []),
  ];

  const totalCount = allItems.length;
  const pagedItems = allItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
        {/* Toolbar: back/forward + breadcrumb + view mode toggle */}
        <div className="storage-browser__toolbar">
          <Space spacing={4} style={{ flexShrink: 0 }}>
            <Button
              size="small"
              theme="borderless"
              type="tertiary"
              icon={<ChevronLeft size={15} />}
              disabled={!canGoBack}
              onClick={goBack}
            />
            <Button
              size="small"
              theme="borderless"
              type="tertiary"
              icon={<ChevronRight size={15} />}
              disabled={!canGoForward}
              onClick={goForward}
            />
          </Space>
          <Breadcrumb className="storage-browser__breadcrumb">
            <Breadcrumb.Item
              onClick={() => navigateToPath('')}
              style={{ cursor: currentPath ? 'pointer' : 'default', color: currentPath ? 'var(--semi-color-primary)' : undefined }}
            >
              根目录
            </Breadcrumb.Item>
            {breadcrumbSegments.map((seg, idx) => {
              const segPath = breadcrumbSegments.slice(0, idx + 1).join('/');
              const isLast = idx === breadcrumbSegments.length - 1;
              return (
                <Breadcrumb.Item
                  key={segPath}
                  onClick={isLast ? undefined : () => navigateToPath(segPath)}
                  style={{ cursor: isLast ? 'default' : 'pointer', color: isLast ? undefined : 'var(--semi-color-primary)' }}
                >
                  {seg}
                </Breadcrumb.Item>
              );
            })}
          </Breadcrumb>
          <Space spacing={0}>
            <Button
              size="small"
              theme={viewMode === 'list' ? 'solid' : 'light'}
              type={viewMode === 'list' ? 'primary' : 'tertiary'}
              icon={<ListIcon size={14} />}
              style={{ borderRadius: '4px 0 0 4px' }}
              onClick={() => setViewMode('list')}
            />
            <Button
              size="small"
              theme={viewMode === 'grid' ? 'solid' : 'light'}
              type={viewMode === 'grid' ? 'primary' : 'tertiary'}
              icon={<LayoutGrid size={14} />}
              style={{ borderRadius: '0 4px 4px 0' }}
              onClick={() => setViewMode('grid')}
            />
          </Space>
        </div>

        {/* Content area */}
        <div className="storage-browser__content">
          <Spin spinning={loading} size="large" wrapperClassName="storage-browser__spin">
            {!loading && totalCount === 0 && (
              <div className="storage-browser__empty">当前目录为空</div>
            )}

            {viewMode === 'list' && totalCount > 0 && (
              <ConfigurableTable
                bordered
                columns={listColumns}
                dataSource={pagedItems}
                rowKey={(record) => {
                  if (!record) return '';
                  return 'id' in record ? `file-${record.id}` : `folder-${record.path}`;
                }}
                loading={false}
                onRefresh={() => void browseQuery.refetch()}
                refreshLoading={loading}
                size="small"
                pagination={false}
                onRow={(record) => {
                  if (record && !('id' in record)) {
                    return {
                      onClick: () => navigateToFolder(record),
                      style: { cursor: 'pointer' },
                    };
                  }
                  return {};
                }}
              />
            )}

            {viewMode === 'grid' && totalCount > 0 && (() => {
              const pagedFolders = pagedItems.filter((r): r is FolderEntry => !('id' in r));
              const pagedFiles = pagedItems.filter((r): r is ManagedFile => 'id' in r);
              return (
                <div className="storage-browser__grid-wrap">
                  {pagedFolders.length > 0 && (
                    <div className="storage-browser__grid-section">
                      <div className="storage-browser__grid-section-label">文件夹</div>
                      <div className="storage-browser__folder-grid">
                        {pagedFolders.map((folder) => (
                          <button
                            key={folder.path}
                            type="button"
                            className="storage-browser__folder-card"
                            onClick={() => navigateToFolder(folder)}
                          >
                            <Folder size={32} className="storage-browser__folder-card-icon" />
                            <Tooltip content={folder.name} position="top">
                              <span className="storage-browser__folder-card-name">{folder.name}</span>
                            </Tooltip>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {pagedFiles.length > 0 && (
                    <div className="storage-browser__grid-section">
                      {pagedFolders.length > 0 && (
                        <div className="storage-browser__grid-section-label">文件</div>
                      )}
                      <div className="storage-browser__file-grid">
                        {pagedFiles.map((file) => (
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
                </div>
              );
            })()}
          </Spin>
        </div>

        {/* Footer: summary + pagination */}
        <div className="storage-browser__footer">
          <Text type="secondary" size="small">
            {(browseData?.folders.length ?? 0) > 0 && `${browseData!.folders.length} 个文件夹`}
            {(browseData?.folders.length ?? 0) > 0 && (browseData?.files.length ?? 0) > 0 && '，'}
            {(browseData?.files.length ?? 0) > 0 && `${browseData!.files.length} 个文件`}
            {totalCount === 0 && !loading && '空目录'}
          </Text>
          {totalCount > 0 && (
            <Pagination
              currentPage={page}
              pageSize={PAGE_SIZE}
              total={totalCount}
              onPageChange={setPage}
              size="small"
            />
          )}
        </div>
      </SideSheet>

      {/* Image / non-image file preview */}
      <FilePreviewLayer preview={preview} />

      {/* File detail modal */}
      <FileDetailModal
        visible={!!detailFile}
        file={displayedDetailFile}
        loading={detailFileLoading}
        resolveUrl={(file) => getFileFullUrl(file.url)}
        onCopyUrl={(file) => void handleCopyUrl(file)}
        onClose={() => setDetailFile(null)}
      />
    </>
  );
}
