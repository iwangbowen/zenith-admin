import { useCallback, useEffect, useState, useRef } from 'react';
import {
  Button,
  DatePicker,
  Form,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, Search, RotateCcw, Download } from 'lucide-react';
import type {
  CreateFileStorageConfigInput,
  FileStorageConfig,
  FileStorageProvider,
  UpdateFileStorageConfigInput,
} from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import './FileStorageConfigsPage.css';

const { Text } = Typography;

type FileStorageConfigFormValues = UpdateFileStorageConfigInput;

function normalizeOptional(value?: string) {
  const next = value?.trim();
  return next || undefined;
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
  const { hasPermission } = usePermission();
  interface SearchParams {
    status: string;
    timeRange: [Date, Date] | null;
  }

  const defaultSearchParams: SearchParams = { status: '', timeRange: null };
  const formApi = useRef<FormApi | null>(null);
  const [configs, setConfigs] = useState<FileStorageConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<FileStorageConfig | null>(null);
  const [formProvider, setFormProvider] = useState<FileStorageProvider>('local');
  const [formIsDefault, setFormIsDefault] = useState(false);

  const fetchConfigs = useCallback(async (params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        ...(params.status ? { status: params.status } : {}),
        ...(params.timeRange
          ? {
              startTime: params.timeRange[0].toISOString(),
              endTime: params.timeRange[1].toISOString(),
            }
          : {}),
      }).toString();
      const url = query ? `/api/file-storage-configs?${query}` : '/api/file-storage-configs';
      const res = await request.get<FileStorageConfig[]>(url);
      if (res.code === 0) {
        setConfigs(res.data);
      }
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void fetchConfigs();
  }, [fetchConfigs]);

  const handleSearch = () => {
    void fetchConfigs();
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    void fetchConfigs(defaultSearchParams);
  };

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

  const handleModalOk = async () => {
    let values;
    try {
      values = await formApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    if (!values) throw new Error('validation');
    const payload = buildPayload(formProvider, formIsDefault, values as FileStorageConfigFormValues);
    const res = editingConfig
      ? await request.put<FileStorageConfig>(`/api/file-storage-configs/${editingConfig.id}`, payload)
      : await request.post<FileStorageConfig>('/api/file-storage-configs', payload);
    if (res.code === 0) {
      Toast.success(editingConfig ? '文件服务配置已更新' : '文件服务配置已创建');
      setModalVisible(false);
      setEditingConfig(null);
      fetchConfigs();
    } else {
      throw new Error(res.message);
    }
  };

  const handleDelete = async (config: FileStorageConfig) => {
    const res = await request.delete(`/api/file-storage-configs/${config.id}`);
    if (res.code === 0) {
      Toast.success('文件服务配置已删除');
      fetchConfigs();
    }
  };

  const handleSetDefault = async (config: FileStorageConfig) => {
    const res = await request.put<FileStorageConfig>(`/api/file-storage-configs/${config.id}/default`);
    if (res.code === 0) {
      Toast.success('默认文件服务已更新');
      fetchConfigs();
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
      key: 'storageSummary',
      dataIndex: 'storageSummary',
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
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 300,
      align: 'center',
      render: (_: unknown, record: FileStorageConfig) => (
        <Space>
          {hasPermission('system:file:config:default') && <Button theme="borderless" size="small" onClick={() => handleSetDefault(record)} disabled={record.isDefault || record.status !== 'active'}>
            设为默认
          </Button>}
          {hasPermission('system:file:config:update') && <Button theme="borderless" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>}
          {hasPermission('system:file:config:delete') && <Button
            theme="borderless" size="small" type="danger" disabled={record.isDefault}
            onClick={() => {
              Modal.confirm({
                title: '确认删除此文件服务配置？',
                content: '若已绑定文件记录，后端会阻止删除。',
                okButtonProps: { type: 'danger', theme: 'solid' },
                onOk: () => handleDelete(record),
              });
            }}
          >删除</Button>}
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
      <SearchToolbar
        left={<>
          <Select
            placeholder="请选择状态"
            value={searchParams.status || undefined}
            onChange={(value) => setSearchParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
            style={{ width: 140 }}
          >
            <Select.Option value="">全部状态</Select.Option>
            <Select.Option value="active">启用</Select.Option>
            <Select.Option value="disabled">禁用</Select.Option>
          </Select>
          <DatePicker
            type="dateTimeRange"
            placeholder={["开始时间", "结束时间"]}
            value={searchParams.timeRange ?? undefined}
            onChange={(value) => setSearchParams((prev) => ({ ...prev, timeRange: value ? (value as [Date, Date]) : null }))}
            style={{ width: 360 }}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        </>}
        right={<Space>
          <Button icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/file-storage-configs/export', '文件配置列表.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
          {hasPermission('system:file:config:create') && <Button type="secondary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
        </Space>}
      >
        <div className="storage-configs-tip" style={{ marginBottom: 0, marginTop: 12 }}>
          <Text type="secondary">当前支持多文件服务配置，但上传时会优先走“默认文件服务”。切换默认服务不会影响历史文件记录。</Text>
        </div>
      </SearchToolbar>

      <div>
        <Table
          bordered
          className="admin-table-nowrap"
          columns={columns}
          dataSource={configs}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          size="small"
        />
      </div>

      <Modal
        title={editingConfig ? '编辑文件配置' : '新增文件配置'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingConfig(null);
        }}
        onOk={handleModalOk}
        width={620}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Form
          getFormApi={(api) => formApi.current = api}
          key={editingConfig?.id ?? 'new-file-storage-config'}
          initValues={initValues}
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
        </Form>
      </Modal>
    </div>
  );
}
