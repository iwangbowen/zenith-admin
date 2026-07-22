import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppModal } from '@/components/AppModal';
import {
  Button,
  Checkbox,
  DatePicker,
  Descriptions,
  Input,
  List,
  Modal,
  Pagination,
  Progress,
  Select,
  Space,
  Spin,
  Tabs,
  TabPane,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { Plus, Search, RotateCcw, Trash2, FolderDown, LayoutGrid, List as ListIcon, CheckCircle2, XCircle, X } from 'lucide-react';
import type { ManagedFile } from '@zenith/shared';
import { TOKEN_KEY, FILE_STORAGE_PROVIDER_OPTIONS } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { downloadBlob } from '@/utils/download';
import { formatFileSize, getFileTypeIcon, fetchManagedFileBlob, getFileFullUrl } from '@/utils/file-utils';
import { buildManagedFileActions } from '@/utils/managed-file-actions';
import { chunkedUpload, CHUNK_SIZE } from '@/utils/chunked-upload';
import { FilePreviewLayer } from '@/components/FilePreviewLayer';
import { useFilePreview } from '@/hooks/useFilePreview';
import FileStatsPanel from './FileStatsPanel';
import { FileGridCard } from './components/FileGridCard';
import { FileNameCell } from './components/FileNameCell';
import { config } from '@/config';
import { usePermission } from '@/hooks/usePermission';
import { renderEllipsis } from '@/utils/table-columns';
import { usePreferences } from '@/hooks/usePreferences';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { useDefaultFileStorageConfig } from '@/hooks/queries/file-storage-configs';
import { fileKeys, useBatchDeleteFiles, useDeleteFile, useFileDetail, useFileList, useUploadFile } from '@/hooks/queries/files';
import './FilesPage.css';

const { Text } = Typography;

interface UploadItem { uid: string; name: string; size: number; progress: number; status: 'pending' | 'uploading' | 'success' | 'error'; errorMsg?: string }

const FILE_LIST_PAGE_SIZE = 20;
const FILE_GRID_PAGE_SIZE = 60;
const FILE_LIST_PAGE_SIZE_OPTIONS = [20, 50, 100];
const FILE_GRID_PAGE_SIZE_OPTIONS = [60, 120, 240];

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
  uploadFile: (formData: FormData, onProgress: (percent: number) => void) => Promise<unknown>,
) {
  const updateItem = (updater: (item: UploadItem) => UploadItem) =>
    setItems(prev => prev.map(item => item.uid === uid ? updater(item) : item));
  updateItem(item => ({ ...item, status: 'uploading' }));
  // 大文件走分片上传 + 断点续传
  if (file.size > CHUNK_SIZE) {
    chunkedUpload(file, {
      apiBaseUrl,
      token,
      onProgress: (percent) => updateItem(item => ({ ...item, progress: percent })),
    })
      .then(() => updateItem(item => ({ ...item, progress: 100, status: 'success' })))
      .catch((err: unknown) => updateItem(item => ({ ...item, status: 'error', errorMsg: err instanceof Error ? err.message : '上传失败' })));
    return;
  }
  const formData = new FormData();
  formData.append('file', file);
  void uploadFile(formData, (percent) => updateItem(item => ({ ...item, progress: percent })))
    .then(() => updateItem(item => ({ ...item, progress: 100, status: 'success' })))
    .catch((err: unknown) => updateItem(item => ({ ...item, status: 'error', errorMsg: err instanceof Error ? err.message : '上传失败' })));
}

/** 加载图片并返回其分辨率，失败时返回 null；优先用 directUrl 直挂（免 blob fetch/CORS） */
async function loadImageResolution(file: { url: string; directUrl?: string | null }): Promise<{ width: number; height: number } | null> {
  try {
    let src: string;
    const external = file.directUrl ?? (/^https?:\/\//.test(file.url) ? file.url : null);
    if (external) {
      src = external;
    } else {
      const blob = await fetchManagedFileBlob(file.url);
      src = URL.createObjectURL(blob);
    }
    return await new Promise((resolve) => {
      const img = new Image();
      const cleanup = () => { if (!external) URL.revokeObjectURL(src); };
      img.onload = () => { cleanup(); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { cleanup(); resolve(null); };
      img.src = src;
    });
  } catch {
    return null;
  }
}

export default function FilesPage() {
  const queryClient = useQueryClient();
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
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [uploadProgressVisible, setUploadProgressVisible] = useState(false);
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination(
    (preferences.filesViewMode ?? 'list') === 'grid' ? FILE_GRID_PAGE_SIZE : FILE_LIST_PAGE_SIZE,
  );
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchDownloadLoading, setBatchDownloadLoading] = useState(false);
  const [detailFile, setDetailFile] = useState<ManagedFile | null>(null);
  const [imageResolution, setImageResolution] = useState<{ width: number; height: number } | null>(null);

  const viewMode = preferences.filesViewMode ?? 'list';
  const defaultConfigQuery = useDefaultFileStorageConfig();
  const defaultConfig = defaultConfigQuery.data ?? null;
  const listQuery = useFileList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    provider: submittedParams.provider || undefined,
    fileType: submittedParams.fileType || undefined,
    startTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[0]) : undefined,
    endTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[1]) : undefined,
  });
  const data = listQuery.data ?? null;
  const preview = useFilePreview(() => data?.list ?? []);
  const uploadFileMutation = useUploadFile();
  const deleteMutation = useDeleteFile();
  const batchDeleteMutation = useBatchDeleteFiles();
  const detailQuery = useFileDetail(detailFile?.id, !!detailFile);
  const displayedDetailFile = detailQuery.data ?? detailFile;
  const detailFileLoading = detailQuery.isFetching;

  const toggleViewMode = (mode: 'list' | 'grid') => {
    isInternalToggleRef.current = true;
    setPreferences({ filesViewMode: mode });
    const newPageSize = mode === 'grid' ? FILE_GRID_PAGE_SIZE : FILE_LIST_PAGE_SIZE;
    setPage(1);
    setPageSize(newPageSize);
    void queryClient.invalidateQueries({ queryKey: fileKeys.lists });
  };

  const handleGridSelect = (id: string, checked: boolean) => {
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

  const handleOpenDetail = (file: ManagedFile) => {
    setDetailFile(file);
    setImageResolution(null);
  };

  // 偏好面板修改视图模式时同步 pageSize 并重新拉取数据
  useEffect(() => {
    if (isInternalToggleRef.current) {
      isInternalToggleRef.current = false;
      return;
    }
    const newPageSize = viewMode === 'grid' ? FILE_GRID_PAGE_SIZE : FILE_LIST_PAGE_SIZE;
    setPage(1);
    setPageSize(newPageSize);
    void queryClient.invalidateQueries({ queryKey: fileKeys.lists });
  }, [viewMode, setPage, setPageSize, queryClient]);

  useEffect(() => {
    const file = detailQuery.data;
    if (file?.mimeType?.startsWith('image/')) {
      void loadImageResolution(file).then((r) => { if (r) setImageResolution(r); });
    }
  }, [detailQuery.data]);

  useEffect(() => {
    if (uploadProgressVisible && uploadItems.length > 0 &&
      uploadItems.every(item => item.status === 'success' || item.status === 'error')) {
      const successCount = uploadItems.filter(item => item.status === 'success').length;
      const timer = setTimeout(() => {
        setUploadProgressVisible(false);
        if (successCount > 0) {
          Toast.success(successCount > 1 ? `成功上传 ${successCount} 个文件` : '文件上传成功');
          setPage(1);
          void queryClient.invalidateQueries({ queryKey: fileKeys.all });
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [uploadItems, uploadProgressVisible, queryClient, setPage]);

  function handleSearch() {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: fileKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: fileKeys.lists });
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
      uploadSingleFile(
        file,
        items[i].uid,
        config.apiBaseUrl,
        token,
        setUploadItems,
        (formData, onProgress) => uploadFileMutation.mutateAsync({ formData, onProgress }),
      );
    }
  };

  const handleDelete = async (file: ManagedFile) => {
    await deleteMutation.mutateAsync(file.id);
    Toast.success('文件已删除');
  };

  const handleBatchDelete = () => {
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 个文件？`,
      content: '删除后将同步尝试删除实际存储对象，无法恢复。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await batchDeleteMutation.mutateAsync(selectedRowKeys);
        Toast.success('批量删除成功');
        setSelectedRowKeys([]);
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
      downloadBlob(blob, `files_${Date.now()}.zip`);
      Toast.success(`已打包 ${selectedRowKeys.length} 个文件`);
    } catch {
      Toast.error('批量下载失败');
    } finally {
      setBatchDownloadLoading(false);
    }
  };

  const handleCopyUrl = async (file: ManagedFile) => {
    try {
      await navigator.clipboard.writeText(file.directUrl ?? getFileFullUrl(file.url));
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
      ellipsis: { showTitle: false },
      render: (name: string, record: ManagedFile) => (
        <FileNameCell name={name} mimeType={record.mimeType} />
      ),
    },
    {
      title: '来源服务',
      dataIndex: 'storageName',
      width: 120,
      ellipsis: true,
      render: (_: string, record: ManagedFile) => renderEllipsis(record.storageName),
    },
    {
      title: 'MIME 类型',
      dataIndex: 'mimeType',
      width: 160,
      ellipsis: true,
      render: (v: string | null) => renderEllipsis(v ?? '—'),
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
      render: (value: string) => renderEllipsis(formatDateTime(value)),
    },
    {
      title: '上传人',
      dataIndex: 'uploaderName',
      width: 100,
      ellipsis: true,
      render: (value: string) => renderEllipsis(value || '—'),
    },
    createOperationColumn<ManagedFile>({
      width: 180,
      desktopInlineKeys: ['preview', 'download'],
      actions: (record) => buildManagedFileActions(record, {
        preview,
        onDetail: (file) => { void handleOpenDetail(file); },
        onCopyUrl: handleCopyUrl,
        onDelete: handleDelete,
        canDelete: hasPermission('system:file:delete'),
      }),
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索文件名 / 对象键 / 文件服务"
      value={draftParams.keyword}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))}
      onEnterPress={handleSearch}
      style={{ width: 'min(280px, 100%)' }}
      showClear
    />
  );

  const renderProviderFilter = () => (
    <Select
      placeholder="存储类型"
      value={draftParams.provider || undefined}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, provider: (value as string) ?? '' }))}
      style={{ width: 140 }}
      optionList={[
        { value: '', label: '全部类型' },
        ...FILE_STORAGE_PROVIDER_OPTIONS,
      ]}
    />
  );

  const renderFileTypeFilter = () => (
    <Select
      placeholder="文件类型"
      value={draftParams.fileType || undefined}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, fileType: (value as string) ?? '' }))}
      style={{ width: 120 }}
      optionList={[
        { value: '', label: '全部' },
        { value: 'image', label: '图片' },
        { value: 'video', label: '视频' },
        { value: 'audio', label: '音频' },
        { value: 'document', label: '文档' },
      ]}
    />
  );

  const renderTimeRangeFilter = () => (
    <DatePicker
      type="dateTimeRange"
      placeholder={['开始时间', '结束时间']}
      value={draftParams.timeRange ?? undefined}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, timeRange: value ? (value as [Date, Date]) : null }))}
      style={{ width: 'min(360px, 100%)' }}
    />
  );

  return (
    <div className="page-container page-tabs-page">
      <Tabs defaultActiveKey="list" type="line">
        <TabPane tab="文件列表" itemKey="list">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderProviderFilter()}
            {renderFileTypeFilter()}
            {renderTimeRangeFilter()}
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
        actions={(
          <>
            {selectedRowKeys.length > 0 && (
              <Button type="tertiary" theme="light" icon={<FolderDown size={14} />} loading={batchDownloadLoading} onClick={handleBatchDownload}>
                批量下载 ({selectedRowKeys.length})
              </Button>
            )}
            {selectedRowKeys.length > 0 && hasPermission('system:file:delete') && (
              <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={batchDeleteMutation.isPending} onClick={handleBatchDelete}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            )}
            {selectedRowKeys.length > 0 && (
              <Button type="tertiary" theme="light" icon={<X size={12} />} onClick={() => setSelectedRowKeys([])}>
                取消选择
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
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
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
          </>
        )}
        mobileFilters={(
          <>
            {renderProviderFilter()}
            {renderFileTypeFilter()}
            {renderTimeRangeFilter()}
          </>
        )}
        mobileActions={selectedRowKeys.length > 0 ? (
          <>
            <Button type="tertiary" theme="light" icon={<FolderDown size={14} />} loading={batchDownloadLoading} onClick={handleBatchDownload}>
              批量下载 ({selectedRowKeys.length})
            </Button>
            {selectedRowKeys.length > 0 && hasPermission('system:file:delete') && (
              <Button type="danger" theme="light" icon={<Trash2 size={14} />} loading={batchDeleteMutation.isPending} onClick={handleBatchDelete}>
                批量删除 ({selectedRowKeys.length})
              </Button>
            )}
            <Button type="tertiary" theme="light" icon={<X size={12} />} onClick={() => setSelectedRowKeys([])}>
              取消选择
            </Button>
          </>
        ) : null}
        filterTitle="文件筛选"
        actionTitle="文件操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

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

      <AppModal
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
                    {getFileTypeIcon(undefined, 14, item.name)}
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
      </AppModal>

      <FilePreviewLayer preview={preview} />

      <AppModal
        title="文件详情"
        visible={!!detailFile}
        onCancel={() => { setDetailFile(null); setImageResolution(null); }}
        footer={
          <Space>
            <Button onClick={() => displayedDetailFile && handleCopyUrl(displayedDetailFile)}>复制链接</Button>
            <Button type="primary" onClick={() => setDetailFile(null)}>关闭</Button>
          </Space>
        }
        width={560}
      >
        <Spin spinning={detailFileLoading} tip="加载中..." size="small">
          {displayedDetailFile && (
            <Descriptions
              align="left"
              size="medium"
              data={[
                { key: '文件名', value: displayedDetailFile.originalName },
                { key: '存储服务', value: displayedDetailFile.storageName },
                { key: 'MIME 类型', value: displayedDetailFile.mimeType || '—' },
                { key: '文件大小', value: formatFileSize(displayedDetailFile.size) },
                ...(imageResolution ? [{ key: '分辨率', value: `${imageResolution.width} × ${imageResolution.height} px` }] : []),
                { key: '上传人', value: displayedDetailFile.uploaderName || '—' },
                { key: '对象键', value: <Text copyable style={{ fontSize: 12, wordBreak: 'break-all' }}>{displayedDetailFile.objectKey}</Text> },
                { key: '访问链接', value: <Text copyable style={{ fontSize: 12, wordBreak: 'break-all' }}>{displayedDetailFile.directUrl ?? getFileFullUrl(displayedDetailFile.url)}</Text> },
                { key: '上传时间', value: formatDateTime(displayedDetailFile.createdAt) },
              ]}
            />
          )}
        </Spin>
      </AppModal>

      {viewMode === 'list' ? (
        <ConfigurableTable
          bordered
          columns={columns}
          dataSource={data?.list || []}
          rowKey="id"
          rowSelection={hasPermission('system:file:delete') ? {
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys((keys ?? []).map(String)),
          } : undefined}
          loading={listQuery.isFetching}
          onRefresh={() => void listQuery.refetch()}
          refreshLoading={listQuery.isFetching}
          size="small"
          empty="暂无文件记录"
          pagination={{ ...buildPagination(data?.total ?? 0), pageSizeOpts: FILE_LIST_PAGE_SIZE_OPTIONS }}
        />
      ) : (
        <>
          {hasPermission('system:file:delete') && (data?.list ?? []).length > 0 && (() => {
            const currentPageIds = (data?.list ?? []).map((f) => f.id);
            const selectedOnPage = currentPageIds.filter((id) => selectedRowKeys.includes(id));
            const allSelected = selectedOnPage.length === currentPageIds.length;
            const someSelected = selectedOnPage.length > 0 && !allSelected;
            return (
              <div className="files-grid-select-bar" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={() => handleGridSelectAll(!allSelected)}
                >
                  <span style={{ fontSize: 14, color: 'var(--semi-color-text-0)' }}>
                    全选当前页
                    {selectedOnPage.length > 0 && (
                      <span style={{ marginLeft: 4, color: 'var(--semi-color-text-2)', fontWeight: 400 }}>
                        ({selectedOnPage.length}/{currentPageIds.length})
                      </span>
                    )}
                  </span>
                </Checkbox>
                {selectedRowKeys.length > 0 && (
                  <Button
                    size="small"
                    theme="light"
                    type="tertiary"
                    icon={<X size={12} />}
                    onClick={() => setSelectedRowKeys([])}
                  >
                    已选 {selectedRowKeys.length} 项，取消选择
                  </Button>
                )}
              </div>
            );
          })()}
          <List
            grid={{
              gutter: [6, 8],
              xs: 8,
              sm: 6,
              md: 4,
              lg: 3,
              xl: 2,
              xxl: 2,
            }}
            dataSource={data?.list ?? []}
            loading={listQuery.isFetching}
            split={false}
            emptyContent={<div className="files-grid-empty">暂无文件记录</div>}
            renderItem={(file) => (
              <List.Item key={file.id} style={{ padding: 0, height: '100%' }}>
                <FileGridCard
                  file={file}
                  selected={selectedRowKeys.includes(file.id)}
                  canSelect={hasPermission('system:file:delete')}
                  onSelect={handleGridSelect}
                  onPreview={preview.handlePreview}
                  onDownload={preview.handleDownload}
                  onDelete={handleDelete}
                  onDetail={handleOpenDetail}
                  onCopyUrl={handleCopyUrl}
                  canDelete={hasPermission('system:file:delete')}
                  previewLoading={preview.previewLoadingId === file.id}
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
                onPageChange={(p) => { setPage(p); }}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
                showSizeChanger
                showTotal
                pageSizeOpts={FILE_GRID_PAGE_SIZE_OPTIONS}
              />
            </div>
          )}
        </>
      )}
        </TabPane>
        <TabPane tab="统计分析" itemKey="stats">
          <FileStatsPanel />
        </TabPane>
      </Tabs>
    </div>
  );
}
