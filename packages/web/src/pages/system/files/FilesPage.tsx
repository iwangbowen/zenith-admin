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
  Typography,
} from '@douyinfe/semi-ui';
import { Plus, Search, RotateCcw, Download } from 'lucide-react';
import { TOKEN_KEY } from '@zenith/shared';
import type { FileStorageConfig, ManagedFile, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { config } from '@/config';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import './FilesPage.css';

const { Text } = Typography;

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

async function fetchProtectedFile(url: string) {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${config.apiBaseUrl}${url}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error('文件读取失败');
  }
  return response.blob();
}

export default function FilesPage() {
  const { hasPermission } = usePermission();
  interface SearchParams {
    keyword: string;
    provider: string;
    timeRange: [Date, Date] | null;
  }

  const defaultSearchParams: SearchParams = { keyword: '', provider: '', timeRange: null };
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
  const previewBlobUrlsRef = useRef<string[]>([]);
  const [defaultConfig, setDefaultConfig] = useState<FileStorageConfig | null>(null);

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
        ...(params.timeRange
          ? {
            startTime: params.timeRange[0].toISOString(),
            endTime: params.timeRange[1].toISOString(),
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
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await request.postForm<ManagedFile>('/api/files/upload', formData);
      if (res.code === 0) {
        Toast.success('文件上传成功');
        setPage(1);
        fetchDefaultConfig();
        fetchFiles();
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
    try {
      cleanupPreviewBlobs();
      const blobUrls = await Promise.all(
        imageFiles.map(async (f) => {
          const blob = await fetchProtectedFile(f.url);
          return globalThis.URL.createObjectURL(blob);
        }),
      );
      previewBlobUrlsRef.current = blobUrls;
      setPreviewSrcList(blobUrls);
      setPreviewCurrentIndex(Math.max(0, clickedIndex));
      setPreviewVisible(true);
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

  const columns: ColumnProps<ManagedFile>[] = [
    {
      title: '文件名',
      dataIndex: 'originalName',
      width: 220,
      ellipsis: true,
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
      render: (provider: ManagedFile['provider']) => (
        <Tag color={provider === 'local' ? 'blue' : 'orange'} size="small">
          {provider === 'local' ? '本地磁盘' : '阿里云 OSS'}
        </Tag>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 110,
      render: (size: number) => formatSize(size),
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
      width: 260,
      align: 'center',
      render: (_: unknown, record: ManagedFile) => (
        <Space>
          <Button theme="borderless" size="small" loading={previewLoadingId === record.id} onClick={() => handlePreview(record)}>预览</Button>
          <Button theme="borderless" size="small" onClick={() => handleDownload(record)}>下载</Button>
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
      <SearchToolbar
        className="files-toolbar"
        left={<>
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
        </>}
        right={<>
          <Button icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/files/export', '文件列表.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
          {hasPermission('system:file:upload') && <Button type="secondary" icon={<Plus size={14} />} loading={uploading} disabled={!defaultConfig} onClick={handlePickFile}>
            上传文件
          </Button>}
          <input
            ref={fileInputRef}
            type="file"
            hidden
            onChange={handleUpload}
          />
        </>}
      />

      <div className="files-default-tip" style={{ padding: '8px 0' }}>
        <Text strong>默认文件服务：</Text>
        {defaultConfig ? (
          <>
            <Tag color={defaultConfig.provider === 'local' ? 'blue' : 'orange'} size="small">
              {defaultConfig.provider === 'local' ? '本地磁盘' : '阿里云 OSS'}
            </Tag>
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
