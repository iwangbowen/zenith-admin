import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  DatePicker,
  Descriptions,
  Dropdown,
  ImagePreview,
  Input,
  List,
  Modal,
  Pagination,
  Progress,
  Select,
  Space,
  Spin,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { Plus, Search, RotateCcw, Trash2, FolderDown, MoreHorizontal, LayoutGrid, List as ListIcon, CheckCircle2, XCircle, Eye, Download } from 'lucide-react';
import type { FileStorageConfig, ManagedFile, PaginatedResponse } from '@zenith/shared';
import { TOKEN_KEY } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { formatFileSize, getFileTypeIcon, fetchProtectedFile, getFileFullUrl, canPreviewFile } from '@/utils/file-utils';
import FilePreviewModal from '@/components/FilePreviewModal';
import { config } from '@/config';
import { usePermission } from '@/hooks/usePermission';
import { usePreferences } from '@/hooks/usePreferences';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import './FilesPage.css';

const { Text } = Typography;

interface UploadItem { uid: string; name: string; size: number; progress: number; status: 'pending' | 'uploading' | 'success' | 'error'; errorMsg?: string }

function getProgressStroke(status: UploadItem['status']): string | undefined {
  if (status === 'success') return 'var(--semi-color-success)';
  if (status === 'error') return 'var(--semi-color-danger)';
  return undefined;
}

function uploadSingleFile(
  file: File,
  uid: string,
  apiBaseUrl: string,
  token: string | null,
  setItems: React.Dispatch<React.SetStateAction<UploadItem[]>>,
) {
  const updateItem = (updater: (item: UploadItem) => UploadItem) =>
    setItems(prev => prev.map(item => item.uid === uid ? updater(item) : item));
  updateItem(item => ({ ...item, status: 'uploading' }));
  const formData = new FormData();
  formData.append('file', file);
  const xhr = new XMLHttpRequest();
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable)
      updateItem(item => ({ ...item, progress: Math.round((e.loaded / e.total) * 100) }));
  };
  xhr.onload = () => {
    try {
      const resp = JSON.parse(xhr.responseText) as { code: number; message?: string };
      if (xhr.status === 200 && resp.code === 0)
        updateItem(item => ({ ...item, progress: 100, status: 'success' }));
      else
        updateItem(item => ({ ...item, status: 'error', errorMsg: resp.message || '上传失败' }));
    } catch {
      updateItem(item => ({ ...item, status: 'error', errorMsg: '解析响应失败' }));
    }
  };
  xhr.onerror = () => updateItem(item => ({ ...item, status: 'error', errorMsg: '网络错误' }));
  xhr.open('POST', `${apiBaseUrl}/api/files/upload`);
  if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  xhr.send(formData);
}

interface FileGridCardProps {
  file: ManagedFile;
  selected: boolean;
  canSelect: boolean;
  onSelect: (id: number, checked: boolean) => void;
  onPreview: (file: ManagedFile) => void;
  onDownload: (file: ManagedFile) => void;
  onDelete: (file: ManagedFile) => void;
  onDetail: (file: ManagedFile) => void;
  onCopyUrl: (file: ManagedFile) => void;
  canDelete: boolean;
  previewLoading: boolean;
  downloadLoading: boolean;
}

function FileGridCard({
  file, selected, canSelect, onSelect,
  onPreview, onDownload, onDelete, onDetail, onCopyUrl,
  canDelete, previewLoading, downloadLoading,
}: Readonly<FileGridCardProps>) {
  const isImage = file.mimeType?.startsWith('image/');
  const isPreviewable = isImage || file.mimeType?.startsWith('audio/') || file.mimeType?.startsWith('video/') || file.mimeType === 'application/pdf';
  const ext = file.originalName.includes('.') ? file.originalName.split('.').pop()?.toUpperCase() : '';
  return (
    <div className={`files-grid-card${selected ? ' files-grid-card--selected' : ''}`}>
      {canSelect && (
        <div className="files-grid-card__checkbox">
          <Checkbox
            checked={selected}
            onChange={(e) => onSelect(file.id, !!(e.target as EventTarget & { checked?: boolean }).checked)}
          />
        </div>
      )}
      <div className="files-grid-card__media-wrap">
        <button
          type="button"
          aria-label={`预览 ${file.originalName}`}
          className="files-grid-card__media"
          onClick={() => onPreview(file)}
        >
          {isImage ? (
            <img src={`${config.apiBaseUrl}${file.url}`} alt={file.originalName} loading="lazy" />
          ) : (
            <>
              <span className="files-grid-card__icon">
                {getFileTypeIcon(file.mimeType, 28)}
              </span>
              {ext && <span className="files-grid-card__type-badge">{ext}</span>}
            </>
          )}
          {previewLoading && (
            <div className="files-grid-card__media-overlay">
              <Spin />
            </div>
          )}
        </button>
        <div className="files-grid-card__quick-actions">
          {isPreviewable && (
            <Tooltip content="预览" position="top">
              <button type="button" className="files-grid-card__quick-btn" onClick={(e) => { e.stopPropagation(); onPreview(file); }}>
                <Eye size={15} />
              </button>
            </Tooltip>
          )}
          <Tooltip content="下载" position="top">
            <button type="button" className="files-grid-card__quick-btn" disabled={downloadLoading} onClick={(e) => { e.stopPropagation(); onDownload(file); }}>
              <Download size={15} />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="files-grid-card__info">
        <Tooltip content={file.originalName} position="top">
          <div className="files-grid-card__name">{file.originalName}</div>
        </Tooltip>
        <div className="files-grid-card__date">{formatDateTime(file.createdAt)}</div>
        <div className="files-grid-card__meta">
          <span style={{ flex: 1 }}>{formatFileSize(file.size)}</span>
          <Dropdown
            trigger="click"
            position="bottomRight"
            clickToHide
            render={
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => onDownload(file)}>下载</Dropdown.Item>
                <Dropdown.Item onClick={() => onDetail(file)}>详情</Dropdown.Item>
                <Dropdown.Item onClick={() => onCopyUrl(file)}>复制链接</Dropdown.Item>
                {canDelete && (
                  <>
                    <Dropdown.Divider />
                    <Dropdown.Item
                      type="danger"
                      onClick={() => {
                        Modal.confirm({
                          title: '确认删除此文件？',
                          content: '删除文件记录后，将同步尝试删除实际存储对象。',
                          okButtonProps: { type: 'danger', theme: 'solid' },
                          onOk: () => onDelete(file),
                        });
                      }}
                    >删除</Dropdown.Item>
                  </>
                )}
              </Dropdown.Menu>
            }
          >
            <span style={{ display: 'inline-block' }}>
              <Button
                theme="borderless"
                size="small"
                icon={<MoreHorizontal size={14} />}
                loading={downloadLoading}
                onClick={(e) => { e.nativeEvent.stopImmediatePropagation(); }}
              />
            </span>
          </Dropdown>
        </div>
      </div>
    </div>
  );
}

export default function FilesPage() {
  const { hasPermission } = usePermission();
  const { preferences, setPreferences } = usePreferences();
  interface SearchParams {
    keyword: string;
    provider: string;
    fileType: string;
    timeRange: [Date, Date] | null;
  }

  const defaultSearchParams: SearchParams = { keyword: '', provider: '', fileType: '', timeRange: null };
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** 区分"页面内点击切换"与"偏好面板外部修改"，防止双重请求 */
  const isInternalToggleRef = useRef(false);
  const [data, setData] = useState<PaginatedResponse<ManagedFile> | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [uploadProgressVisible, setUploadProgressVisible] = useState(false);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(
    () => (preferences.filesViewMode ?? 'list') === 'grid' ? 24 : 10,
  );
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewSrcList, setPreviewSrcList] = useState<string[]>([]);
  const [previewCurrentIndex, setPreviewCurrentIndex] = useState(0);
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const [filePreview, setFilePreview] = useState<{ url: string; name: string; mimeType: string } | null>(null);
  const [downloadLoadingId, setDownloadLoadingId] = useState<number | null>(null);
  // previewBlobUrlsRef: index-aligned with image list, tracks created blob URLs for cleanup
  const previewBlobUrlsRef = useRef<string[]>([]);
  // previewSessionRef: increments each time a new preview session starts, used to cancel stale bg loads
  const previewSessionRef = useRef(0);
  const [defaultConfig, setDefaultConfig] = useState<FileStorageConfig | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false);
  const [batchDownloadLoading, setBatchDownloadLoading] = useState(false);
  const [detailFile, setDetailFile] = useState<ManagedFile | null>(null);

  const viewMode = preferences.filesViewMode ?? 'list';

  const toggleViewMode = (mode: 'list' | 'grid') => {
    isInternalToggleRef.current = true;
    setPreferences({ filesViewMode: mode });
    const newPageSize = mode === 'grid' ? 24 : 10;
    setPage(1);
    void fetchFiles(1, newPageSize);
  };

  const handleGridSelect = (id: number, checked: boolean) => {
    setSelectedRowKeys((prev) =>
      checked ? [...prev, id] : prev.filter((k) => k !== id),
    );
  };

  const handleGridSelectAll = (checked: boolean) => {
    const currentPageIds = (data?.list ?? []).map((f) => f.id);
    if (checked) {
      setSelectedRowKeys((prev) => {
        const next = [...prev];
        for (const id of currentPageIds) {
          if (!next.includes(id)) next.push(id);
        }
        return next;
      });
    } else {
      setSelectedRowKeys((prev) => prev.filter((k) => !currentPageIds.includes(k)));
    }
  };

  const handleOpenDetail = async (file: ManagedFile) => {
    setDetailFile(file);
    const res = await request.get<ManagedFile>(`/api/files/${file.id}`);
    if (res.code === 0 && res.data) {
      setDetailFile(res.data);
    } else {
      Toast.error(res.message || '获取文件信息失败');
    }
  };

  const fetchDefaultConfig = useCallback(async () => {
    const res = await request.get<FileStorageConfig | null>('/api/file-storage-configs/default');
    if (res.code === 0) {
      setDefaultConfig(res.data);
    }
  }, []);

  const fetchFiles = useCallback(async (p = page, ps = pageSize, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.provider ? { provider: params.provider } : {}),
        ...(params.fileType ? { fileType: params.fileType } : {}),
        ...(params.timeRange
          ? {
            startTime: formatDateTimeForApi(params.timeRange[0]),
            endTime: formatDateTimeForApi(params.timeRange[1]),
          }
          : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<ManagedFile>>(`/api/files?${query}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
        setPageSize(res.data.pageSize);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchParams]);

  const fetchFilesRef = useRef(fetchFiles);

  useEffect(() => {
    fetchFilesRef.current = fetchFiles;
  }, [fetchFiles]);

  useEffect(() => {
    fetchDefaultConfig();
  }, [fetchDefaultConfig]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  // 偏好面板修改视图模式时同步 pageSize 并重新拉取数据
  useEffect(() => {
    if (isInternalToggleRef.current) {
      isInternalToggleRef.current = false;
      return;
    }
    const newPageSize = viewMode === 'grid' ? 24 : 10;
    setPage(1);
    void fetchFilesRef.current(1, newPageSize);
  }, [viewMode]);

  useEffect(() => {
    if (uploadProgressVisible && uploadItems.length > 0 &&
      uploadItems.every(item => item.status === 'success' || item.status === 'error')) {
      const successCount = uploadItems.filter(item => item.status === 'success').length;
      const timer = setTimeout(() => {
        setUploadProgressVisible(false);
        if (successCount > 0) {
          Toast.success(successCount > 1 ? `成功上传 ${successCount} 个文件` : '文件上传成功');
          void fetchDefaultConfig();
          void fetchFiles(1);
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [uploadItems, uploadProgressVisible, fetchDefaultConfig, fetchFiles]);

  function handleSearch() {
    setPage(1);
    void fetchFiles(1, pageSize);
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchFiles(1, pageSize, defaultSearchParams);
  }

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    const items: UploadItem[] = files.map((f, i) => ({ uid: `${f.name}-${Date.now()}-${i}`, name: f.name, size: f.size, progress: 0, status: 'pending' as const }));
    setUploadItems(items);
    setUploadProgressVisible(true);
    const token = localStorage.getItem(TOKEN_KEY);
    for (const [i, file] of files.entries()) {
      uploadSingleFile(file, items[i].uid, config.apiBaseUrl, token, setUploadItems);
    }
  };

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
        setFilePreview({
          url: file.url,
          name: file.originalName,
          mimeType: file.mimeType ?? 'application/octet-stream',
        });
      } catch (error) {
        Toast.error(error instanceof Error ? error.message : '预览文件失败');
      } finally {
        setPreviewLoadingId(null);
      }
      return;
    }

    const imageFiles = (data?.list ?? []).filter((f) => f.mimeType?.startsWith('image/'));
    const clickedIndex = imageFiles.findIndex((f) => f.id === file.id);

    setPreviewLoadingId(file.id);
    // Start new preview session
    previewSessionRef.current += 1;
    const mySession = previewSessionRef.current;
    try {
      cleanupPreviewBlobs();
      // Initialize with blank placeholders so the array index stays stable
      const initialUrls = imageFiles.map(() => '');
      previewBlobUrlsRef.current = [...initialUrls];

      // Load only the clicked image first → show preview immediately
      const clickedBlob = await fetchProtectedFile(imageFiles[clickedIndex].url);
      if (previewSessionRef.current !== mySession) return; // user closed preview before load finished
      const clickedUrl = globalThis.URL.createObjectURL(clickedBlob);
      initialUrls[clickedIndex] = clickedUrl;
      previewBlobUrlsRef.current[clickedIndex] = clickedUrl;

      setPreviewSrcList([...initialUrls]);
      setPreviewCurrentIndex(Math.max(0, clickedIndex));
      setPreviewVisible(true);

      // Load remaining images in background (non-blocking)
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
        } catch { /* ignore individual failures */ }
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
      fetchFiles();
    }
  };

  const handleBatchDelete = () => {
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 个文件？`,
      content: '删除后将同步尝试删除实际存储对象，无法恢复。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        setBatchDeleteLoading(true);
        try {
          const res = await request.delete<null>('/api/files/batch', { ids: selectedRowKeys });
          if (res.code === 0) {
            Toast.success(res.message || '批量删除成功');
            setSelectedRowKeys([]);
            void fetchFiles();
          }
        } finally {
          setBatchDeleteLoading(false);
        }
      },
    });
  };

  const handleBatchDownload = async () => {
    if (selectedRowKeys.length === 0) return;
    setBatchDownloadLoading(true);
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch(`${config.apiBaseUrl}/api/files/batch-download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ids: selectedRowKeys }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        Toast.error(data.message || '批量下载失败');
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `files_${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      Toast.success(`已打包 ${selectedRowKeys.length} 个文件`);
    } catch {
      Toast.error('批量下载失败');
    } finally {
      setBatchDownloadLoading(false);
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

  const columns: ColumnProps<ManagedFile>[] = [
    {
      title: '文件名',
      dataIndex: 'originalName',
      width: 220,
      ellipsis: true,
      render: (name: string, record: ManagedFile) => {
        const isImage = record.mimeType?.startsWith('image/');
        const icon = isImage ? (
          <button
            type="button"
            style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', flexShrink: 0 }}
            onClick={() => handlePreview(record)}
          >
            <img
              src={`${config.apiBaseUrl}${record.url}`}
              alt={name}
              style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 3, display: 'block' }}
            />
          </button>
        ) : (
          <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{getFileTypeIcon(record.mimeType)}</span>
        );
        return (
          <Space spacing={6} style={{ flexWrap: 'nowrap', overflow: 'hidden' }}>
            {icon}
            <Tooltip content={name}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: '来源服务',
      dataIndex: 'storageName',
      width: 120,
      ellipsis: true,
      render: (_: string, record: ManagedFile) => (
          <Text ellipsis={{ showTooltip: true }}>{record.storageName}</Text>
        ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 100,
      align: 'right' as const,
      render: (size: number) => formatFileSize(size),
    },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (value: string) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{formatDateTime(value)}</Text>,
    },
    {
      title: '操作',
      fixed: 'right',
      width: 180,
      align: 'center',
      render: (_: unknown, record: ManagedFile) => {
        const isPreviewable = record.mimeType?.startsWith('image/') || record.mimeType?.startsWith('audio/') || record.mimeType?.startsWith('video/') || record.mimeType === 'application/pdf';
        return (
        <Space>
          <Button theme="borderless" size="small" loading={downloadLoadingId === record.id} onClick={() => handleDownload(record)}>下载</Button>
          <Button theme="borderless" size="small" disabled={!isPreviewable} loading={previewLoadingId === record.id} onClick={() => handlePreview(record)}>预览</Button>
          <Dropdown
            trigger="click"
            position="bottomRight"
            clickToHide
            render={
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => void handleOpenDetail(record)}>详情</Dropdown.Item>
                <Dropdown.Item onClick={() => handleCopyUrl(record)}>复制链接</Dropdown.Item>
                {hasPermission('system:file:delete') && (
                  <>
                    <Dropdown.Divider />
                    <Dropdown.Item
                      type="danger"
                      onClick={() => { Modal.confirm({
                        title: '确认删除此文件？',
                        content: '删除文件记录后，将同步尝试删除实际存储对象。',
                        okButtonProps: { type: 'danger', theme: 'solid' },
                        onOk: () => handleDelete(record),
                      }); }}
                    >删除</Dropdown.Item>
                  </>
                )}
              </Dropdown.Menu>
            }
          >
            <span style={{ display: 'inline-block' }}>
              <Button
                theme="borderless"
                size="small"
                icon={<MoreHorizontal size={14} />}
                loading={downloadLoadingId === record.id}
                onClick={(e) => { e.nativeEvent.stopImmediatePropagation(); }}
              />
            </span>
          </Dropdown>
        </Space>
        );
      },
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar className="files-toolbar">
          <Input
            prefix={<Search size={14} />}
            placeholder="搜索文件名 / 对象键 / 文件服务"
            value={searchParams.keyword}
            onChange={(value) => setSearchParams((prev) => ({ ...prev, keyword: value }))}
            onEnterPress={handleSearch}
            style={{ width: 'min(280px, 100%)' }}
            showClear
          />
          <Select
            placeholder="存储类型"
            value={searchParams.provider || undefined}
            onChange={(value) => setSearchParams((prev) => ({ ...prev, provider: (value as string) ?? '' }))}
            style={{ width: 140 }}
            optionList={[
              { value: '', label: '全部类型' },
              { value: 'local', label: '本地磁盘' },
              { value: 'oss', label: '阿里云 OSS' },
              { value: 's3', label: 'S3 存储' },
              { value: 'cos', label: '腾讯云 COS' },
            ]}
          />
          <Select
            placeholder="文件类型"
            value={searchParams.fileType || undefined}
            onChange={(value) => setSearchParams((prev) => ({ ...prev, fileType: (value as string) ?? '' }))}
            style={{ width: 120 }}
            optionList={[
              { value: '', label: '全部' },
              { value: 'image', label: '图片' },
              { value: 'video', label: '视频' },
              { value: 'audio', label: '音频' },
              { value: 'document', label: '文档' },
            ]}
          />
          <DatePicker
            type="dateTimeRange"
            placeholder={["开始时间", "结束时间"]}
            value={searchParams.timeRange ?? undefined}
            onChange={(value) => setSearchParams((prev) => ({ ...prev, timeRange: value ? (value as [Date, Date]) : null }))}
            style={{ width: 'min(360px, 100%)' }}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          {selectedRowKeys.length > 0 && (
            <Button type="tertiary" theme="light" icon={<FolderDown size={14} />} loading={batchDownloadLoading} onClick={handleBatchDownload}>
              批量下载 ({selectedRowKeys.length})
            </Button>
          )}
          {selectedRowKeys.length > 0 && hasPermission('system:file:delete') && (
            <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={batchDeleteLoading} onClick={handleBatchDelete}>
              批量删除 ({selectedRowKeys.length})
            </Button>
          )}
          {hasPermission('system:file:upload') && (
            <Button
              type="primary"
              icon={<Plus size={14} />}
              loading={uploadProgressVisible && uploadItems.some(item => item.status === 'uploading' || item.status === 'pending')}
              disabled={!defaultConfig}
              onClick={handlePickFile}
            >
              上传文件
            </Button>
          )}
          <input ref={fileInputRef} type="file" hidden multiple onChange={handleUpload} />
      </SearchToolbar>

      <div className="files-default-tip" style={{ padding: '8px 0' }}>
        <Space>
          <Text strong>默认文件服务：</Text>
          {defaultConfig ? (
            <Text>{defaultConfig.name}</Text>
          ) : (
            <Text type="danger">未配置默认文件服务，请先前往"文件配置"设置。</Text>
          )}
        </Space>
        <Space spacing={0}>
          <Button
            size="small"
            theme={viewMode === 'list' ? 'solid' : 'light'}
            type={viewMode === 'list' ? 'primary' : 'tertiary'}
            icon={<ListIcon size={14} />}
            style={{ borderRadius: '4px 0 0 4px' }}
            onClick={() => toggleViewMode('list')}
          />
          <Button
            size="small"
            theme={viewMode === 'grid' ? 'solid' : 'light'}
            type={viewMode === 'grid' ? 'primary' : 'tertiary'}
            icon={<LayoutGrid size={14} />}
            style={{ borderRadius: '0 4px 4px 0' }}
            onClick={() => toggleViewMode('grid')}
          />
        </Space>
      </div>

      <Modal
        title="上传进度"
        visible={uploadProgressVisible}
        onCancel={() => setUploadProgressVisible(false)}
        footer={
          uploadItems.every(item => item.status === 'success' || item.status === 'error')
            ? <Button type="primary" onClick={() => setUploadProgressVisible(false)}>关闭</Button>
            : null
        }
        width={480}
        keepDOM={false}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
          {uploadItems.map((item) => (
            <div key={item.uid}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <Space spacing={6} style={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    {getFileTypeIcon(undefined, 14)}
                  </span>
                  <Typography.Text ellipsis={{ showTooltip: true }} style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
                    {item.name}
                  </Typography.Text>
                </Space>
                <Space spacing={6} style={{ flexShrink: 0, marginLeft: 8 }}>
                  <Typography.Text type="tertiary" size="small">{formatFileSize(item.size)}</Typography.Text>
                  {item.status === 'uploading' && (
                    <Typography.Text size="small">{item.progress}%</Typography.Text>
                  )}
                  {item.status === 'success' && (
                    <CheckCircle2 size={14} color="var(--semi-color-success)" />
                  )}
                  {item.status === 'error' && (
                    <Tooltip content={item.errorMsg}>
                      <XCircle size={14} color="var(--semi-color-danger)" />
                    </Tooltip>
                  )}
                </Space>
              </div>
              <Progress
                percent={item.progress}
                type="line"
                size="small"
                stroke={getProgressStroke(item.status)}
                showInfo={false}
                style={{ margin: 0 }}
              />
            </div>
          ))}
        </div>
      </Modal>

      <ImagePreview
        src={previewSrcList}
        visible={previewVisible}
        currentIndex={previewCurrentIndex}
        onChange={setPreviewCurrentIndex}
        onVisibleChange={(v) => {
          if (!v) {
            previewSessionRef.current += 1; // invalidate any in-flight background loads
            setPreviewVisible(false);
            cleanupPreviewBlobs();
            setPreviewSrcList([]);
          }
        }}
        infinite
      />

      <Modal
        title="文件详情"
        visible={!!detailFile}
        onCancel={() => { setDetailFile(null); }}
        footer={
          <Space>
            <Button onClick={() => detailFile && handleCopyUrl(detailFile)}>复制链接</Button>
            <Button type="primary" onClick={() => setDetailFile(null)}>关闭</Button>
          </Space>
        }
        width={560}
      >
        {detailFile && (
          <Descriptions
            align="left"
            size="medium"
            data={[
              { key: '文件名', value: detailFile.originalName },
              { key: '存储服务', value: detailFile.storageName },
              { key: 'MIME 类型', value: detailFile.mimeType || '—' },
              { key: '文件大小', value: formatFileSize(detailFile.size) },
              { key: '对象键', value: <Text copyable style={{ fontSize: 12, wordBreak: 'break-all' }}>{detailFile.objectKey}</Text> },
              { key: '访问链接', value: <Text copyable style={{ fontSize: 12, wordBreak: 'break-all' }}>{getFileFullUrl(detailFile.url)}</Text> },
              { key: '上传时间', value: formatDateTime(detailFile.createdAt) },
            ]}
          />
        )}
      </Modal>

      <FilePreviewModal
        fileUrl={filePreview?.url ?? ''}
        fileName={filePreview?.name}
        mimeType={filePreview?.mimeType}
        visible={!!filePreview}
        onClose={() => setFilePreview(null)}
      />

      {viewMode === 'list' ? (
        <ConfigurableTable
          bordered
          columns={columns}
          dataSource={data?.list || []}
          rowKey="id"
          rowSelection={hasPermission('system:file:delete') ? {
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys((keys as (string | number)[]).map(Number)),
          } : undefined}
          loading={loading}
          size="small"
          empty="暂无文件记录"
          pagination={{
            currentPage: page,
            pageSize: pageSize,
            total: data?.total || 0,
            onPageChange: (currentPage) => { void fetchFiles(currentPage, pageSize); },
            onPageSizeChange: (size) => {
              void fetchFiles(1, size);
            },
            showTotal: true,
            showSizeChanger: true,
          }}
        />
      ) : (
        <>
          {hasPermission('system:file:delete') && (data?.list ?? []).length > 0 && (() => {
            const currentPageIds = (data?.list ?? []).map((f) => f.id);
            const selectedOnPage = currentPageIds.filter((id) => selectedRowKeys.includes(id));
            const allSelected = selectedOnPage.length === currentPageIds.length;
            const someSelected = selectedOnPage.length > 0 && !allSelected;
            return (
              <div className="files-grid-select-bar">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={(e) => handleGridSelectAll(!!(e.target as EventTarget & { checked?: boolean }).checked)}
                >
                  全选当前页
                  {selectedOnPage.length > 0 && (
                    <span style={{ marginLeft: 4, color: 'var(--semi-color-text-2)', fontWeight: 400 }}>
                      ({selectedOnPage.length}/{currentPageIds.length})
                    </span>
                  )}
                </Checkbox>
              </div>
            );
          })()}
          <List
            grid={{
              gutter: [10, 10],
              xs: 12,
              sm: 8,
              md: 6,
              lg: 4,
              xl: 4,
              xxl: 3,
            }}
            dataSource={data?.list ?? []}
            loading={loading}
            split={false}
            emptyContent={<div className="files-grid-empty">暂无文件记录</div>}
            renderItem={(file) => (
              <List.Item key={file.id} style={{ padding: 0, height: '100%' }}>
                <FileGridCard
                  file={file}
                  selected={selectedRowKeys.includes(file.id)}
                  canSelect={hasPermission('system:file:delete')}
                  onSelect={handleGridSelect}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                  onDetail={handleOpenDetail}
                  onCopyUrl={handleCopyUrl}
                  canDelete={hasPermission('system:file:delete')}
                  previewLoading={previewLoadingId === file.id}
                  downloadLoading={downloadLoadingId === file.id}
                />
              </List.Item>
            )}
          />
          {(data?.total ?? 0) > 0 && (
            <div className="files-grid-pagination">
              <Pagination
                currentPage={page}
                pageSize={pageSize}
                total={data?.total ?? 0}
                onPageChange={(p) => { void fetchFiles(p, pageSize); }}
                onPageSizeChange={(size) => { void fetchFiles(1, size); }}
                showSizeChanger
                showTotal
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
