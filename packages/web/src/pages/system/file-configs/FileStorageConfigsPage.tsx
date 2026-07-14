import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Col,
  DatePicker,
  Form,
  Modal,
  Radio,
  Row,
  Select,
  Spin,
  Switch,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, Search, RotateCcw, PlugZap } from 'lucide-react';
import type {
  CreateFileStorageConfigInput,
  FileObjectAcl,
  FileStorageConfig,
  FileStorageProvider,
  FileUrlStrategy,
  UpdateFileStorageConfigInput,
} from '@zenith/shared';
import { FILE_OBJECT_ACL_SUPPORT, FILE_STORAGE_PROVIDER_LABELS, FILE_URL_STRATEGY_LABELS, FILE_URL_STRATEGY_OPTIONS, PRESIGNED_EXPIRY_DEFAULT_SECONDS, PRESIGNED_EXPIRY_MAX_SECONDS, PRESIGNED_EXPIRY_MIN_SECONDS } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import { renderEllipsis } from '@/utils/table-columns';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import StorageFileBrowser from './StorageFileBrowser';
import {
  fileStorageConfigKeys,
  useDeleteFileStorageConfig,
  useFileStorageConfigDetail,
  useFileStorageConfigList,
  useSaveFileStorageConfig,
  useSetDefaultFileStorageConfig,
  useTestFileStorageConfig,
} from '@/hooks/queries/file-storage-configs';
import './FileStorageConfigsPage.css';

const { Text } = Typography;

type FileStorageConfigFormValues = UpdateFileStorageConfigInput;

/** 支持对象级读写权限（canned ACL）的 provider */
const OBJECT_ACL_PROVIDERS = Object.keys(FILE_OBJECT_ACL_SUPPORT) as FileStorageProvider[];

const OBJECT_ACL_LABELS: Record<FileObjectAcl, string> = {
  'default': '继承 Bucket',
  'private': '私有',
  'public-read': '公共读',
  'public-read-write': '公共读写',
};

function normalizeOptional(value?: string): string {
  return value?.trim() ?? '';
}

/** 各 provider 公共的基础字段（objectAcl 与专属凭据字段由各分支自行补充） */
function baseStorageFields(values: FileStorageConfigFormValues, isDefault: boolean) {
  return {
    name: values.name?.trim() ?? '',
    status: values.status ?? 'enabled',
    isDefault,
    basePath: normalizeOptional(values.basePath),
    urlStrategy: values.urlStrategy ?? 'proxy',
    publicBaseUrl: normalizeOptional(values.publicBaseUrl),
    presignedExpirySeconds: values.presignedExpirySeconds ?? PRESIGNED_EXPIRY_DEFAULT_SECONDS,
  };
}

function buildPayload(provider: FileStorageProvider, isDefault: boolean, values: FileStorageConfigFormValues): CreateFileStorageConfigInput {
  if (provider === 'local') {
    return {
      ...baseStorageFields(values, isDefault),
      provider,
      objectAcl: 'default',
      localRootPath: normalizeOptional(values.localRootPath),
      remark: normalizeOptional(values.remark),
    };
  }

  if (provider === 'oss') {
    return {
      ...baseStorageFields(values, isDefault),
      provider,
      objectAcl: values.objectAcl ?? 'default',
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
      ...baseStorageFields(values, isDefault),
      provider,
      objectAcl: values.objectAcl ?? 'default',
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
      ...baseStorageFields(values, isDefault),
      provider,
      objectAcl: values.objectAcl ?? 'default',
      cosRegion: normalizeOptional(values.cosRegion),
      cosBucket: normalizeOptional(values.cosBucket),
      cosSecretId: normalizeOptional(values.cosSecretId),
      cosSecretKey: normalizeOptional(values.cosSecretKey),
      remark: normalizeOptional(values.remark),
    };
  }

  if (provider === 'obs') {
    return {
      ...baseStorageFields(values, isDefault),
      provider,
      objectAcl: values.objectAcl ?? 'default',
      obsEndpoint: normalizeOptional(values.obsEndpoint),
      obsBucket: normalizeOptional(values.obsBucket),
      obsAccessKeyId: normalizeOptional(values.obsAccessKeyId),
      obsSecretAccessKey: normalizeOptional(values.obsSecretAccessKey),
      remark: normalizeOptional(values.remark),
    };
  }

  if (provider === 'kodo') {
    return {
      ...baseStorageFields(values, isDefault),
      provider,
      objectAcl: 'default',
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
      ...baseStorageFields(values, isDefault),
      provider,
      objectAcl: values.objectAcl ?? 'default',
      bosEndpoint: normalizeOptional(values.bosEndpoint),
      bosBucket: normalizeOptional(values.bosBucket),
      bosAccessKeyId: normalizeOptional(values.bosAccessKeyId),
      bosSecretAccessKey: normalizeOptional(values.bosSecretAccessKey),
      remark: normalizeOptional(values.remark),
    };
  }

  if (provider === 'azure') {
    return {
      ...baseStorageFields(values, isDefault),
      provider,
      objectAcl: 'default',
      azureAccountName: normalizeOptional(values.azureAccountName),
      azureAccountKey: normalizeOptional(values.azureAccountKey),
      azureContainerName: normalizeOptional(values.azureContainerName),
      azureEndpoint: normalizeOptional(values.azureEndpoint),
      remark: normalizeOptional(values.remark),
    };
  }

  // sftp
  return {
    ...baseStorageFields(values, isDefault),
    provider,
    objectAcl: 'default',
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
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  interface SearchParams {
    status: string;
    timeRange: [Date, Date] | null;
  }

  const defaultSearchParams: SearchParams = { status: '', timeRange: null };
  const formApi = useRef<FormApi | null>(null);
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<FileStorageConfig | null>(null);
  const [formProvider, setFormProvider] = useState<FileStorageProvider>('local');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [browsingConfig, setBrowsingConfig] = useState<FileStorageConfig | null>(null);
  const listQuery = useFileStorageConfigList({
    page,
    pageSize,
    status: submittedParams.status || undefined,
    startTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[0]) : undefined,
    endTime: submittedParams.timeRange ? formatDateTimeForApi(submittedParams.timeRange[1]) : undefined,
  });
  const configs = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const detailQuery = useFileStorageConfigDetail(editingConfig?.id, modalVisible && !!editingConfig);
  const modalDetailLoading = !!editingConfig && detailQuery.isFetching;
  const saveMutation = useSaveFileStorageConfig();
  const deleteMutation = useDeleteFileStorageConfig();
  const setDefaultMutation = useSetDefaultFileStorageConfig();
  const testMutation = useTestFileStorageConfig();
  const modalTestLoading = testMutation.isPending && !testMutation.variables?.id;
  const testingConfigId = testMutation.isPending ? (testMutation.variables?.id ?? null) : null;

  useEffect(() => {
    if (!detailQuery.data) return;
    setEditingConfig(detailQuery.data);
    setFormProvider(detailQuery.data.provider);
    setFormIsDefault(detailQuery.data.isDefault);
  }, [detailQuery.data]);

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: fileStorageConfigKeys.lists });
  };

  const handleReset = () => {
    setPage(1);
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    void queryClient.invalidateQueries({ queryKey: fileStorageConfigKeys.lists });
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
    const payload = buildPayload(formProvider, formIsDefault, values);
    await saveMutation.mutateAsync({ id: editingConfig?.id, values: payload });
    Toast.success(editingConfig ? '文件服务配置已更新' : '文件服务配置已创建');
    setModalVisible(false);
    setEditingConfig(null);
  };

  const handleModalTest = async () => {
    let values;
    try {
      values = await formApi.current!.validate();
    } catch {
      return;
    }
    if (!values) return;
    const payload = buildPayload(formProvider, formIsDefault, values);
    await testMutation.mutateAsync({ id: editingConfig?.id, values: payload });
    Toast.success('存储连接测试通过');
  };

  const handleDelete = async (config: FileStorageConfig) => {
    await deleteMutation.mutateAsync(config.id);
    Toast.success('文件服务配置已删除');
  };

  const handleSetDefault = async (config: FileStorageConfig) => {
    await setDefaultMutation.mutateAsync(config.id);
    Toast.success('默认文件服务已更新');
  };

  const handleTestSaved = async (config: FileStorageConfig) => {
    await testMutation.mutateAsync({ id: config.id, values: {} });
    Toast.success('存储连接测试通过');
  };

  const togglingStatusId = saveMutation.isPending ? (saveMutation.variables?.id ?? null) : null;

  const handleToggleStatus = async (config: FileStorageConfig, newStatus: 'enabled' | 'disabled') => {
    if (newStatus === 'disabled') {
      if (config.isDefault) {
        Toast.warning('默认配置不能禁用，请先将其他配置设为默认');
        return;
      }
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: `确认禁用「${config.name}」？`,
          okButtonProps: { type: 'danger', theme: 'solid' },
          okText: '确认禁用',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    await saveMutation.mutateAsync({ id: config.id, values: { status: newStatus } });
    Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
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
        // 文案统一来自 @zenith/shared；Tag 色为本页特化
        const colorMap: Record<FileStorageProvider, 'blue' | 'orange' | 'purple' | 'teal' | 'red' | 'cyan' | 'indigo' | 'violet' | 'green'> = {
          local: 'blue', oss: 'orange', s3: 'purple', cos: 'teal', obs: 'red',
          kodo: 'cyan', bos: 'indigo', azure: 'violet', sftp: 'green',
        };
        return <Tag color={colorMap[provider]} size="small">{FILE_STORAGE_PROVIDER_LABELS[provider]}</Tag>;
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
      title: '读写权限',
      dataIndex: 'objectAcl',
      width: 110,
      align: 'center',
      render: (value: FileObjectAcl | undefined, record: FileStorageConfig) => {
        if (!OBJECT_ACL_PROVIDERS.includes(record.provider)) return <span className="table-cell-placeholder">—</span>;
        const colorMap: Record<FileObjectAcl, 'grey' | 'blue' | 'orange' | 'red'> = {
          'default': 'grey',
          'private': 'blue',
          'public-read': 'orange',
          'public-read-write': 'red',
        };
        const acl = value ?? 'default';
        return <Tag color={colorMap[acl]} size="small">{OBJECT_ACL_LABELS[acl]}</Tag>;
      },
    },
    {
      title: '访问策略',
      dataIndex: 'urlStrategy',
      width: 120,
      align: 'center',
      render: (value: FileUrlStrategy | undefined) => {
        const strategy = value ?? 'proxy';
        const colorMap: Record<FileUrlStrategy, 'grey' | 'green' | 'purple'> = {
          proxy: 'grey',
          public: 'green',
          presigned: 'purple',
        };
        return <Tag color={colorMap[strategy]} size="small">{FILE_URL_STRATEGY_LABELS[strategy]}</Tag>;
      },
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
      render: (v: FileStorageConfig['status'], record: FileStorageConfig) => (
        <Switch
          size="small"
          checked={v === 'enabled'}
          loading={togglingStatusId === record.id}
          disabled={!hasPermission('system:file:config:update')}
          onChange={(checked: boolean) => void handleToggleStatus(record, checked ? 'enabled' : 'disabled')}
        />
      ),
    },
    createOperationColumn<FileStorageConfig>({
      width: 260,
      desktopInlineKeys: ['browse', 'default', 'edit'],
      actions: (record) => [
        {
          key: 'browse',
          label: '浏览',
          hidden: !hasPermission('system:file:list'),
          onClick: () => setBrowsingConfig(record),
        },
        {
          key: 'default',
          label: '设为默认',
          hidden: !hasPermission('system:file:config:default'),
          disabled: record.isDefault || record.status !== 'enabled',
          onClick: () => handleSetDefault(record),
        },
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:file:config:update'),
          onClick: () => openEdit(record),
        },
        {
          key: 'test',
          label: '测试连接',
          loading: testingConfigId === record.id,
          hidden: !hasPermission('system:file:config'),
          onClick: () => { void handleTestSaved(record); },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:file:config:delete'),
          disabled: record.isDefault,
          onClick: () => {
            Modal.confirm({
              title: '确认删除此文件服务配置？',
              content: '若已绑定文件记录，后端会阻止删除。',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record),
            });
          },
        },
      ],
    }),
  ];

  const initValues: FileStorageConfigFormValues = editingConfig
    ? {
      ...editingConfig,
      basePath: editingConfig.basePath ?? '',
      objectAcl: editingConfig.objectAcl ?? 'default',
      urlStrategy: editingConfig.urlStrategy ?? 'proxy',
      publicBaseUrl: editingConfig.publicBaseUrl ?? '',
      presignedExpirySeconds: editingConfig.presignedExpirySeconds ?? PRESIGNED_EXPIRY_DEFAULT_SECONDS,
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
      objectAcl: 'default',
      urlStrategy: 'proxy',
      publicBaseUrl: '',
      presignedExpirySeconds: PRESIGNED_EXPIRY_DEFAULT_SECONDS,
      localRootPath: 'storage/local',
      remark: '',
    };
  const buildExportQuery = () => ({
    ...(submittedParams.status ? { status: submittedParams.status } : {}),
    ...(submittedParams.timeRange
      ? {
          startTime: formatDateTimeForApi(submittedParams.timeRange[0]),
          endTime: formatDateTimeForApi(submittedParams.timeRange[1]),
        }
      : {}),
  });

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Select
              placeholder="请选择状态"
              value={draftParams.status || undefined}
              onChange={(value) => setDraftParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
              style={{ width: 140 }}
            >
              <Select.Option value="">全部状态</Select.Option>
              <Select.Option value="enabled">启用</Select.Option>
              <Select.Option value="disabled">禁用</Select.Option>
            </Select>
            <DatePicker
              type="dateTimeRange"
              placeholder={['开始时间', '结束时间']}
              value={draftParams.timeRange ?? undefined}
              onChange={(value) => setDraftParams((prev) => ({ ...prev, timeRange: value ? (value as [Date, Date]) : null }))}
              style={{ width: 360 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
        actions={(
          <>
            <ExportButton entity="system.file-storage-configs" query={buildExportQuery()} />
            {hasPermission('system:file:config:create') && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
          </>
        )}
        mobilePrimary={(
          <>
            <Select
              placeholder="请选择状态"
              value={draftParams.status || undefined}
              onChange={(value) => setDraftParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
              style={{ width: 140 }}
            >
              <Select.Option value="">全部状态</Select.Option>
              <Select.Option value="enabled">启用</Select.Option>
              <Select.Option value="disabled">禁用</Select.Option>
            </Select>
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {hasPermission('system:file:config:create') && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
          </>
        )}
        mobileFilters={(
          <DatePicker
            type="dateTimeRange"
            placeholder={['开始时间', '结束时间']}
            value={draftParams.timeRange ?? undefined}
            onChange={(value) => setDraftParams((prev) => ({ ...prev, timeRange: value ? (value as [Date, Date]) : null }))}
            style={{ width: 360 }}
          />
        )}
        mobileActions={(
          <ExportButton entity="system.file-storage-configs" query={buildExportQuery()} variant="flat" />
        )}
        filterTitle="文件配置筛选"
        actionTitle="文件配置操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      <div className="storage-configs-tip" style={{ marginBottom: 0, marginTop: -4 }}>
        <Text type="secondary">当前支持多文件服务配置，但上传时会优先走"默认文件服务"。切换默认服务不会影响历史文件记录。</Text>
      </div>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={configs}
        rowKey="id"
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
        size="small"
      />

      <AppModal
        title={editingConfig ? '编辑文件配置' : '新增文件配置'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingConfig(null);
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
          labelWidth={140}
        >
          <div className="storage-config-form-header">
            <Text strong>配置选项</Text>
            <div className="storage-config-default-switch">
              <Button type="primary" theme="light" icon={<PlugZap size={14} />} loading={modalTestLoading} disabled={modalDetailLoading} onClick={() => void handleModalTest()}>
                测试连接
              </Button>
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
                onChange={(value) => {
                  const next = value as FileStorageProvider;
                  setFormProvider(next);
                  const currentAcl = formApi.current?.getValue('objectAcl') as FileObjectAcl | undefined;
                  if (currentAcl && !(FILE_OBJECT_ACL_SUPPORT[next] ?? []).includes(currentAcl)) {
                    formApi.current?.setValue('objectAcl', 'default');
                  }
                }}
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

          {OBJECT_ACL_PROVIDERS.includes(formProvider) && (
            <Form.RadioGroup
              field="objectAcl"
              label="读写权限"
              type="button"
              extraText={formProvider === 's3'
                ? '上传文件将按此权限设置对象 ACL。注意：AWS S3 新建桶默认禁用 ACL（Bucket owner enforced），启用前请先在桶设置中开启；MinIO / Cloudflare R2 不支持对象 ACL，请保持「继承 Bucket」。'
                : '上传文件将按此权限设置对象 ACL；「继承 Bucket」表示不单独指定、跟随 Bucket 权限。公共读 / 公共读写存在数据泄露风险，请谨慎选择。'}
            >
              {(FILE_OBJECT_ACL_SUPPORT[formProvider] ?? []).map((acl) => (
                <Radio key={acl} value={acl}>{OBJECT_ACL_LABELS[acl]}</Radio>
              ))}
            </Form.RadioGroup>
          )}

          <Row gutter={16}>
            <Col span={24}>
              <Form.Select
                field="urlStrategy"
                label="访问策略"
                style={{ width: '100%' }}
                extraText="代理：文件流量经过服务端（兜底）；公开直链：返回永久直连地址，要求对象可公开读；临时签名：按需签发限时直连地址，适合私有文件（本地磁盘 / SFTP 不支持）"
              >
                {FILE_URL_STRATEGY_OPTIONS.map((opt) => (
                  <Select.Option key={opt.value} value={opt.value}>{opt.label}</Select.Option>
                ))}
              </Form.Select>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.InputNumber
                field="presignedExpirySeconds"
                label="签名有效期（秒）"
                style={{ width: '100%' }}
                min={PRESIGNED_EXPIRY_MIN_SECONDS}
                max={PRESIGNED_EXPIRY_MAX_SECONDS}
                extraText="仅临时签名策略生效；修改只影响新签发的链接"
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Input
                field="publicBaseUrl"
                label="访问域名（CDN）"
                placeholder="可选，例如 https://cdn.example.com，公开直链优先使用该域名"
              />
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
                    placeholder={editingConfig ? '留空表示不修改' : '请输入 AccessKey Secret'}
                    type="password"
                    rules={editingConfig ? [] : [{ required: true, message: '请输入 AccessKey Secret' }]}
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
                    placeholder={editingConfig ? '留空表示不修改' : '请输入 Secret Access Key'}
                    type="password"
                    rules={editingConfig ? [] : [{ required: true, message: '请输入 Secret Access Key' }]}
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
                    placeholder={editingConfig ? '留空表示不修改' : '请输入 SecretKey'}
                    type="password"
                    rules={editingConfig ? [] : [{ required: true, message: '请输入 SecretKey' }]}
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
                  <Form.Input field="obsSecretAccessKey" label="Secret Access Key" placeholder={editingConfig ? '留空表示不修改' : '请输入 Secret Access Key'} type="password" rules={editingConfig ? [] : [{ required: true, message: '请输入 Secret Access Key' }]} />
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
                  <Form.Input field="kodoSecretKey" label="Secret Key" placeholder={editingConfig ? '留空表示不修改' : '请输入 Secret Key'} type="password" rules={editingConfig ? [] : [{ required: true, message: '请输入 Secret Key' }]} />
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
                  <Form.Input field="bosSecretAccessKey" label="Secret Access Key" placeholder={editingConfig ? '留空表示不修改' : '请输入 Secret Key'} type="password" rules={editingConfig ? [] : [{ required: true, message: '请输入 Secret Access Key' }]} />
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
                  <Form.Input field="azureAccountKey" label="Account Key" placeholder={editingConfig ? '留空表示不修改' : '存储账户密钥'} type="password" rules={editingConfig ? [] : [{ required: true, message: '请输入 Account Key' }]} />
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
                  <Form.Input field="sftpPassword" label="密码" placeholder={editingConfig ? '留空表示不修改' : '密码或私钥二选一'} type="password" />
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
                  <Form.TextArea field="sftpPrivateKey" label="SSH 私钥（可选）" placeholder={editingConfig ? '留空表示不修改' : '如果使用私钥登录，请将 PEM 内容粘贴至此'} rows={4} />
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
      </AppModal>

      <StorageFileBrowser config={browsingConfig} onClose={() => setBrowsingConfig(null)} />
    </div>
  );
}
