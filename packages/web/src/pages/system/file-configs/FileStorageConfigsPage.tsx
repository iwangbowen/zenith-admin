import { useCallback, useEffect, useState, useRef } from 'react';
import {
  Button,
  Col,
  DatePicker,
  Form,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Switch,
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
  PaginatedResponse,
  UpdateFileStorageConfigInput,
} from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import { renderEllipsis } from '@/utils/table-columns';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import StorageFileBrowser from './StorageFileBrowser';
import './FileStorageConfigsPage.css';

const { Text } = Typography;

type FileStorageConfigFormValues = UpdateFileStorageConfigInput;

function normalizeOptional(value?: string): string {
  return value?.trim() ?? '';
}

function buildPayload(provider: FileStorageProvider, isDefault: boolean, values: FileStorageConfigFormValues): CreateFileStorageConfigInput {
  if (provider === 'local') {
    return {
      name: values.name?.trim() ?? '',
      provider,
      status: values.status ?? 'enabled',
      isDefault,
      basePath: normalizeOptional(values.basePath),
      localRootPath: normalizeOptional(values.localRootPath),
      remark: normalizeOptional(values.remark),
    };
  }

  if (provider === 'oss') {
    return {
      name: values.name?.trim() ?? '',
      provider,
      status: values.status ?? 'enabled',
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

  if (provider === 's3') {
    return {
      name: values.name?.trim() ?? '',
      provider,
      status: values.status ?? 'enabled',
      isDefault,
      basePath: normalizeOptional(values.basePath),
      s3Region: normalizeOptional(values.s3Region),
      s3Endpoint: normalizeOptional(values.s3Endpoint),
      s3Bucket: normalizeOptional(values.s3Bucket),
      s3AccessKeyId: normalizeOptional(values.s3AccessKeyId),
      s3SecretAccessKey: normalizeOptional(values.s3SecretAccessKey),
      s3ForcePathStyle: values.s3ForcePathStyle ?? false,
      remark: normalizeOptional(values.remark),
    };
  }

  // cos
  if (provider === 'cos') {
    return {
      name: values.name?.trim() ?? '',
      provider,
      status: values.status ?? 'enabled',
      isDefault,
      basePath: normalizeOptional(values.basePath),
      cosRegion: normalizeOptional(values.cosRegion),
      cosBucket: normalizeOptional(values.cosBucket),
      cosSecretId: normalizeOptional(values.cosSecretId),
      cosSecretKey: normalizeOptional(values.cosSecretKey),
      remark: normalizeOptional(values.remark),
    };
  }

  if (provider === 'obs') {
    return {
      name: values.name?.trim() ?? '',
      provider,
      status: values.status ?? 'enabled',
      isDefault,
      basePath: normalizeOptional(values.basePath),
      obsEndpoint: normalizeOptional(values.obsEndpoint),
      obsBucket: normalizeOptional(values.obsBucket),
      obsAccessKeyId: normalizeOptional(values.obsAccessKeyId),
      obsSecretAccessKey: normalizeOptional(values.obsSecretAccessKey),
      remark: normalizeOptional(values.remark),
    };
  }

  if (provider === 'kodo') {
    return {
      name: values.name?.trim() ?? '',
      provider,
      status: values.status ?? 'enabled',
      isDefault,
      basePath: normalizeOptional(values.basePath),
      kodoAccessKey: normalizeOptional(values.kodoAccessKey),
      kodoSecretKey: normalizeOptional(values.kodoSecretKey),
      kodoBucket: normalizeOptional(values.kodoBucket),
      kodoRegion: normalizeOptional(values.kodoRegion),
      kodoEndpoint: normalizeOptional(values.kodoEndpoint),
      remark: normalizeOptional(values.remark),
    };
  }

  if (provider === 'bos') {
    return {
      name: values.name?.trim() ?? '',
      provider,
      status: values.status ?? 'enabled',
      isDefault,
      basePath: normalizeOptional(values.basePath),
      bosEndpoint: normalizeOptional(values.bosEndpoint),
      bosBucket: normalizeOptional(values.bosBucket),
      bosAccessKeyId: normalizeOptional(values.bosAccessKeyId),
      bosSecretAccessKey: normalizeOptional(values.bosSecretAccessKey),
      remark: normalizeOptional(values.remark),
    };
  }

  if (provider === 'azure') {
    return {
      name: values.name?.trim() ?? '',
      provider,
      status: values.status ?? 'enabled',
      isDefault,
      basePath: normalizeOptional(values.basePath),
      azureAccountName: normalizeOptional(values.azureAccountName),
      azureAccountKey: normalizeOptional(values.azureAccountKey),
      azureContainerName: normalizeOptional(values.azureContainerName),
      azureEndpoint: normalizeOptional(values.azureEndpoint),
      remark: normalizeOptional(values.remark),
    };
  }

  // sftp
  return {
    name: values.name?.trim() ?? '',
    provider,
    status: values.status ?? 'enabled',
    isDefault,
    basePath: normalizeOptional(values.basePath),
    sftpHost: normalizeOptional(values.sftpHost),
    sftpPort: values.sftpPort,
    sftpUsername: normalizeOptional(values.sftpUsername),
    sftpPassword: normalizeOptional(values.sftpPassword),
    sftpPrivateKey: values.sftpPrivateKey,
    sftpRootPath: normalizeOptional(values.sftpRootPath),
    sftpBaseUrl: normalizeOptional(values.sftpBaseUrl),
    remark: normalizeOptional(values.remark),
  };
}

function getStorageSummary(config: FileStorageConfig) {
  if (config.provider === 'local') return config.localRootPath || '—';
  if (config.provider === 'oss') return [config.ossBucket, config.ossRegion].filter(Boolean).join(' / ') || '—';
  if (config.provider === 's3') return [config.s3Bucket, config.s3Region].filter(Boolean).join(' / ') || '—';
  if (config.provider === 'cos') return [config.cosBucket, config.cosRegion].filter(Boolean).join(' / ') || '—';
  if (config.provider === 'obs') return [config.obsBucket, config.obsEndpoint].filter(Boolean).join(' / ') || '—';
  if (config.provider === 'kodo') return [config.kodoBucket, config.kodoRegion].filter(Boolean).join(' / ') || '—';
  if (config.provider === 'bos') return [config.bosBucket, config.bosEndpoint].filter(Boolean).join(' / ') || '—';
  if (config.provider === 'azure') return [config.azureContainerName, config.azureAccountName].filter(Boolean).join(' / ') || '—';
  if (config.provider === 'sftp') return [config.sftpHost, config.sftpRootPath].filter(Boolean).join(':') || '—';
  return '—';
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
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [total, setTotal] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<FileStorageConfig | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);
  const [formProvider, setFormProvider] = useState<FileStorageProvider>('local');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [browsingConfig, setBrowsingConfig] = useState<FileStorageConfig | null>(null);

  const fetchConfigs = useCallback(async (params = searchParams, p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        ...(params.status ? { status: params.status } : {}),
        ...(params.timeRange
          ? {
            startTime: formatDateTimeForApi(params.timeRange[0]),
            endTime: formatDateTimeForApi(params.timeRange[1]),
          }
          : {}),
        page: String(p),
        pageSize: String(ps),
      }).toString();
      const url = query ? `/api/file-storage-configs?${query}` : '/api/file-storage-configs';
      const res = await request.get<PaginatedResponse<FileStorageConfig>>(url);
      if (res.code === 0) {
        setConfigs(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [searchParams, page, pageSize]);

  useEffect(() => {
    void fetchConfigs();
  }, [fetchConfigs]);

  const handleSearch = () => {
    setPage(1);
    void fetchConfigs(searchParams, 1, pageSize);
  };

  const handleReset = () => {
    setPage(1);
    setSearchParams(defaultSearchParams);
    void fetchConfigs(defaultSearchParams, 1, pageSize);
  };

  const openCreate = () => {
    setEditingConfig(null);
    setFormProvider('local');
    setFormIsDefault(false);
    setModalVisible(true);
  };

  const openEdit = async (config: FileStorageConfig) => {
    setEditingConfig(config);
    setFormProvider(config.provider);
    setFormIsDefault(config.isDefault);
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<FileStorageConfig>(`/api/file-storage-configs/${config.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditingConfig(res.data);
      setFormProvider(res.data.provider);
      setFormIsDefault(res.data.isDefault);
    } else {
      Toast.error(res.message || '获取信息失败');
    }
  };

  const handleModalOk = async () => {
    let values;
    try {
      values = await formApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    if (!values) throw new Error('validation');
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
      render: renderEllipsis,
    },
    {
      title: '存储类型',
      dataIndex: 'provider',
      width: 120,
      render: (provider: FileStorageProvider) => {
        const map: Record<FileStorageProvider, { color: 'blue' | 'orange' | 'purple' | 'teal' | 'red' | 'cyan' | 'indigo' | 'violet' | 'green'; label: string }> = {
          local: { color: 'blue', label: '本地磁盘' },
          oss: { color: 'orange', label: '阿里云 OSS' },
          s3: { color: 'purple', label: 'Amazon S3' },
          cos: { color: 'teal', label: '腾讯云 COS' },
          obs: { color: 'red', label: '华为云 OBS' },
          kodo: { color: 'cyan', label: '七牛云 Kodo' },
          bos: { color: 'indigo', label: '百度云 BOS' },
          azure: { color: 'violet', label: 'Azure Blob' },
          sftp: { color: 'green', label: 'SFTP' },
        };
        const { color, label } = map[provider];
        return <Tag color={color} size="small">{label}</Tag>;
      },
    },
    {
      title: '默认服务',
      dataIndex: 'isDefault',
      width: 110,
      align: 'center',
      render: (isDefault: boolean) => isDefault ? <Tag color="green" size="small">默认</Tag> : <span className="table-cell-placeholder">—</span>,
    },
    {
      title: '存储信息',
      key: 'storageSummary',
      dataIndex: 'storageSummary',
      width: 180,
      render: (_: unknown, record: FileStorageConfig) => {
        const labelMap: Record<FileStorageProvider, string> = {
          local: '目录',
          oss: 'Bucket',
          s3: 'Bucket',
          cos: 'Bucket',
          obs: 'Bucket',
          kodo: 'Bucket',
          bos: 'Bucket',
          azure: 'Container',
          sftp: '主机',
        };
        const label = labelMap[record.provider] ?? 'Bucket';
        const summary = getStorageSummary(record);
        return renderEllipsis(`${label}: ${summary}`);
      },
    },
    {
      title: '基础路径',
      dataIndex: 'basePath',
      width: 160,
      render: (value?: string) => renderEllipsis(value),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value: string) => renderEllipsis(formatDateTime(value)),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      align: 'center',
      fixed: 'right',
      render: (status: FileStorageConfig['status']) => (
        <Tag color={status === 'enabled' ? 'green' : 'grey'} size="small">
          {status === 'enabled' ? '启用' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 340,
      align: 'center',
      render: (_: unknown, record: FileStorageConfig) => (
        <Space>
          {hasPermission('system:file:list') && <Button theme="borderless" size="small" onClick={() => setBrowsingConfig(record)}>
            浏览
          </Button>}
          {hasPermission('system:file:config:default') && <Button theme="borderless" size="small" onClick={() => handleSetDefault(record)} disabled={record.isDefault || record.status !== 'enabled'}>
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
      s3Region: editingConfig.s3Region ?? '',
      s3Endpoint: editingConfig.s3Endpoint ?? '',
      s3Bucket: editingConfig.s3Bucket ?? '',
      s3AccessKeyId: editingConfig.s3AccessKeyId ?? '',
      s3SecretAccessKey: editingConfig.s3SecretAccessKey ?? '',
      s3ForcePathStyle: editingConfig.s3ForcePathStyle ?? false,
      cosRegion: editingConfig.cosRegion ?? '',
      cosBucket: editingConfig.cosBucket ?? '',
      cosSecretId: editingConfig.cosSecretId ?? '',
      cosSecretKey: editingConfig.cosSecretKey ?? '',
      obsEndpoint: editingConfig.obsEndpoint ?? '',
      obsBucket: editingConfig.obsBucket ?? '',
      obsAccessKeyId: editingConfig.obsAccessKeyId ?? '',
      obsSecretAccessKey: editingConfig.obsSecretAccessKey ?? '',
      kodoAccessKey: editingConfig.kodoAccessKey ?? '',
      kodoSecretKey: editingConfig.kodoSecretKey ?? '',
      kodoBucket: editingConfig.kodoBucket ?? '',
      kodoRegion: editingConfig.kodoRegion ?? '',
      kodoEndpoint: editingConfig.kodoEndpoint ?? '',
      bosEndpoint: editingConfig.bosEndpoint ?? '',
      bosBucket: editingConfig.bosBucket ?? '',
      bosAccessKeyId: editingConfig.bosAccessKeyId ?? '',
      bosSecretAccessKey: editingConfig.bosSecretAccessKey ?? '',
      azureAccountName: editingConfig.azureAccountName ?? '',
      azureAccountKey: editingConfig.azureAccountKey ?? '',
      azureContainerName: editingConfig.azureContainerName ?? '',
      azureEndpoint: editingConfig.azureEndpoint ?? '',
      sftpHost: editingConfig.sftpHost ?? '',
      sftpPort: editingConfig.sftpPort ?? 22,
      sftpUsername: editingConfig.sftpUsername ?? '',
      sftpPassword: editingConfig.sftpPassword ?? '',
      sftpPrivateKey: editingConfig.sftpPrivateKey ?? '',
      sftpRootPath: editingConfig.sftpRootPath ?? '',
      sftpBaseUrl: editingConfig.sftpBaseUrl ?? '',
      remark: editingConfig.remark ?? '',
    }
    : {
      name: '',
      provider: 'local',
      status: 'enabled',
      isDefault: false,
      basePath: 'uploads',
      localRootPath: 'storage/local',
      remark: '',
    };

  return (
    <div className="page-container">
      <SearchToolbar>
          <Select
            placeholder="请选择状态"
            value={searchParams.status || undefined}
            onChange={(value) => setSearchParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
            style={{ width: 140 }}
          >
            <Select.Option value="">全部状态</Select.Option>
            <Select.Option value="enabled">启用</Select.Option>
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
          <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/file-storage-configs/export', '文件配置列表.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
          {hasPermission('system:file:config:create') && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
      </SearchToolbar>
      <div className="storage-configs-tip" style={{ marginBottom: 0, marginTop: -4 }}>
        <Text type="secondary">当前支持多文件服务配置，但上传时会优先走"默认文件服务"。切换默认服务不会影响历史文件记录。</Text>
      </div>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={configs}
        rowKey="id"
        loading={loading}
        onRefresh={fetchConfigs}
        refreshLoading={loading}
        pagination={buildPagination(total, (p, ps) => void fetchConfigs(searchParams, p, ps))}
        size="small"
      />

      <Modal
        title={editingConfig ? '编辑文件配置' : '新增文件配置'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingConfig(null);
          setModalDetailLoading(false);
        }}
        onOk={handleModalOk}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={720}

      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          getFormApi={(api) => formApi.current = api}
          key={editingConfig?.id ?? 'new-file-storage-config'}
          allowEmpty
          initValues={initValues}
          labelPosition="left"
          labelWidth={120}
        >
          <div className="storage-config-form-header">
            <Text strong>配置选项</Text>
            <div className="storage-config-default-switch">
              <span>设为默认服务</span>
              <Switch checked={formIsDefault} onChange={(checked) => setFormIsDefault(checked)} />
            </div>
          </div>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="配置名称" placeholder="请输入配置名称" rules={[{ required: true, message: '请输入配置名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Select
                field="provider"
                label="存储类型"
                style={{ width: '100%' }}
                onChange={(value) => setFormProvider(value as FileStorageProvider)}
                placeholder="请选择存储类型"
              >
                <Select.Option value="local">本地磁盘</Select.Option>
                <Select.Option value="oss">阿里云 OSS</Select.Option>
                <Select.Option value="s3">Amazon S3 / MinIO</Select.Option>
                <Select.Option value="cos">腾讯云 COS</Select.Option>
                <Select.Option value="obs">华为云 OBS</Select.Option>
                <Select.Option value="kodo">七牛云 Kodo</Select.Option>
                <Select.Option value="bos">百度云 BOS</Select.Option>
                <Select.Option value="azure">Azure Blob Storage</Select.Option>
                <Select.Option value="sftp">SFTP</Select.Option>
              </Form.Select>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} placeholder="请选择状态">
                <Select.Option value="enabled">启用</Select.Option>
                <Select.Option value="disabled">禁用</Select.Option>
              </Form.Select>
            </Col>
            <Col span={12}>
              <Form.Input field="basePath" label="基础路径" placeholder="例如 uploads / images" />
            </Col>
          </Row>

          {formProvider === 'local' && (
            <Row gutter={16}>
              <Col span={24}>
                <Form.Input
                  field="localRootPath"
                  label="存储目录"
                  placeholder="例如 storage/local 或 D:/uploads"
                  rules={[{ required: true, message: '请输入本地磁盘存储目录' }]}
                />
              </Col>
            </Row>
          )}

          {formProvider === 'oss' && (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="ossRegion" label="Region" placeholder="请输入 OSS Region" rules={[{ required: true, message: '请输入 OSS Region' }]} />
                </Col>
                <Col span={12}>
                  <Form.Input field="ossBucket" label="Bucket" placeholder="请输入 OSS Bucket" rules={[{ required: true, message: '请输入 OSS Bucket' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="ossEndpoint" label="Endpoint" placeholder="请输入 OSS Endpoint" rules={[{ required: true, message: '请输入 OSS Endpoint' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="ossAccessKeyId" label="AccessKey ID" placeholder="请输入 AccessKey ID" rules={[{ required: true, message: '请输入 AccessKey ID' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input
                    field="ossAccessKeySecret"
                    label="AccessKey Secret"
                    placeholder="请输入 AccessKey Secret"
                    type="password"
                    rules={[{ required: true, message: '请输入 AccessKey Secret' }]}
                  />
                </Col>
              </Row>
            </>
          )}

          {formProvider === 's3' && (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="s3Region" label="Region" placeholder="请输入 S3 Region" rules={[{ required: true, message: '请输入 S3 Region' }]} />
                </Col>
                <Col span={12}>
                  <Form.Input field="s3Bucket" label="Bucket" placeholder="请输入 S3 Bucket" rules={[{ required: true, message: '请输入 S3 Bucket' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="s3Endpoint" label="Endpoint" placeholder="可选，兼容 S3 自定义存储" />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="s3AccessKeyId" label="Access Key ID" placeholder="请输入 Access Key ID" rules={[{ required: true, message: '请输入 Access Key ID' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input
                    field="s3SecretAccessKey"
                    label="Secret Access Key"
                    placeholder="请输入 Secret Access Key"
                    type="password"
                    rules={[{ required: true, message: '请输入 Secret Access Key' }]}
                  />
                </Col>
              </Row>
              <Form.Checkbox field="s3ForcePathStyle" noLabel>强制路径样式（MinIO / Ceph 等兼容当需开启）</Form.Checkbox>
            </>
          )}

          {formProvider === 'cos' && (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="cosRegion" label="Region" placeholder="例如 ap-guangzhou" rules={[{ required: true, message: '请输入 COS Region' }]} />
                </Col>
                <Col span={12}>
                  <Form.Input field="cosBucket" label="Bucket" placeholder="例如 my-bucket-1250000000" rules={[{ required: true, message: '请输入 COS Bucket' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="cosSecretId" label="SecretId" placeholder="请输入 SecretId" rules={[{ required: true, message: '请输入 SecretId' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input
                    field="cosSecretKey"
                    label="SecretKey"
                    placeholder="请输入 SecretKey"
                    type="password"
                    rules={[{ required: true, message: '请输入 SecretKey' }]}
                  />
                </Col>
              </Row>
            </>
          )}

          {formProvider === 'obs' && (
            <>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="obsEndpoint" label="Endpoint" placeholder="例如 obs.cn-north-4.myhuaweicloud.com" rules={[{ required: true, message: '请输入 OBS Endpoint' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="obsBucket" label="Bucket" placeholder="请输入 OBS Bucket 名称" rules={[{ required: true, message: '请输入 Bucket' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="obsAccessKeyId" label="Access Key ID" placeholder="请输入 Access Key ID" rules={[{ required: true, message: '请输入 Access Key ID' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="obsSecretAccessKey" label="Secret Access Key" placeholder="请输入 Secret Access Key" type="password" rules={[{ required: true, message: '请输入 Secret Access Key' }]} />
                </Col>
              </Row>
            </>
          )}

          {formProvider === 'kodo' && (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="kodoBucket" label="Bucket" placeholder="请输入 Kodo Bucket" rules={[{ required: true, message: '请输入 Bucket' }]} />
                </Col>
                <Col span={12}>
                  <Form.Input field="kodoRegion" label="Region" placeholder="例如 z0（华东）、z1（华北）" />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="kodoEndpoint" label="访问域名" placeholder="用于下载文件的公开域名，例如 cdn.example.com" />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="kodoAccessKey" label="Access Key" placeholder="请输入 Access Key" rules={[{ required: true, message: '请输入 Access Key' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="kodoSecretKey" label="Secret Key" placeholder="请输入 Secret Key" type="password" rules={[{ required: true, message: '请输入 Secret Key' }]} />
                </Col>
              </Row>
            </>
          )}

          {formProvider === 'bos' && (
            <>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="bosEndpoint" label="Endpoint" placeholder="例如 https://bj.bcebos.com" rules={[{ required: true, message: '请输入 BOS Endpoint' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="bosBucket" label="Bucket" placeholder="请输入 BOS Bucket 名称" rules={[{ required: true, message: '请输入 Bucket' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="bosAccessKeyId" label="Access Key ID" placeholder="请输入 Access Key" rules={[{ required: true, message: '请输入 Access Key ID' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="bosSecretAccessKey" label="Secret Access Key" placeholder="请输入 Secret Key" type="password" rules={[{ required: true, message: '请输入 Secret Access Key' }]} />
                </Col>
              </Row>
            </>
          )}

          {formProvider === 'azure' && (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="azureAccountName" label="Account Name" placeholder="存储账户名称" rules={[{ required: true, message: '请输入 Account Name' }]} />
                </Col>
                <Col span={12}>
                  <Form.Input field="azureContainerName" label="Container" placeholder="Blob 容器名称" rules={[{ required: true, message: '请输入 Container Name' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="azureAccountKey" label="Account Key" placeholder="存储账户密钥" type="password" rules={[{ required: true, message: '请输入 Account Key' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="azureEndpoint" label="Endpoint（可选）" placeholder="自定义端点，默认 Azure 全球端点" />
                </Col>
              </Row>
            </>
          )}

          {formProvider === 'sftp' && (
            <>
              <Row gutter={16}>
                <Col span={16}>
                  <Form.Input field="sftpHost" label="主机地址" placeholder="IP 或域名" rules={[{ required: true, message: '请输入主机地址' }]} />
                </Col>
                <Col span={8}>
                  <Form.InputNumber field="sftpPort" label="端口" placeholder="22" min={1} max={65535} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="sftpUsername" label="用户名" placeholder="登录用户名" rules={[{ required: true, message: '请输入用户名' }]} />
                </Col>
                <Col span={12}>
                  <Form.Input field="sftpPassword" label="密码" placeholder="密码或私钥二选一" type="password" />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="sftpRootPath" label="远端根目录" placeholder="例如 /data/uploads" />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="sftpBaseUrl" label="访问 Base URL" placeholder="文件公开 URL 前缀，例如 https://static.example.com" />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.TextArea field="sftpPrivateKey" label="SSH 私钥（可选）" placeholder="如果使用私钥登录，请将 PEM 内容粘贴至此" rows={4} />
                </Col>
              </Row>
            </>
          )}

          <Row gutter={16}>
            <Col span={24}>
              <Form.Input field="remark" label="备注" placeholder="选填，说明该文件服务的用途" />
            </Col>
          </Row>
        </Form>
        </Spin>
      </Modal>

      <StorageFileBrowser config={browsingConfig} onClose={() => setBrowsingConfig(null)} />
    </div>
  );
}
