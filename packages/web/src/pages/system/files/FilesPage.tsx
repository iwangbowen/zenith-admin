import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { TOKEN_KEY } from '@zenith/shared';
import type { FileStorageConfig, ManagedFile, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { config } from '../../../config';
import { request } from '../../../utils/request';
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [data, setData] = useState<PaginatedResponse<ManagedFile> | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [defaultConfig, setDefaultConfig] = useState<FileStorageConfig | null>(null);

  const fetchDefaultConfig = useCallback(async () => {
    const res = await request.get<FileStorageConfig | null>('/api/file-storage-configs/default');
    if (res.code === 0) {
      setDefaultConfig(res.data);
    }
  }, []);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<PaginatedResponse<ManagedFile>>(
        `/api/files?page=${page}&pageSize=10&keyword=${encodeURIComponent(keyword)}`
      );
      if (res.code === 0) {
        setData(res.data);
      } else {
        Toast.error(res.message);
      }
    } finally {
      setLoading(false);
    }
  }, [keyword, page]);

  useEffect(() => {
    fetchDefaultConfig();
  }, [fetchDefaultConfig]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

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
      } else {
        Toast.error(res.message);
      }
    } finally {
      setUploading(false);
    }
  };

  const handlePreview = async (file: ManagedFile) => {
    try {
      const blob = await fetchProtectedFile(file.url);
      const objectUrl = globalThis.URL.createObjectURL(blob);
      globalThis.open(objectUrl, '_blank', 'noopener,noreferrer');
      globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '预览文件失败');
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
    } else {
      Toast.error(res.message);
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
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 220,
      align: 'center',
      render: (_: unknown, record: ManagedFile) => (
        <Space wrap>
          <Button size="small" onClick={() => handlePreview(record)}>预览</Button>
          <Button size="small" onClick={() => handleDownload(record)}>下载</Button>
          <Popconfirm
            title="确认删除此文件？"
            content="删除文件记录后，将同步尝试删除实际存储对象。"
            okText="删除"
            okButtonProps={{ type: 'danger', theme: 'solid' }}
            onConfirm={() => handleDelete(record)}
          >
            <Button size="small" type="danger">删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">文件列表</h2>
          <p className="page-desc">上传并管理通过默认文件服务保存的文件记录。</p>
        </div>
      </div>

      <Card bodyStyle={{ padding: 0 }}>
        <div className="files-toolbar">
          <div className="files-toolbar__left">
            <Input
              prefix={<Search />}
              placeholder="搜索文件名 / 对象键 / 文件服务"
              value={keyword}
              onChange={setKeyword}
              onEnterPress={() => {
                setPage(1);
                fetchFiles();
              }}
              style={{ width: 280 }}
              showClear
            />
            <div className="files-default-tip">
              <Text strong>默认文件服务：</Text>
              {defaultConfig ? (
                <>
                  <Tag color={defaultConfig.provider === 'local' ? 'blue' : 'orange'} size="small">
                    {defaultConfig.provider === 'local' ? '本地磁盘' : '阿里云 OSS'}
                  </Tag>
                  <Text>{defaultConfig.name}</Text>
                </>
              ) : (
                <Text type="danger">未配置默认文件服务，请先前往“文件配置”设置。</Text>
              )}
            </div>
          </div>
          <Space>
            <Button icon={<RefreshCw />} onClick={() => {
              fetchDefaultConfig();
              fetchFiles();
            }}>
              刷新
            </Button>
            <Button type="primary" icon={<Plus />} loading={uploading} disabled={!defaultConfig} onClick={handlePickFile}>
              上传文件
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={handleUpload}
            />
          </Space>
        </div>
        <Table
          className="admin-table-nowrap"
          columns={columns}
          dataSource={data?.list || []}
          rowKey="id"
          loading={loading}
          size="small"
          empty="暂无文件记录"
          pagination={{
            currentPage: page,
            pageSize: 10,
            total: data?.total || 0,
            onPageChange: setPage,
            showTotal: true,
            showSizeChanger: false,
            style: { padding: '12px 16px 16px' },
          }}
        />
      </Card>
    </div>
  );
}
