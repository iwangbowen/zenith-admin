import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  DatePicker,
  ImagePreview,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { Plus, Search, RotateCcw, Download, Trash2, FolderDown } from 'lucide-react';
import { zipSync } from 'fflate';
import type { FileStorageConfig, ManagedFile, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { formatFileSize, getFileTypeIcon, fetchProtectedFile, getFileFullUrl } from '@/utils/file-utils';
import { config } from '@/config';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import './FilesPage.css';

const { Text } = Typography;

export default function FilesPage() {
  const { hasPermission } = usePermission();
  interface SearchParams {
    keyword: string;
    provider: string;
    fileType: string;
    timeRange: [Date, Date] | null;
  }

  const defaultSearchParams: SearchParams = { keyword: '', provider: '', fileType: '', timeRange: null };
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [data, setData] = useState<PaginatedResponse<ManagedFile> | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewSrcList, setPreviewSrcList] = useState<string[]>([]);
  const [previewCurrentIndex, setPreviewCurrentIndex] = useState(0);
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  // previewBlobUrlsRef: index-aligned with image list, tracks created blob URLs for cleanup
  const previewBlobUrlsRef = useRef<string[]>([]);
  // previewSessionRef: increments each time a new preview session starts, used to cancel stale bg loads
  const previewSessionRef = useRef(0);
  const [defaultConfig, setDefaultConfig] = useState<FileStorageConfig | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false);
  const [batchDownloadLoading, setBatchDownloadLoading] = useState(false);

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

  useEffect(() => {
    fetchDefaultConfig();
  }, [fetchDefaultConfig]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

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

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    setUploading(true);
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) {
        formData.append('file', file);
      }
      const res = await request.postForm<ManagedFile[]>('/api/files/upload', formData);
      if (res.code === 0) {
        Toast.success(res.data.length > 1 ? `成功上传 ${res.data.length} 个文件` : '文件上传成功');
        setPage(1);
        fetchDefaultConfig();
        void fetchFiles(1);
      }
    } finally {
      setUploading(false);
    }
  };

  const cleanupPreviewBlobs = () => {
    previewBlobUrlsRef.current.forEach((url) => globalThis.URL.revokeObjectURL(url));
    previewBlobUrlsRef.current = [];
  };

  const handlePreview = async (file: ManagedFile) => {
    const isImage = file.mimeType?.startsWith('image/');

    if (!isImage) {
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
    const selectedFiles = (data?.list ?? []).filter((f) => selectedRowKeys.includes(f.id));
    if (selectedFiles.length === 0) return;

    setBatchDownloadLoading(true);
    try {
      const results = await Promise.allSettled(
        selectedFiles.map(async (f) => {
          const blob = await fetchProtectedFile(f.url);
          const arrayBuffer = await blob.arrayBuffer();
          return { name: f.originalName, data: new Uint8Array(arrayBuffer) };
        }),
      );

      const failed = results.filter((r) => r.status === 'rejected').length;
      const succeeded = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<{ name: string; data: Uint8Array }>).value);

      if (succeeded.length === 0) {
        Toast.error('所有文件下载失败');
        return;
      }

      // 对重名文件追加序号
      const nameCount: Record<string, number> = {};
      const zipFiles: Record<string, Uint8Array> = {};
      for (const { name, data: fileData } of succeeded) {
        const count = nameCount[name] ?? 0;
        nameCount[name] = count + 1;
        const dedupSuffix = `_${count}`;
        const finalName = count === 0 ? name : name.replace(/(\.[^.]+)?$/, (ext: string) => `${dedupSuffix}${ext}`);
        zipFiles[finalName] = fileData;
      }

      const zipped = zipSync(zipFiles);
      const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
      const objectUrl = globalThis.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `files_${Date.now()}.zip`;
      link.click();
      globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(objectUrl), 60_000);

      if (failed > 0) {
        Toast.warning(`已打包 ${succeeded.length} 个文件，${failed} 个文件获取失败`);
      } else {
        Toast.success(`已打包 ${succeeded.length} 个文件`);
      }
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '批量下载失败');
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
      width: 180,
      ellipsis: true,
    },
    {
      title: '类型',
      dataIndex: 'provider',
      width: 120,
      render: (provider: ManagedFile['provider']) => {
        const providerMap: Record<string, { color: 'blue' | 'orange' | 'green' | 'cyan' | 'grey'; label: string }> = {
          local: { color: 'blue', label: '本地磁盘' },
          oss: { color: 'orange', label: '阿里云 OSS' },
          s3: { color: 'green', label: 'S3 存储' },
          cos: { color: 'cyan', label: '腾讯云 COS' },
        };
        const info = providerMap[provider] ?? { color: 'grey' as const, label: provider };
        return <Tag color={info.color} size="small">{info.label}</Tag>;
      },
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 110,
      render: (size: number) => formatFileSize(size),
    },
    {
      title: 'MIME',
      dataIndex: 'mimeType',
      width: 180,
      ellipsis: true,
      render: (value?: string) => value || '—',
    },
    {
      title: '对象键',
      dataIndex: 'objectKey',
      ellipsis: true,
    },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      width: 180,
      ellipsis: true,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 300,
      align: 'center',
      render: (_: unknown, record: ManagedFile) => (
        <Space>
          <Button theme="borderless" size="small" loading={previewLoadingId === record.id} onClick={() => handlePreview(record)}>预览</Button>
          <Button theme="borderless" size="small" onClick={() => handleDownload(record)}>下载</Button>
          <Button theme="borderless" size="small" onClick={() => handleCopyUrl(record)}>复制链接</Button>
          {hasPermission('system:file:delete') && <Button theme="borderless" size="small" type="danger" onClick={() => {
            Modal.confirm({
              title: '确认删除此文件？',
              content: '删除文件记录后，将同步尝试删除实际存储对象。',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record),
            });
          }}>删除</Button>}
        </Space>
      ),
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
          <Button icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/files/export', '文件列表.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
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
          {hasPermission('system:file:upload') && <Button type="secondary" icon={<Plus size={14} />} loading={uploading} disabled={!defaultConfig} onClick={handlePickFile}>
            上传文件
          </Button>}
          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            onChange={handleUpload}
          />
      </SearchToolbar>

      <div className="files-default-tip" style={{ padding: '8px 0' }}>
        <Text strong>默认文件服务：</Text>
        {defaultConfig ? (
          <>
            {(() => {
              const providerMap: Record<string, { color: 'blue' | 'orange' | 'green' | 'cyan' | 'grey'; label: string }> = {
                local: { color: 'blue', label: '本地磁盘' },
                oss: { color: 'orange', label: '阿里云 OSS' },
                s3: { color: 'green', label: 'S3 存储' },
                cos: { color: 'cyan', label: '腾讯云 COS' },
              };
              const info = providerMap[defaultConfig.provider] ?? { color: 'grey' as const, label: defaultConfig.provider };
              return <Tag color={info.color} size="small">{info.label}</Tag>;
            })()}
            <Text>{defaultConfig.name}</Text>
          </>
        ) : (
          <Text type="danger">未配置默认文件服务，请先前往"文件配置"设置。</Text>
        )}
      </div>

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

      <Table
        bordered
        className="admin-table-nowrap"
        columns={columns}
        dataSource={data?.list || []}
        rowKey="id"
        rowSelection={hasPermission('system:file:delete') ? {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
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
    </div>
  );
}
