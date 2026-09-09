import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppModal } from '@/components/AppModal';
import { Button, Checkbox, Descriptions, List, Pagination, Progress, Space, Spin, Tabs, TabPane, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import { Plus, FolderDown, LayoutGrid, List as ListIcon, CheckCircle2, XCircle, X } from 'lucide-react';
import type { ManagedFile } from '@zenith/shared/platform';
import { FILE_STORAGE_PROVIDERS, FILE_STORAGE_PROVIDER_OPTIONS, FILE_TYPE_FILTERS, FILE_TYPE_FILTER_OPTIONS, fileContract } from '@zenith/shared/platform';
import { enumValueOf } from '@zenith/shared/core';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { formatDateTime, formatDateTimeRangeForApi } from '@/utils/date';
import { downloadBlob } from '@/utils/download';
import { getFileTypeIcon, fetchManagedFileBlob, getFileFullUrl } from '@/utils/file-utils';
import { buildManagedFileActions } from '@/utils/managed-file-actions';
import { chunkedUpload, CHUNKED_UPLOAD_CANCELLED } from '@/utils/chunked-upload';
import { FilePreviewLayer } from '@/components/FilePreviewLayer';
import { useFilePreview } from '@/hooks/useFilePreview';
import FileStatsPanel from './FileStatsPanel';
import { FileGridCard } from './components/FileGridCard';
import { FileNameCell } from '@/components/FileNameCell';
import { usePermission } from '@/hooks/usePermission';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { usePreferences } from '@/hooks/usePreferences';
import { usePagination } from '@/hooks/usePagination';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { useDefaultFileStorageConfig } from '@/hooks/queries/file-storage-configs';
import { fileKeys, useChunkUploadThreshold, useDeleteFiles, useFileDetail, useFileList, useUploadFile } from '@/hooks/queries/files';
import { useListSearch } from '@/hooks/useListSearch';
import { BatchDeleteButton } from '@/components/toolbar-controls';
import { confirmAndDelete, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { copyTextWithToast } from '@/utils/clipboard';
import './FilesPage.css';

import { useUrlTabState } from '@/hooks/useUrlTabState';
import { urlOf } from '@/lib/contract-query';
import { request } from '@/utils/request';
import { formatBytes } from '@zenith/shared/core';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
const { Text } = Typography;

interface UploadItem { uid: string; name: string; size: number; progress: number; status: 'pending' | 'uploading' | 'success' | 'error' | 'cancelled'; errorMsg?: string }

const UPLOAD_ACTIVE_STATUSES: ReadonlyArray<UploadItem['status']> = ['pending', 'uploading'];
const isUploadFinished = (item: UploadItem) => !UPLOAD_ACTIVE_STATUSES.includes(item.status);

const FILE_LIST_PAGE_SIZE = 20;
const FILE_GRID_PAGE_SIZE = 60;
const FILE_LIST_PAGE_SIZE_OPTIONS = [20, 50, 100];
const FILE_GRID_PAGE_SIZE_OPTIONS = [60, 120, 240];

function getProgressStroke(status: UploadItem['status']): string | undefined {
  if (status === 'success') return 'var(--semi-color-success)';
  if (status === 'error') return 'var(--semi-color-danger)';
  if (status === 'cancelled') return 'var(--semi-color-disabled-text)';
  return undefined;
}

function uploadSingleFile(
  file: File,
  uid: string,
  signal: AbortSignal,
  chunkThreshold: number,
  setItems: React.Dispatch<React.SetStateAction<UploadItem[]>>,
  uploadFile: (formData: FormData, onProgress: (percent: number) => void, signal: AbortSignal) => Promise<unknown>,
) {
  const updateItem = (updater: (item: UploadItem) => UploadItem) =>
    setItems(prev => prev.map(item => item.uid === uid ? updater(item) : item));
  const onDone = () => updateItem(item => ({ ...item, progress: 100, status: 'success' }));
  const onFail = (err: unknown) => updateItem(item => signal.aborted
    ? { ...item, status: 'cancelled' }
    : { ...item, status: 'error', errorMsg: err instanceof Error ? err.message : '上传失败' });
  updateItem(item => ({ ...item, status: 'uploading' }));
  // 超过运行时设置的阈值走分片上传 + 断点续传
  if (file.size > chunkThreshold) {
    chunkedUpload(file, {
      signal,
      onProgress: (percent) => updateItem(item => ({ ...item, progress: percent })),
    }).then(onDone).catch(onFail);
    return;
  }
  const formData = new FormData();
  formData.append('file', file);
  void uploadFile(formData, (percent) => updateItem(item => ({ ...item, progress: percent })), signal)
    .then(onDone).catch(onFail);
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
  const [activeTab, setActiveTab] = useUrlTabState(['list', 'stats'] as const, 'list');
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const { preferences, setPreferences } = usePreferences();
  interface SearchParams {
    keyword: string;
    provider?: string;
    fileType?: string;
    timeRange: [Date, Date] | null;
  }

  const defaultSearchParams: SearchParams = { keyword: '', provider: undefined, fileType: undefined, timeRange: null };
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** 区分"页面内点击切换"与"偏好面板外部修改"，防止双重请求 */
  const isInternalToggleRef = useRef(false);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [uploadProgressVisible, setUploadProgressVisible] = useState(false);
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const {
    draftParams, setField, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: fileKeys.lists });
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
    provider: enumValueOf(FILE_STORAGE_PROVIDERS, submittedParams.provider),
    fileType: enumValueOf(FILE_TYPE_FILTERS, submittedParams.fileType),
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  });
  const data = listQuery.data ?? null;
  const preview = useFilePreview(() => data?.list ?? []);
  const uploadFileMutation = useUploadFile();
  const chunkThreshold = useChunkUploadThreshold();
  const deleteMutation = useDeleteFiles();
  const batchDeleteMutation = useDeleteFiles();
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
    if (uploadProgressVisible && uploadItems.length > 0 && uploadItems.every(isUploadFinished)) {
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

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    const items: UploadItem[] = files.map((f, i) => ({ uid: `${f.name}-${Date.now()}-${i}`, name: f.name, size: f.size, progress: 0, status: 'pending' as const }));
    uploadControllersRef.current.clear();
    setUploadItems(items);
    setUploadProgressVisible(true);
    for (const [i, file] of files.entries()) {
      const controller = new AbortController();
      uploadControllersRef.current.set(items[i].uid, controller);
      uploadSingleFile(
        file,
        items[i].uid,
        controller.signal,
        chunkThreshold,
        setUploadItems,
        (formData, onProgress, signal) => uploadFileMutation.mutateAsync({ formData, onProgress, signal }),
      );
    }
  };

  /** 用户显式取消：带原因中止，分片上传据此通知服务端释放会话，不再续传 */
  const handleCancelUpload = (uid: string) => {
    uploadControllersRef.current.get(uid)?.abort(CHUNKED_UPLOAD_CANCELLED);
  };

  const handleDelete = async (file: ManagedFile) => {
    await deleteMutation.mutateAsync([file.id]);
    Toast.success('文件已删除');
  };

  const handleBatchDelete = () => {
    confirmAndDelete({
      title: `确认删除选中的 ${selectedRowKeys.length} 个文件？`,
      content: '删除后将同步尝试删除实际存储对象，无法恢复。',
      run: () => batchDeleteMutation.mutateAsync(selectedRowKeys),
      successMessage: '批量删除成功',
      onDeleted: () => setSelectedRowKeys([]),
    });
  };

  const handleBatchDownload = async () => {
    if (selectedRowKeys.length === 0) return;
    setBatchDownloadLoading(true);
    try {
      const blob = await request.getBlob(urlOf(fileContract.batchDownload), { method: 'POST', body: JSON.stringify({ ids: selectedRowKeys }) });
      if (!blob) return;
      downloadBlob(blob, `files_${Date.now()}.zip`);
      Toast.success(`已打包 ${selectedRowKeys.length} 个文件`);
    } catch {
      Toast.error('批量下载失败');
    } finally {
      setBatchDownloadLoading(false);
    }
  };

  const handleCopyUrl = async (file: ManagedFile) => {
    await copyTextWithToast(file.directUrl ?? getFileFullUrl(file.url), { success: '链接已复制', error: '复制失败，请手动复制' });
  };

  const columns: ColumnProps<ManagedFile>[] = [
    {
      title: '文件名',
      dataIndex: 'originalName',
      minWidth: 220,
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
      render: (size: number) => formatBytes(size),
    },
    dateTimeColumn('上传时间', 'createdAt'),
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
    <KeywordInput
      placeholder="搜索文件名 / 对象键 / 文件服务"
      value={draftParams.keyword}
      onChange={setField('keyword')}
      onSearch={handleSearch}
      style={{ width: 'min(280px, 100%)' }}
    />
  );

  const renderProviderFilter = () => (
    <FilterSelect
      placeholder="全部存储类型"
      items={FILE_STORAGE_PROVIDER_OPTIONS}
      value={draftParams.provider}
      onChange={setField('provider')}
      width={140}
    />
  );

  const renderFileTypeFilter = () => (
    <FilterSelect
      placeholder="全部文件类型"
      items={FILE_TYPE_FILTER_OPTIONS}
      value={draftParams.fileType}
      onChange={setField('fileType')}
      width={140}
    />
  );

  const renderTimeRangeFilter = () => (
    <DateRangeFilter
      type="dateTimeRange"
      value={draftParams.timeRange ?? undefined}
      onChange={(value) => setField('timeRange')(value ? (value as [Date, Date]) : null)}
    />
  );

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" type="line" activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)}>
        <TabPane tab="文件列表" itemKey="list">
      <ListSearchToolbar
        keyword={renderKeywordSearch()}
        filters={(
          <>
            {renderProviderFilter()}
            {renderFileTypeFilter()}
            {renderTimeRangeFilter()}
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={hasPermission('system:file:upload') && (
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
        actions={(
          <>
            {selectedRowKeys.length > 0 && (
              <Button type="tertiary" theme="light" icon={<FolderDown size={14} />} loading={batchDownloadLoading} onClick={handleBatchDownload}>
                批量下载 ({selectedRowKeys.length})
              </Button>
            )}
            {selectedRowKeys.length > 0 && hasPermission('system:file:delete') && (
              <BatchDeleteButton count={selectedRowKeys.length} loading={batchDeleteMutation.isPending} onClick={handleBatchDelete} />
            )}
            {selectedRowKeys.length > 0 && (
              <Button type="tertiary" theme="light" icon={<X size={12} />} onClick={() => setSelectedRowKeys([])}>
                取消选择
              </Button>
            )}
            <input ref={fileInputRef} type="file" hidden multiple onChange={handleUpload} />
          </>
        )}
        mobileActions={selectedRowKeys.length > 0 ? (
          <>
            <Button type="tertiary" theme="light" icon={<FolderDown size={14} />} loading={batchDownloadLoading} onClick={handleBatchDownload}>
              批量下载 ({selectedRowKeys.length})
            </Button>
            {selectedRowKeys.length > 0 && hasPermission('system:file:delete') && (
              <BatchDeleteButton count={selectedRowKeys.length} loading={batchDeleteMutation.isPending} onClick={handleBatchDelete} />
            )}
            <Button type="tertiary" theme="light" icon={<X size={12} />} onClick={() => setSelectedRowKeys([])}>
              取消选择
            </Button>
          </>
        ) : null}
        filterTitle="文件筛选"
        actionTitle="文件操作"
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
          uploadItems.every(isUploadFinished)
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
                  <Typography.Text type="tertiary" size="small">{formatBytes(item.size)}</Typography.Text>
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
                  {item.status === 'cancelled' && (
                    <Typography.Text type="tertiary" size="small">已取消</Typography.Text>
                  )}
                  {!isUploadFinished(item) && (
                    <Tooltip content="取消上传">
                      <Button
                        theme="borderless"
                        type="tertiary"
                        size="small"
                        icon={<X size={14} />}
                        aria-label={`取消上传 ${item.name}`}
                        onClick={() => handleCancelUpload(item.uid)}
                      />
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
                { key: '文件大小', value: formatBytes(displayedDetailFile.size) },
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
        <ConfigurableTable<ManagedFile>
          columns={columns}
          empty="暂无文件记录"
          {...listTableProps(listQuery, {
            pagination: (total) => ({ ...buildPagination(total), pageSizeOpts: FILE_LIST_PAGE_SIZE_OPTIONS }),
            rowSelection: hasPermission('system:file:delete') ? {
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys((keys ?? []).map(String)),
            } : undefined,
          })}
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
