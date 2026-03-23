import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { Plus, RefreshCw } from 'lucide-react';
import type {
  CreateFileStorageConfigInput,
  FileStorageConfig,
  FileStorageProvider,
  UpdateFileStorageConfigInput,
} from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '../../../utils/request';
import './FileStorageConfigsPage.css';

const { Text } = Typography;

type FileStorageConfigFormValues = UpdateFileStorageConfigInput;

function normalizeOptional(value?: string) {
  const next = value?.trim();
  return next ? next : undefined;
}

function buildPayload(provider: FileStorageProvider, isDefault: boolean, values: FileStorageConfigFormValues): CreateFileStorageConfigInput {
  if (provider === 'local') {
    return {
      name: values.name?.trim() ?? '',
      provider,
      status: values.status ?? 'active',
      isDefault,
      basePath: normalizeOptional(values.basePath),
      localRootPath: normalizeOptional(values.localRootPath),
      remark: normalizeOptional(values.remark),
    };
  }

  return {
    name: values.name?.trim() ?? '',
    provider,
    status: values.status ?? 'active',
    isDefault,
    basePath: normalizeOptional(values.basePath),
    ossRegion: normalizeOptional(values.ossRegion),
    ossEndpoint: normalizeOptional(values.ossEndpoint),
    ossBucket: normalizeOptional(values.ossBucket),
    ossAccessKeyId: normalizeOptional(values.ossAccessKeyId),
    ossAccessKeySecret: normalizeOptional(values.ossAccessKeySecret),
    remark: normalizeOptional(values.remark),
  };
}

function getStorageSummary(config: FileStorageConfig) {
  if (config.provider === 'local') {
    return config.localRootPath || '—';
  }
  return [config.ossBucket, config.ossRegion].filter(Boolean).join(' / ') || '—';
}

export default function FileStorageConfigsPage() {
  const [configs, setConfigs] = useState<FileStorageConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<FileStorageConfig | null>(null);
  const [formProvider, setFormProvider] = useState<FileStorageProvider>('local');
  const [formIsDefault, setFormIsDefault] = useState(false);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<FileStorageConfig[]>('/api/file-storage-configs');
      if (res.code === 0) {
        setConfigs(res.data);
      } else {
        Toast.error(res.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const openCreate = () => {
    setEditingConfig(null);
    setFormProvider('local');
    setFormIsDefault(false);
    setModalVisible(true);
  };

  const openEdit = (config: FileStorageConfig) => {
    setEditingConfig(config);
    setFormProvider(config.provider);
    setFormIsDefault(config.isDefault);
    setModalVisible(true);
  };

  const handleSubmit = async (values: FileStorageConfigFormValues) => {
    const payload = buildPayload(formProvider, formIsDefault, values);
    const res = editingConfig
      ? await request.put<FileStorageConfig>(`/api/file-storage-configs/${editingConfig.id}`, payload)
      : await request.post<FileStorageConfig>('/api/file-storage-configs', payload);

    if (res.code === 0) {
      Toast.success(editingConfig ? '文件服务配置已更新' : '文件服务配置已创建');
      setModalVisible(false);
      setEditingConfig(null);
      fetchConfigs();
    } else {
      Toast.error(res.message);
    }
  };

  const handleDelete = async (config: FileStorageConfig) => {
    const res = await request.delete(`/api/file-storage-configs/${config.id}`);
    if (res.code === 0) {
      Toast.success('文件服务配置已删除');
      fetchConfigs();
    } else {
      Toast.error(res.message);
    }
  };

  const handleSetDefault = async (config: FileStorageConfig) => {
    const res = await request.put<FileStorageConfig>(`/api/file-storage-configs/${config.id}/default`);
    if (res.code === 0) {
      Toast.success('默认文件服务已更新');
      fetchConfigs();
    } else {
      Toast.error(res.message);
    }
  };

  const columns: ColumnProps<FileStorageConfig>[] = [
    {
      title: '配置名称',
      dataIndex: 'name',
      width: 180,
      ellipsis: true,
    },
    {
      title: '存储类型',
      dataIndex: 'provider',
      width: 120,
      render: (provider: FileStorageProvider) => (
        <Tag color={provider === 'local' ? 'blue' : 'orange'} size="small">
          {provider === 'local' ? '本地磁盘' : '阿里云 OSS'}
        </Tag>
      ),
    },
    {
      title: '默认服务',
      dataIndex: 'isDefault',
      width: 110,
      align: 'center',
      render: (isDefault: boolean) => isDefault ? <Tag color="green" size="small">默认</Tag> : <span className="table-cell-placeholder">—</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      render: (status: FileStorageConfig['status']) => (
        <Tag color={status === 'active' ? 'green' : 'grey'} size="small">
          {status === 'active' ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '存储信息',
      dataIndex: 'provider',
      ellipsis: { showTitle: false },
      render: (_: unknown, record: FileStorageConfig) => (
        <div className="storage-summary-cell" title={getStorageSummary(record)}>
          <Text strong>{record.provider === 'local' ? '目录' : 'Bucket / Region'}</Text>
          <span className="table-cell-ellipsis">{getStorageSummary(record)}</span>
        </div>
      ),
    },
    {
      title: '基础路径',
      dataIndex: 'basePath',
      width: 160,
      ellipsis: true,
      render: (value?: string) => value || '—',
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      ellipsis: true,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 260,
      align: 'center',
      render: (_: unknown, record: FileStorageConfig) => (
        <Space wrap>
          <Button size="small" onClick={() => handleSetDefault(record)} disabled={record.isDefault || record.status !== 'active'}>
            设为默认
          </Button>
          <Button size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除此文件服务配置？"
            content="若已绑定文件记录，后端会阻止删除。"
            okText="删除"
            okButtonProps={{ type: 'danger', theme: 'solid' }}
            onConfirm={() => handleDelete(record)}
          >
            <Button size="small" type="danger" disabled={record.isDefault}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const initValues: FileStorageConfigFormValues = editingConfig
    ? {
        ...editingConfig,
        basePath: editingConfig.basePath ?? '',
        localRootPath: editingConfig.localRootPath ?? '',
        ossRegion: editingConfig.ossRegion ?? '',
        ossEndpoint: editingConfig.ossEndpoint ?? '',
        ossBucket: editingConfig.ossBucket ?? '',
        ossAccessKeyId: editingConfig.ossAccessKeyId ?? '',
        ossAccessKeySecret: editingConfig.ossAccessKeySecret ?? '',
        remark: editingConfig.remark ?? '',
      }
    : {
        name: '',
        provider: 'local',
        status: 'active',
        isDefault: false,
        basePath: 'uploads',
        localRootPath: 'storage/local',
        remark: '',
      };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">文件配置</h2>
          <p className="page-desc">管理多文件服务，支持本地磁盘与阿里云 OSS，默认启用本地磁盘。</p>
        </div>
        <Space>
          <Button icon={<RefreshCw />} onClick={fetchConfigs}>刷新</Button>
          <Button type="primary" icon={<Plus />} onClick={openCreate}>新增配置</Button>
        </Space>
      </div>

      <Card>
        <div className="storage-configs-tip">
          <Text type="secondary">当前支持多文件服务配置，但上传时会优先走“默认文件服务”。切换默认服务不会影响历史文件记录。</Text>
        </div>
        <Table
          className="admin-table-nowrap"
          columns={columns}
          dataSource={configs}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
        />
      </Card>

      <Modal
        title={editingConfig ? '编辑文件配置' : '新增文件配置'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingConfig(null);
        }}
        footer={null}
        width={620}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          key={editingConfig?.id ?? 'new-file-storage-config'}
          initValues={initValues}
          onSubmit={handleSubmit}
          labelPosition="left"
          labelWidth={96}
        >
          <div className="storage-config-form-header">
            <Text strong>配置选项</Text>
            <div className="storage-config-default-switch">
              <span>设为默认服务</span>
              <Switch checked={formIsDefault} onChange={(checked) => setFormIsDefault(checked)} />
            </div>
          </div>
          <Form.Input field="name" label="配置名称" rules={[{ required: true, message: '请输入配置名称' }]} />
          <Form.Select
            field="provider"
            label="存储类型"
            style={{ width: '100%' }}
            onChange={(value) => setFormProvider(value as FileStorageProvider)}
          >
            <Select.Option value="local">本地磁盘</Select.Option>
            <Select.Option value="oss">阿里云 OSS</Select.Option>
          </Form.Select>
          <Form.Select field="status" label="状态" style={{ width: '100%' }}>
            <Select.Option value="active">启用</Select.Option>
            <Select.Option value="disabled">禁用</Select.Option>
          </Form.Select>
          <Form.Input field="basePath" label="基础路径" placeholder="例如 uploads / images" />

          {formProvider === 'local' ? (
            <Form.Input
              field="localRootPath"
              label="存储目录"
              placeholder="例如 storage/local 或 D:/uploads"
              rules={[{ required: true, message: '请输入本地磁盘存储目录' }]}
            />
          ) : (
            <>
              <Form.Input field="ossRegion" label="Region" rules={[{ required: true, message: '请输入 OSS Region' }]} />
              <Form.Input field="ossEndpoint" label="Endpoint" rules={[{ required: true, message: '请输入 OSS Endpoint' }]} />
              <Form.Input field="ossBucket" label="Bucket" rules={[{ required: true, message: '请输入 OSS Bucket' }]} />
              <Form.Input field="ossAccessKeyId" label="AccessKey ID" rules={[{ required: true, message: '请输入 AccessKey ID' }]} />
              <Form.Input
                field="ossAccessKeySecret"
                label="AccessKey Secret"
                type="password"
                rules={[{ required: true, message: '请输入 AccessKey Secret' }]}
              />
            </>
          )}

          <Form.Input field="remark" label="备注" placeholder="选填，说明该文件服务的用途" />
          <div className="storage-config-form-actions">
            <Button onClick={() => {
              setModalVisible(false);
              setEditingConfig(null);
            }}>
              取消
            </Button>
            <Button htmlType="submit" type="primary">保存</Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
