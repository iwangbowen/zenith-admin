import { useEffect, useState } from 'react';
import { Button, Col, Form, Radio, Row, Select, SideSheet, Spin, Switch, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { PlugZap } from 'lucide-react';
import type { CreateFileStorageConfigInput, FileObjectAcl, FileStorageConfig, FileStorageProvider, FileUrlStrategy, UpdateFileStorageConfigInput } from '@zenith/shared/platform';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import { FILE_OBJECT_ACL_SUPPORT, FILE_STORAGE_PROVIDER_LABELS, FILE_STORAGE_PROVIDER_OPTIONS, FILE_URL_STRATEGY_LABELS, FILE_URL_STRATEGY_OPTIONS, PRESIGNED_EXPIRY_DEFAULT_SECONDS, PRESIGNED_EXPIRY_MAX_SECONDS, PRESIGNED_EXPIRY_MIN_SECONDS } from '@zenith/shared/platform';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import ExportButton from '@/components/ExportButton';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { abortSubmit } from '@/lib/abort-submit';
import StorageFileBrowser from './StorageFileBrowser';
import {
  fileStorageConfigKeys,
  useDeleteFileStorageConfigs,
  useFileStorageConfigDetail,
  useFileStorageConfigList,
  useSaveFileStorageConfig,
  useSetDefaultFileStorageConfig,
  useTestFileStorageConfig,
} from '@/hooks/queries/file-storage-configs';
import { CreateButton } from '@/components/toolbar-controls';
import { DateRangeFilter, StatusSelect } from '@/components/search-filters';

const STATUS_FILTER_OPTIONS = [{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '禁用' }];
import './FileStorageConfigsPage.css';
import { compactQuery } from '@/lib/query';

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
  if (config.provider === 'local') return config.localRootPath || EMPTY_PLACEHOLDER;
  if (config.provider === 'oss') return [config.ossBucket, config.ossRegion].filter(Boolean).join(' / ') || EMPTY_PLACEHOLDER;
  if (config.provider === 's3') return [config.s3Bucket, config.s3Region].filter(Boolean).join(' / ') || EMPTY_PLACEHOLDER;
  if (config.provider === 'cos') return [config.cosBucket, config.cosRegion].filter(Boolean).join(' / ') || EMPTY_PLACEHOLDER;
  if (config.provider === 'obs') return [config.obsBucket, config.obsEndpoint].filter(Boolean).join(' / ') || EMPTY_PLACEHOLDER;
  if (config.provider === 'kodo') return [config.kodoBucket, config.kodoRegion].filter(Boolean).join(' / ') || EMPTY_PLACEHOLDER;
  if (config.provider === 'bos') return [config.bosBucket, config.bosEndpoint].filter(Boolean).join(' / ') || EMPTY_PLACEHOLDER;
  if (config.provider === 'azure') return [config.azureContainerName, config.azureAccountName].filter(Boolean).join(' / ') || EMPTY_PLACEHOLDER;
  if (config.provider === 'sftp') return [config.sftpHost, config.sftpRootPath].filter(Boolean).join(':') || EMPTY_PLACEHOLDER;
  return EMPTY_PLACEHOLDER;
}

export default function FileStorageConfigsPage() {
  const { hasPermission } = usePermission();
  interface SearchParams {
    status?: string;
    timeRange: [Date, Date] | null;
  }

  const defaultSearchParams: SearchParams = { status: undefined, timeRange: null };
  const {
    page, pageSize, buildPagination,
    bind, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: fileStorageConfigKeys.lists });
  const [formProvider, setFormProvider] = useState<FileStorageProvider>('local');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [browsingConfig, setBrowsingConfig] = useState<FileStorageConfig | null>(null);
  const listQuery = useFileStorageConfigList({
    page,
    pageSize,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  });
  const saveMutation = useSaveFileStorageConfig();
  const statusMutation = useSaveFileStorageConfig();
  const modal = useEditModal<FileStorageConfig, FileStorageConfigFormValues, CreateFileStorageConfigInput>({
    entityName: '文件配置',
    save: saveMutation,
    useDetail: useFileStorageConfigDetail,
    defaults: {
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
    },
    // 密钥字段为 write-only：接口不返回，表单一律以空值起始，留空提交即沿用原值
    toValues: (config) => ({
      ...config,
      basePath: config.basePath ?? '',
      objectAcl: config.objectAcl ?? 'default',
      urlStrategy: config.urlStrategy ?? 'proxy',
      publicBaseUrl: config.publicBaseUrl ?? '',
      presignedExpirySeconds: config.presignedExpirySeconds ?? PRESIGNED_EXPIRY_DEFAULT_SECONDS,
      localRootPath: config.localRootPath ?? '',
      ossRegion: config.ossRegion ?? '',
      ossEndpoint: config.ossEndpoint ?? '',
      ossBucket: config.ossBucket ?? '',
      ossAccessKeyId: config.ossAccessKeyId ?? '',
      ossAccessKeySecret: '',
      s3Region: config.s3Region ?? '',
      s3Endpoint: config.s3Endpoint ?? '',
      s3Bucket: config.s3Bucket ?? '',
      s3AccessKeyId: config.s3AccessKeyId ?? '',
      s3SecretAccessKey: '',
      s3ForcePathStyle: config.s3ForcePathStyle ?? false,
      cosRegion: config.cosRegion ?? '',
      cosBucket: config.cosBucket ?? '',
      cosSecretId: config.cosSecretId ?? '',
      cosSecretKey: '',
      obsEndpoint: config.obsEndpoint ?? '',
      obsBucket: config.obsBucket ?? '',
      obsAccessKeyId: config.obsAccessKeyId ?? '',
      obsSecretAccessKey: '',
      kodoAccessKey: config.kodoAccessKey ?? '',
      kodoSecretKey: '',
      kodoBucket: config.kodoBucket ?? '',
      kodoRegion: config.kodoRegion ?? '',
      kodoEndpoint: config.kodoEndpoint ?? '',
      bosEndpoint: config.bosEndpoint ?? '',
      bosBucket: config.bosBucket ?? '',
      bosAccessKeyId: config.bosAccessKeyId ?? '',
      bosSecretAccessKey: '',
      azureAccountName: config.azureAccountName ?? '',
      azureAccountKey: '',
      azureContainerName: config.azureContainerName ?? '',
      azureEndpoint: config.azureEndpoint ?? '',
      sftpHost: config.sftpHost ?? '',
      sftpPort: config.sftpPort ?? 22,
      sftpUsername: config.sftpUsername ?? '',
      sftpPassword: '',
      sftpPrivateKey: '',
      sftpRootPath: config.sftpRootPath ?? '',
      sftpBaseUrl: config.sftpBaseUrl ?? '',
      remark: config.remark ?? '',
    }),
    beforeSave: (values) => buildPayload(formProvider, formIsDefault, values),
    successMessage: ({ isEdit }) => isEdit ? '文件服务配置已更新' : '文件服务配置已创建',
    labelWidth: 150,
  });
  const deleteMutation = useDeleteFileStorageConfigs();
  const setDefaultMutation = useSetDefaultFileStorageConfig();
  const testMutation = useTestFileStorageConfig();
  const modalTestLoading = testMutation.isPending && !testMutation.variables?.id;
  const testingConfigId = testMutation.isPending ? (testMutation.variables?.id ?? null) : null;

  useEffect(() => {
    if (!modal.editing) return;
    setFormProvider(modal.editing.provider);
    setFormIsDefault(modal.editing.isDefault);
  }, [modal.editing]);

  const openCreate = () => {
    setFormProvider('local');
    setFormIsDefault(false);
    modal.openCreate();
  };

  const openEdit = (config: FileStorageConfig) => {
    setFormProvider(config.provider);
    setFormIsDefault(config.isDefault);
    modal.openEdit(config);
  };

  const handleModalTest = async () => {
    let values;
    try {
      values = await modal.formApi.current!.validate();
    } catch {
      return;
    }
    if (!values) return;
    const payload = buildPayload(formProvider, formIsDefault, values);
    await testMutation.mutateAsync(modal.editing ? { id: modal.editing.id, values: payload } : { values: payload });
    Toast.success('存储连接测试通过');
  };

  const handleSetDefault = async (config: FileStorageConfig) => {
    await setDefaultMutation.mutateAsync({ params: { id: config.id } });
    Toast.success('默认文件服务已更新');
  };

  const handleTestSaved = async (config: FileStorageConfig) => {
    await testMutation.mutateAsync({ id: config.id, values: {} });
    Toast.success('存储连接测试通过');
  };

  const status = useStatusToggle<FileStorageConfig>({
    toggle: async (config, enabled) => {
      if (!enabled && config.isDefault) {
        Toast.warning('默认配置不能禁用，请先将其他配置设为默认');
        abortSubmit('default-config-cannot-be-disabled');
      }
      await statusMutation.mutateAsync({ id: config.id, values: { status: enabled ? 'enabled' : 'disabled' } });
    },
    confirmDisable: (config) => {
      if (config.isDefault) {
        return null;
      }
      return {
        danger: true,
        title: `确认禁用「${config.name}」？`,
        okText: '确认禁用',
      };
    },
    disabled: !hasPermission('system:file:config:update'),
    messages: { disabled: '已禁用' },
  });

  const columns: ColumnProps<FileStorageConfig>[] = [
    {
      title: '配置名称',
      dataIndex: 'name',
      minWidth: 180,
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
      width: 120,
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
    dateTimeColumn('更新时间', 'updatedAt'),
    status.column(),
    createOperationColumn<FileStorageConfig>({
      width: 180,
      desktopInlineKeys: ['browse', 'edit'],
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
        deleteAction({
          hidden: !hasPermission('system:file:config:delete'),
          disabled: record.isDefault,
          title: '确认删除此文件服务配置？',
          content: '若已绑定文件记录，后端会阻止删除。',
          run: () => deleteMutation.mutateAsync([record.id]),
          successMessage: '文件服务配置已删除',
        }),
      ],
    }),
  ];

  const buildExportQuery = () => compactQuery({
    status: submittedParams.status,
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  });

  return (
    <div className="page-container">
      <ListSearchToolbar
        filters={(
          <>
            <StatusSelect
              items={STATUS_FILTER_OPTIONS}
              {...bind('status')}
            />
            <DateRangeFilter {...bind('timeRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={hasPermission('system:file:config:create') && <CreateButton onClick={openCreate} />}
        actions={(
          <ExportButton entity="system.file-storage-configs" query={buildExportQuery()} />
        )}
        mobileActions={(
          <ExportButton entity="system.file-storage-configs" query={buildExportQuery()} variant="flat" />
        )}
        filterTitle="文件配置筛选"
        actionTitle="文件配置操作"
      />
      <div className="storage-configs-tip" style={{ marginBottom: 0, marginTop: -4 }}>
        <Text type="secondary">当前支持多文件服务配置，但上传时会优先走"默认文件服务"。切换默认服务不会影响历史文件记录。</Text>
      </div>

      <ConfigurableTable<FileStorageConfig>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <SideSheet
        title={modal.modalProps.title}
        visible={modal.visible}
        onCancel={modal.close}
        closeOnEsc
        width={780}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <Button icon={<PlugZap size={14} />} loading={modalTestLoading} disabled={modal.detailLoading} onClick={() => void handleModalTest()}>
              测试连接
            </Button>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="tertiary" onClick={modal.close}>取消</Button>
              <Button
                type="primary"
                theme="solid"
                loading={modal.modalProps.okButtonProps.loading}
                disabled={modal.modalProps.okButtonProps.disabled}
                onClick={() => void modal.modalProps.onOk()}
              >
                保存
              </Button>
            </div>
          </div>
        )}
      >
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Form.Section text="基础信息">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="name" label="配置名称" placeholder="请输入配置名称" rules={[{ required: true, message: '请输入配置名称' }]} />
                </Col>
                <Col span={12}>
                  <Form.Select
                    field="provider"
                    label="存储类型"
                    style={{ width: '100%' }}
                    optionList={FILE_STORAGE_PROVIDER_OPTIONS}
                    onChange={(value) => {
                      const next = value as FileStorageProvider;
                      setFormProvider(next);
                      const currentAcl = modal.formApi.current?.getValue('objectAcl') as FileObjectAcl | undefined;
                      if (currentAcl && !(FILE_OBJECT_ACL_SUPPORT[next] ?? []).includes(currentAcl)) {
                        modal.formApi.current?.setValue('objectAcl', 'default');
                      }
                    }}
                    placeholder="请选择存储类型"
                  />
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
              <Form.Slot label="设为默认服务">
                <Switch checked={formIsDefault} onChange={setFormIsDefault} />
              </Form.Slot>
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Input field="remark" label="备注" placeholder="选填，说明该文件服务的用途" />
                </Col>
              </Row>
            </Form.Section>

            <Form.Section text={`${FILE_STORAGE_PROVIDER_LABELS[formProvider]} 连接配置`}>
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
                        placeholder={modal.isEdit ? '留空表示不修改' : '请输入 AccessKey Secret'}
                        type="password"
                        rules={modal.isEdit ? [] : [{ required: true, message: '请输入 AccessKey Secret' }]}
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
                        placeholder={modal.isEdit ? '留空表示不修改' : '请输入 Secret Access Key'}
                        type="password"
                        rules={modal.isEdit ? [] : [{ required: true, message: '请输入 Secret Access Key' }]}
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
                        placeholder={modal.isEdit ? '留空表示不修改' : '请输入 SecretKey'}
                        type="password"
                        rules={modal.isEdit ? [] : [{ required: true, message: '请输入 SecretKey' }]}
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
                      <Form.Input field="obsSecretAccessKey" label="Secret Access Key" placeholder={modal.isEdit ? '留空表示不修改' : '请输入 Secret Access Key'} type="password" rules={modal.isEdit ? [] : [{ required: true, message: '请输入 Secret Access Key' }]} />
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
                      <Form.Input field="kodoSecretKey" label="Secret Key" placeholder={modal.isEdit ? '留空表示不修改' : '请输入 Secret Key'} type="password" rules={modal.isEdit ? [] : [{ required: true, message: '请输入 Secret Key' }]} />
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
                      <Form.Input field="bosSecretAccessKey" label="Secret Access Key" placeholder={modal.isEdit ? '留空表示不修改' : '请输入 Secret Key'} type="password" rules={modal.isEdit ? [] : [{ required: true, message: '请输入 Secret Access Key' }]} />
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
                      <Form.Input field="azureAccountKey" label="Account Key" placeholder={modal.isEdit ? '留空表示不修改' : '存储账户密钥'} type="password" rules={modal.isEdit ? [] : [{ required: true, message: '请输入 Account Key' }]} />
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
                      <Form.Input field="sftpPassword" label="密码" placeholder={modal.isEdit ? '留空表示不修改' : '密码或私钥二选一'} type="password" />
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
                      <Form.TextArea field="sftpPrivateKey" label="SSH 私钥（可选）" placeholder={modal.isEdit ? '留空表示不修改' : '如果使用私钥登录，请将 PEM 内容粘贴至此'} rows={4} />
                    </Col>
                  </Row>
                </>
              )}
            </Form.Section>

            <Form.Section text="访问与权限">
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
            </Form.Section>
          </Form>
        </Spin>
      </SideSheet>

      <StorageFileBrowser config={browsingConfig} onClose={() => setBrowsingConfig(null)} />
    </div>
  );
}
