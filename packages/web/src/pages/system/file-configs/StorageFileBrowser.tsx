import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Breadcrumb,
  Descriptions,
  Dropdown,
  ImagePreview,
  Modal,
  Pagination,
  SideSheet,
  Space,
  Spin,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { Folder, MoreHorizontal, ChevronLeft, ChevronRight, LayoutGrid, List as ListIcon } from 'lucide-react';
import type { FileStorageConfig, FolderEntry, ManagedFile, StorageBrowseResult } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { canPreviewFile, fetchProtectedFile, formatFileSize, getFileFullUrl, getFileTypeIcon } from '@/utils/file-utils';
import { renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import FilePreviewModal from '@/components/FilePreviewModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { FileGridCard } from '../files/components/FileGridCard';
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
  const [browseData, setBrowseData] = useState<StorageBrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  // Navigation history for back/forward
  const [historyStack, setHistoryStack] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < historyStack.length - 1;

  // Preview state
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewSrcList, setPreviewSrcList] = useState<string[]>([]);
  const [previewCurrentIndex, setPreviewCurrentIndex] = useState(0);
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const [filePreview, setFilePreview] = useState<{ url: string; name: string; mimeType: string } | null>(null);
  const [downloadLoadingId, setDownloadLoadingId] = useState<number | null>(null);
  const [detailFile, setDetailFile] = useState<ManagedFile | null>(null);
  const [detailFileLoading, setDetailFileLoading] = useState(false);
  const previewBlobUrlsRef = useRef<string[]>([]);
  const previewSessionRef = useRef(0);

  const fetchBrowseData = useCallback(async (configId: number, path: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ storageConfigId: String(configId) });
      if (path) params.set('path', path);
      const res = await request.get<StorageBrowseResult>(`/api/files/browse?${params.toString()}`);
      if (res.code === 0) {
        setBrowseData(res.data);
      } else {
        Toast.error(res.message || '加载失败');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Reset state whenever the config changes (different storage or re-open)
  useEffect(() => {
    if (config) {
      setCurrentPath('');
      setBrowseData(null);
      setViewMode('list');
      setPage(1);
      setHistoryStack(['']);
      setHistoryIndex(0);
      setDetailFile(null);
      setFilePreview(null);
      setPreviewVisible(false);
      previewSessionRef.current += 1;
      void fetchBrowseData(config.id, '');
    }
  }, [config, fetchBrowseData]);

  const navigateTo = (path: string, pushHistory = true) => {
    setCurrentPath(path);
    setPage(1);
    void fetchBrowseData(config!.id, path);
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
    void fetchBrowseData(config!.id, path);
  };

  const goForward = () => {
    const newIndex = historyIndex + 1;
    const path = historyStack[newIndex] ?? '';
    setHistoryIndex(newIndex);
    setCurrentPath(path);
    setPage(1);
    void fetchBrowseData(config!.id, path);
  };

  // Build breadcrumb segments from currentPath
  const breadcrumbSegments = currentPath ? currentPath.split('/') : [];

  const cleanupPreviewBlobs = () => {
    previewBlobUrlsRef.current.forEach((url) => globalThis.URL.revokeObjectURL(url));
    previewBlobUrlsRef.current = [];
  };

  const handlePreview = async (file: ManagedFile) => {
    const isImage = file.mimeType?.startsWith('image/');
    const isPreviewable = canPreviewFile(file.mimeType);

    if (!isPreviewable && !isImage) {
      try {
        const blob = await fetchProtectedFile(file.url);
        const objectUrl = globalThis.URL.createObjectURL(blob);
        globalThis.open(objectUrl, '_blank', 'noopener,noreferrer');
        globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(objectUrl), 60_000);
      } catch (error) {
        Toast.error(error instanceof Error ? error.message : '预览文件失败');
      }
      return;
    }

    if (!isImage) {
      setPreviewLoadingId(file.id);
      try {
        setFilePreview({ url: file.url, name: file.originalName, mimeType: file.mimeType ?? 'application/octet-stream' });
      } catch (error) {
        Toast.error(error instanceof Error ? error.message : '预览文件失败');
      } finally {
        setPreviewLoadingId(null);
      }
      return;
    }

    const imageFiles = (browseData?.files ?? []).filter((f) => f.mimeType?.startsWith('image/'));
    const clickedIndex = imageFiles.findIndex((f) => f.id === file.id);
    setPreviewLoadingId(file.id);
    previewSessionRef.current += 1;
    const mySession = previewSessionRef.current;
    try {
      cleanupPreviewBlobs();
      const initialUrls = imageFiles.map(() => '');
      previewBlobUrlsRef.current = [...initialUrls];
      const clickedBlob = await fetchProtectedFile(imageFiles[clickedIndex].url);
      if (previewSessionRef.current !== mySession) return;
      const clickedUrl = globalThis.URL.createObjectURL(clickedBlob);
      initialUrls[clickedIndex] = clickedUrl;
      previewBlobUrlsRef.current[clickedIndex] = clickedUrl;
      setPreviewSrcList([...initialUrls]);
      setPreviewCurrentIndex(Math.max(0, clickedIndex));
      setPreviewVisible(true);
      imageFiles.forEach(async (imgFile, i) => {
        if (i === clickedIndex) return;
        try {
          const blob = await fetchProtectedFile(imgFile.url);
          if (previewSessionRef.current !== mySession) return;
          const url = globalThis.URL.createObjectURL(blob);
          previewBlobUrlsRef.current[i] = url;
          setPreviewSrcList((prev) => {
            const updated = [...prev];
            updated[i] = url;
            return updated;
          });
        } catch { /* ignore */ }
      });
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '预览图片失败');
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const handleDownload = async (file: ManagedFile) => {
    setDownloadLoadingId(file.id);
    try {
      const blob = await fetchProtectedFile(file.url);
      const objectUrl = globalThis.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = file.originalName;
      link.click();
      globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '下载文件失败');
    } finally {
      setDownloadLoadingId(null);
    }
  };

  const handleDelete = async (file: ManagedFile) => {
    const res = await request.delete(`/api/files/${file.id}`);
    if (res.code === 0) {
      Toast.success('文件已删除');
      void fetchBrowseData(config!.id, currentPath);
    }
  };

  const handleOpenDetail = async (file: ManagedFile) => {
    setDetailFile(file);
    setDetailFileLoading(true);
    try {
      const res = await request.get<ManagedFile>(`/api/files/${file.id}`);
      if (res.code === 0 && res.data) {
        setDetailFile(res.data);
      } else {
        Toast.error(res.message || '获取文件信息失败');
      }
    } finally {
      setDetailFileLoading(false);
    }
  };

  const handleCopyUrl = async (file: ManagedFile) => {
    try {
      await navigator.clipboard.writeText(getFileFullUrl(file.url));
      Toast.success('链接已复制');
    } catch {
      Toast.error('复制失败，请手动复制');
    }
  };

  const listColumns: ColumnProps<ManagedFile | FolderEntry>[] = [
    {
      title: '名称',
      key: 'name',
      render: (_: unknown, record: ManagedFile | FolderEntry) => {
        if (!('id' in record)) {
          // Folder row
          const folder = record as FolderEntry;
          return (
            <button
              type="button"
              className="storage-browser__folder-row-btn"
              onClick={() => navigateToFolder(folder)}
            >
              <Folder size={15} className="storage-browser__folder-icon" />
              <span>{folder.name}</span>
            </button>
          );
        }
        const file = record as ManagedFile;
        return (
          <Space spacing={6} style={{ flexWrap: 'nowrap', overflow: 'hidden' }}>
            <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{getFileTypeIcon(file.mimeType)}</span>
            <Tooltip content={file.originalName}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.originalName}</span>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: '大小',
      key: 'size',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, record: ManagedFile | FolderEntry) => {
        if (!('id' in record)) return <span className="table-cell-placeholder">—</span>;
        return formatFileSize((record as ManagedFile).size);
      },
    },
    {
      title: '上传时间',
      key: 'createdAt',
      width: 180,
      render: (_: unknown, record: ManagedFile | FolderEntry) => {
        if (!('id' in record)) return <span className="table-cell-placeholder">—</span>;
        return renderEllipsis(formatDateTime((record as ManagedFile).createdAt));
      },
    },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 180,
      align: 'center' as const,
      render: (_: unknown, record: ManagedFile | FolderEntry) => {
        if (!('id' in record)) {
          const folder = record as FolderEntry;
          return (
            <Button theme="borderless" size="small" onClick={() => navigateToFolder(folder)}>
              打开
            </Button>
          );
        }
        const file = record as ManagedFile;
        const isPreviewable = file.mimeType?.startsWith('image/') || file.mimeType?.startsWith('audio/') || file.mimeType?.startsWith('video/') || file.mimeType === 'application/pdf';
        return (
          <Space>
            <Button theme="borderless" size="small" loading={downloadLoadingId === file.id} onClick={() => handleDownload(file)}>下载</Button>
            <Button theme="borderless" size="small" disabled={!isPreviewable} loading={previewLoadingId === file.id} onClick={() => handlePreview(file)}>预览</Button>
            <Dropdown
              trigger="click"
              position="bottomRight"
              clickToHide
              render={
                <Dropdown.Menu>
                  <Dropdown.Item onClick={() => void handleOpenDetail(file)}>详情</Dropdown.Item>
                  <Dropdown.Item onClick={() => handleCopyUrl(file)}>复制链接</Dropdown.Item>
                  {hasPermission('system:file:delete') && (
                    <>
                      <Dropdown.Divider />
                      <Dropdown.Item
                        type="danger"
                        onClick={() => {
                          Modal.confirm({
                            title: '确认删除此文件？',
                            content: '删除文件记录后，将同步尝试删除实际存储对象。',
                            okButtonProps: { type: 'danger', theme: 'solid' },
                            onOk: () => handleDelete(file),
                          });
                        }}
                      >删除</Dropdown.Item>
                    </>
                  )}
                </Dropdown.Menu>
              }
            >
              <span style={{ display: 'inline-block' }}>
                <Button theme="borderless" size="small" icon={<MoreHorizontal size={14} />} onClick={(e) => { e.nativeEvent.stopImmediatePropagation(); }} />
              </span>
            </Dropdown>
          </Space>
        );
      },
    },
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
                rowKey={(record) => (record && 'id' in record ? `file-${(record as ManagedFile).id}` : `folder-${(record as FolderEntry).path}`)}
                loading={false}
                onRefresh={() => void fetchBrowseData(config.id, currentPath)}
                refreshLoading={loading}
                size="small"
                pagination={false}
                onRow={(record) => {
                  if (record && !('id' in record)) {
                    return {
                      onClick: () => navigateToFolder(record as FolderEntry),
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
                            onPreview={handlePreview}
                            onDownload={handleDownload}
                            onDelete={handleDelete}
                            onDetail={handleOpenDetail}
                            onCopyUrl={handleCopyUrl}
                            canDelete={hasPermission('system:file:delete')}
                            previewLoading={previewLoadingId === file.id}
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

      {/* Image preview */}
      <ImagePreview
        src={previewSrcList}
        visible={previewVisible}
        currentIndex={previewCurrentIndex}
        onChange={setPreviewCurrentIndex}
        onVisibleChange={(v) => {
          if (!v) {
            previewSessionRef.current += 1;
            setPreviewVisible(false);
            cleanupPreviewBlobs();
            setPreviewSrcList([]);
          }
        }}
        infinite
      />

      {/* Non-image file preview */}
      <FilePreviewModal
        fileUrl={filePreview?.url ?? ''}
        fileName={filePreview?.name}
        mimeType={filePreview?.mimeType}
        visible={!!filePreview}
        onClose={() => setFilePreview(null)}
      />

      {/* File detail modal */}
      <Modal
        title="文件详情"
        visible={!!detailFile}
        onCancel={() => { setDetailFile(null); setDetailFileLoading(false); }}
        footer={
          <Space>
            <Button onClick={() => detailFile && handleCopyUrl(detailFile)}>复制链接</Button>
            <Button type="primary" onClick={() => setDetailFile(null)}>关闭</Button>
          </Space>
        }
        width={560}
      >
        <Spin spinning={detailFileLoading} tip="加载中..." size="small">
          {detailFile && (
            <Descriptions
              align="left"
              size="medium"
              data={[
                { key: '文件名', value: detailFile.originalName },
                { key: '存储服务', value: detailFile.storageName },
                { key: 'MIME 类型', value: detailFile.mimeType || '—' },
                { key: '文件大小', value: formatFileSize(detailFile.size) },
                { key: '上传人', value: detailFile.uploaderName || '—' },
                { key: '对象键', value: <Text copyable style={{ fontSize: 12, wordBreak: 'break-all' }}>{detailFile.objectKey}</Text> },
                { key: '访问链接', value: <Text copyable style={{ fontSize: 12, wordBreak: 'break-all' }}>{getFileFullUrl(detailFile.url)}</Text> },
                { key: '上传时间', value: formatDateTime(detailFile.createdAt) },
              ]}
            />
          )}
        </Spin>
      </Modal>
    </>
  );
}
