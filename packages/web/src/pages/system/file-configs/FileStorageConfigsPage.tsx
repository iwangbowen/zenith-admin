import { FormPasswordInput } from '@/components/PasswordInput';
import { useEffect, useState } from 'react';
import { Button, Col, Form, Radio, Row, Select, Switch, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { PlugZap } from 'lucide-react';
import { fileStorageConfigContract, type CreateFileStorageConfigInput, type FileAccessStrategy, type FileBucketAccessInfo, type FileBucketAcl, type FileObjectAcl, type FileStorageConfig, type FileStorageProvider, type UpdateFileStorageConfigInput } from '@zenith/shared/platform';
import { FILE_ACCESS_STRATEGY_LABELS, FILE_ACCESS_STRATEGY_OPTIONS, FILE_BUCKET_ACCESS_SUPPORT, FILE_BUCKET_ACL_LABELS, FILE_DIRECT_UPLOAD_SUPPORT, FILE_OBJECT_ACL_LABELS, FILE_OBJECT_ACL_SUPPORT, FILE_STORAGE_PROVIDER_LABELS, FILE_STORAGE_PROVIDER_OPTIONS, FILE_UPLOAD_MODE_OPTIONS, PRESIGNED_EXPIRY_DEFAULT_SECONDS, PRESIGNED_EXPIRY_MAX_SECONDS, PRESIGNED_EXPIRY_MIN_SECONDS } from '@zenith/shared/platform';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import ExportButton from '@/components/ExportButton';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, useStatusToggle, useCrudOperationColumn } from '@/components/list-page';
import { abortSubmit } from '@/lib/abort-submit';
import { confirmDangerAsync } from '@/utils/confirm';
import StorageFileBrowser from './StorageFileBrowser';
import {
  useDeleteFileStorageConfigs,
  useFileStorageConfigDetail,
  useFileStorageConfigList,
  useProbeDraftFileStorageConfigBucketAccess,
  useProbeFileStorageConfigBucketAccess,
  useSaveFileStorageConfig,
  useSetDefaultFileStorageConfig,
  useTestFileStorageConfig,
  useUpdateDraftFileStorageConfigBucketAccess,
  useUpdateFileStorageConfigBucketAccess,
} from '@/hooks/queries/file-storage-configs';
import { CreateButton } from '@/components/toolbar-controls';
import { useListPage } from '@/hooks/useListPage';
import { EditFormSheet } from '@/components/EditFormModal';

import './FileStorageConfigsPage.css';

const { Text } = Typography;

type FileStorageConfigFormValues = UpdateFileStorageConfigInput;

/** 支持对象级读写权限（canned ACL）的 provider */
const OBJECT_ACL_PROVIDERS = Object.keys(FILE_OBJECT_ACL_SUPPORT) as FileStorageProvider[];

const ACCESS_STRATEGY_HINTS: Record<FileAccessStrategy, string> = {
  proxy: '所有下载都经过服务端，适合私有文件；上传始终经服务端或直传通道，本项只影响下载地址。',
  presigned: '按需签发限时云直链，适合私有文件；本地磁盘 / SFTP 不支持。',
  'public-object': '上传时给对象设置公共读 ACL；要求 Bucket 未开启「阻止公共访问」。',
  'public-bucket': 'Bucket 本身为公共读，对象保持「继承 Bucket」；要求 Bucket 未开启「阻止公共访问」。',
  'public-domain': '通过 CDN / 自定义域名提供永久直链，Bucket 可保持私有；需要在下方填写访问域名。',
};

function accessStrategiesFor(provider: FileStorageProvider): FileAccessStrategy[] {
  return FILE_ACCESS_STRATEGY_OPTIONS
    .map((option) => option.value)
    .filter((strategy) => {
      if (strategy === 'proxy' || strategy === 'public-domain') return true;
      if (strategy === 'presigned') return provider !== 'local' && provider !== 'sftp';
      if (strategy === 'public-object') return Boolean(FILE_OBJECT_ACL_SUPPORT[provider]);
      return Boolean(FILE_BUCKET_ACCESS_SUPPORT[provider]?.probe);
    });
}

function resolveEffectivePublic(
  provider: FileStorageProvider,
  bucketAcl: FileBucketAcl | null | undefined,
  blockPublicAccess: boolean | null | undefined,
  policyPublic: boolean | null | undefined,
  publicStatus: boolean | null | undefined,
): boolean {
  if (publicStatus !== null && publicStatus !== undefined) return publicStatus;
  const aclPublic = bucketAcl === 'public-read' || bucketAcl === 'public-read-write';
  if (provider === 'oss' || provider === 's3' || provider === 'obs') {
    return (aclPublic || policyPublic === true) && blockPublicAccess === false;
  }
  return aclPublic || policyPublic === true;
}

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
    accessStrategy: values.accessStrategy ?? 'proxy',
    uploadMode: values.uploadMode ?? 'server-proxy',
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
  const canCreateConfig = hasPermission('system:file:config:create');
  const canManageBucketAccess = hasPermission('system:file:config:bucket-access');
  const page = useListPage({
    contract: fileStorageConfigContract,
    useList: useFileStorageConfigList,
  });
  const { tableProps, filterQuery } = page;
  const [formProvider, setFormProvider] = useState<FileStorageProvider>('local');
  const [formStrategy, setFormStrategy] = useState<FileAccessStrategy>('proxy');
  const [formIsDefault, setFormIsDefault] = useState(false);
  const [bucketAccess, setBucketAccess] = useState<FileBucketAccessInfo | null>(null);
  const [browsingConfig, setBrowsingConfig] = useState<FileStorageConfig | null>(null);
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
      accessStrategy: 'proxy',
      uploadMode: 'server-proxy',
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
      accessStrategy: config.accessStrategy ?? 'proxy',
      uploadMode: config.uploadMode ?? 'server-proxy',
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
  const probeDraftBucketMutation = useProbeDraftFileStorageConfigBucketAccess();
  const probeBucketMutation = useProbeFileStorageConfigBucketAccess();
  const updateDraftBucketMutation = useUpdateDraftFileStorageConfigBucketAccess();
  const updateBucketMutation = useUpdateFileStorageConfigBucketAccess();
  const modalTestLoading = testMutation.isPending && !testMutation.variables?.id;
  const testingConfigId = testMutation.isPending ? (testMutation.variables?.id ?? null) : null;

  useEffect(() => {
    if (!modal.editing) {
      setBucketAccess(null);
      return;
    }
    setFormProvider(modal.editing.provider);
    setFormStrategy(modal.editing.accessStrategy ?? 'proxy');
    setFormIsDefault(modal.editing.isDefault);
    const acl = modal.editing.bucketAcl ?? null;
    const blockPublicAccess = modal.editing.bucketBlockPublicAccess ?? null;
    const policyPublic = modal.editing.bucketPolicyPublic ?? null;
    const publicStatus = modal.editing.bucketPublicStatus ?? null;
    setBucketAccess({
      bucketAcl: acl,
      blockPublicAccess,
      policyPublic,
      publicStatus,
      effectivePublic: resolveEffectivePublic(modal.editing.provider, acl, blockPublicAccess, policyPublic, publicStatus),
      checkedAt: modal.editing.bucketAccessCheckedAt ?? '',
    });
  }, [modal.editing]);

  const openCreate = () => {
    setFormProvider('local');
    setFormStrategy('proxy');
    setFormIsDefault(false);
    setBucketAccess(null);
    modal.openCreate();
  };

  const openEdit = (config: FileStorageConfig) => {
    setFormProvider(config.provider);
    setFormStrategy(config.accessStrategy ?? 'proxy');
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

  const getCurrentFormPayload = async () => {
    let values;
    try {
      values = await modal.formApi.current!.validate();
    } catch {
      return null;
    }
    return values ? buildPayload(formProvider, formIsDefault, values) : null;
  };

  const handleProbeBucketAccess = async () => {
    if (modal.editing) {
      const info = await probeBucketMutation.mutateAsync({ params: { id: modal.editing.id } });
      setBucketAccess(info);
      Toast.success('Bucket 权限探测完成');
      return;
    }
    const values = await getCurrentFormPayload();
    if (!values) return;
    const info = await probeDraftBucketMutation.mutateAsync({ body: values });
    setBucketAccess(info);
    Toast.success('Bucket 权限探测完成');
  };

  const applyBucketAccess = async (input: { acl?: FileBucketAcl; blockPublicAccess?: boolean }) => {
    if (modal.editing) {
      const info = await updateBucketMutation.mutateAsync({ params: { id: modal.editing.id }, body: input });
      setBucketAccess(info);
      Toast.success('Bucket 权限已更新');
      return;
    }
    const values = await getCurrentFormPayload();
    if (!values) return;
    const info = await updateDraftBucketMutation.mutateAsync({ body: { config: values, changes: input } });
    setBucketAccess(info);
    Toast.success('Bucket 权限已更新');
  };

  const handleMakePrivate = async () => {
    await applyBucketAccess({ acl: 'private' });
  };

  const handleMakePublicRead = async () => {
    if (!(await confirmDangerAsync({
      title: '确认将 Bucket 设为公共读？',
      content: '该操作会影响整个 Bucket，所有公共读对象都可被匿名访问；请确认没有其他敏感数据。',
      okText: '确认设为公共读',
    }))) return;
    await applyBucketAccess({ acl: 'public-read' });
  };

  const handleToggleBlockPublicAccess = async (next: boolean) => {
    if (!next && !(await confirmDangerAsync({
      title: '确认关闭阻止公共访问？',
      content: '关闭后，Bucket 内所有公共读对象都可能被匿名访问；如果 Bucket ACL 为公共读，将立即对外公开。',
      okText: '确认关闭',
    }))) return;
    await applyBucketAccess({ blockPublicAccess: next });
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

  const operationColumn = useCrudOperationColumn<FileStorageConfig>({
    permission: 'system:file:config',
    edit: openEdit,
    remove: deleteMutation,
    title: '确认删除此文件服务配置？',
    content: '若已绑定文件记录，后端会阻止删除。',
    successMessage: '文件服务配置已删除',
    disabled: { remove: (record) => record.isDefault },
    extra: (record) => [
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
    ],
    extraBetween: (record) => [
      {
        key: 'test',
        label: '测试连接',
        loading: testingConfigId === record.id,
        hidden: !hasPermission('system:file:config'),
        onClick: () => { void handleTestSaved(record); },
      },
    ],
    width: 180,
    desktopInlineKeys: ['browse', 'edit'],
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
        return <Tag color={colorMap[acl]} size="small">{FILE_OBJECT_ACL_LABELS[acl]}</Tag>;
      },
    },
    {
      title: '访问策略',
      dataIndex: 'accessStrategy',
      width: 120,
      align: 'center',
      render: (value: FileAccessStrategy | undefined) => {
        const strategy = value ?? 'proxy';
        const colorMap: Record<FileAccessStrategy, 'grey' | 'green' | 'purple' | 'orange' | 'cyan'> = {
          proxy: 'grey',
          presigned: 'purple',
          'public-object': 'green',
          'public-bucket': 'orange',
          'public-domain': 'cyan',
        };
        return <Tag color={colorMap[strategy]} size="small">{FILE_ACCESS_STRATEGY_LABELS[strategy]}</Tag>;
      },
    },
    dateTimeColumn('更新时间', 'updatedAt'),
    status.column(),
    operationColumn,
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        page={page}
        filters={['status', ['startTime', 'endTime']]}
        create={<CreateButton permission="system:file:config:create" onClick={openCreate} />}
        actions={(
          <ExportButton entity="system.file-storage-configs" query={filterQuery} />
        )}
        filterTitle="文件配置筛选"
        actionTitle="文件配置操作"
      />
      <div className="storage-configs-tip" style={{ marginBottom: 0, marginTop: -4 }}>
        <Text type="secondary">当前支持多文件服务配置，但上传时会优先走"默认文件服务"。切换默认服务不会影响历史文件记录。</Text>
      </div>

      <ConfigurableTable<FileStorageConfig>
        columns={columns}
        {...tableProps}
      />

      <EditFormSheet modal={modal} width={780} formProps={{ onValueChange: () => { if (!modal.editing) setBucketAccess(null); } }} footer={( <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}> <Button icon={<PlugZap size={14} />} loading={modalTestLoading} disabled={modal.detailLoading} onClick={() => void handleModalTest()}> 测试连接 </Button> <div style={{ display: 'flex', gap: 8 }}> <Button type="tertiary" onClick={modal.close}>取消</Button> <Button type="primary" theme="solid" loading={modal.modalProps.okButtonProps.loading} disabled={modal.modalProps.okButtonProps.disabled} onClick={() => void modal.modalProps.onOk()} > 保存 </Button> </div> </div> )}>
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
                  setBucketAccess(null);
                  const currentAcl = modal.formApi.current?.getValue('objectAcl') as FileObjectAcl | undefined;
                  if (currentAcl && !(FILE_OBJECT_ACL_SUPPORT[next] ?? []).includes(currentAcl)) {
                    modal.formApi.current?.setValue('objectAcl', 'default');
                  }
                  if (!FILE_DIRECT_UPLOAD_SUPPORT[next]) {
                    modal.formApi.current?.setValue('uploadMode', 'server-proxy');
                  }
                  const currentStrategy = modal.formApi.current?.getValue('accessStrategy') as FileAccessStrategy | undefined;
                  if (currentStrategy && !accessStrategiesFor(next).includes(currentStrategy)) {
                    modal.formApi.current?.setValue('accessStrategy', 'proxy');
                    setFormStrategy('proxy');
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
                  <FormPasswordInput
                    field="ossAccessKeySecret"
                    label="AccessKey Secret"
                    placeholder={modal.isEdit ? '留空表示不修改' : '请输入 AccessKey Secret'}
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
                  <FormPasswordInput
                    field="s3SecretAccessKey"
                    label="Secret Access Key"
                    placeholder={modal.isEdit ? '留空表示不修改' : '请输入 Secret Access Key'}
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
                  <FormPasswordInput
                    field="cosSecretKey"
                    label="SecretKey"
                    placeholder={modal.isEdit ? '留空表示不修改' : '请输入 SecretKey'}
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
                  <FormPasswordInput field="obsSecretAccessKey" label="Secret Access Key" placeholder={modal.isEdit ? '留空表示不修改' : '请输入 Secret Access Key'} rules={modal.isEdit ? [] : [{ required: true, message: '请输入 Secret Access Key' }]} />
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
                  <FormPasswordInput field="kodoSecretKey" label="Secret Key" placeholder={modal.isEdit ? '留空表示不修改' : '请输入 Secret Key'} rules={modal.isEdit ? [] : [{ required: true, message: '请输入 Secret Key' }]} />
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
                  <FormPasswordInput field="bosSecretAccessKey" label="Secret Access Key" placeholder={modal.isEdit ? '留空表示不修改' : '请输入 Secret Key'} rules={modal.isEdit ? [] : [{ required: true, message: '请输入 Secret Access Key' }]} />
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
                  <FormPasswordInput field="azureAccountKey" label="Account Key" placeholder={modal.isEdit ? '留空表示不修改' : '存储账户密钥'} rules={modal.isEdit ? [] : [{ required: true, message: '请输入 Account Key' }]} />
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
                  <FormPasswordInput field="sftpPassword" label="密码" placeholder={modal.isEdit ? '留空表示不修改' : '密码或私钥二选一'} />
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
                <Radio key={acl} value={acl}>{FILE_OBJECT_ACL_LABELS[acl]}</Radio>
              ))}
            </Form.RadioGroup>
          )}

          <Row gutter={16}>
            <Col span={24}>
              <Form.Select
                field="uploadMode"
                label="上传方式"
                style={{ width: '100%' }}
                disabled={!FILE_DIRECT_UPLOAD_SUPPORT[formProvider]}
                extraText={FILE_DIRECT_UPLOAD_SUPPORT[formProvider]
                  ? '服务端中转：文件经服务端转发；浏览器直传：浏览器分片上传到云存储，服务端仅签发短时、限定对象范围的上传凭证并完成校验。'
                  : '当前存储类型仅支持服务端中转。'}
              >
                {FILE_UPLOAD_MODE_OPTIONS.map((opt) => (
                  <Select.Option key={opt.value} value={opt.value}>{opt.label}</Select.Option>
                ))}
              </Form.Select>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={24}>
              <Form.Select
                field="accessStrategy"
                label="下载方式"
                style={{ width: '100%' }}
                extraText={ACCESS_STRATEGY_HINTS[formStrategy]}
                onChange={(value) => setFormStrategy(value as FileAccessStrategy)}
              >
                {accessStrategiesFor(formProvider).map((strategy) => (
                  <Select.Option key={strategy} value={strategy}>{FILE_ACCESS_STRATEGY_LABELS[strategy]}</Select.Option>
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

        {(modal.editing || canCreateConfig) && FILE_BUCKET_ACCESS_SUPPORT[formProvider]?.probe && (
          <Form.Section text="云端 Bucket 权限（实时）">
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Text type="secondary">Bucket ACL：</Text>
              <Tag size="small">{bucketAccess?.bucketAcl ? FILE_BUCKET_ACL_LABELS[bucketAccess.bucketAcl] : '未知'}</Tag>
              <Text type="secondary">Bucket 级阻止公共访问：</Text>
              <Tag
                size="small"
                color={bucketAccess?.blockPublicAccess === null || bucketAccess?.blockPublicAccess === undefined
                  ? 'grey'
                  : bucketAccess.blockPublicAccess ? 'red' : 'green'}
              >
                {bucketAccess?.blockPublicAccess === null || bucketAccess?.blockPublicAccess === undefined
                  ? '未知'
                  : bucketAccess.blockPublicAccess ? '开启' : '关闭'}
              </Tag>
              <Text type="secondary">Bucket Policy 公共访问：</Text>
              <Tag
                size="small"
                color={bucketAccess?.policyPublic === null || bucketAccess?.policyPublic === undefined
                  ? 'grey'
                  : bucketAccess.policyPublic ? 'red' : 'green'}
              >
                {bucketAccess?.policyPublic === null || bucketAccess?.policyPublic === undefined
                  ? '未知'
                  : bucketAccess.policyPublic ? '是' : '否'}
              </Tag>
              {bucketAccess?.publicStatus !== null && bucketAccess?.publicStatus !== undefined && (
                <>
                  <Text type="secondary">云端公共状态：</Text>
                  <Tag size="small" color={bucketAccess.publicStatus ? 'red' : 'green'}>
                    {bucketAccess.publicStatus ? '公共' : '私有'}
                  </Tag>
                </>
              )}
              <Text type="secondary">实际公共读：</Text>
              <Tag size="small" color={bucketAccess?.checkedAt ? (bucketAccess.effectivePublic ? 'green' : 'red') : 'grey'}>
                {bucketAccess?.checkedAt ? (bucketAccess.effectivePublic ? '是' : '否') : '未知'}
              </Tag>
              {bucketAccess?.checkedAt && <Text type="tertiary">检测于 {bucketAccess.checkedAt}</Text>}
            </div>
            {modal.editing?.bucketAccessError && (
              <Text type="danger" style={{ display: 'block', marginBottom: 8 }}>
                最近一次探测失败：{modal.editing.bucketAccessError}
              </Text>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Button size="small" loading={probeBucketMutation.isPending || probeDraftBucketMutation.isPending} onClick={() => void handleProbeBucketAccess()}>
                {bucketAccess?.checkedAt ? '重新探测' : '探测权限'}
              </Button>
              <Button
                size="small"
                disabled={!canManageBucketAccess || !bucketAccess || probeBucketMutation.isPending || probeDraftBucketMutation.isPending || updateBucketMutation.isPending || updateDraftBucketMutation.isPending || bucketAccess.bucketAcl === 'private'}
                onClick={() => void handleMakePrivate()}
              >
                设为私有
              </Button>
              <Button
                size="small"
                type="danger"
                disabled={!canManageBucketAccess || !bucketAccess || probeBucketMutation.isPending || probeDraftBucketMutation.isPending || updateBucketMutation.isPending || updateDraftBucketMutation.isPending || bucketAccess.bucketAcl === 'public-read'}
                onClick={() => void handleMakePublicRead()}
              >
                设为公共读
              </Button>
              {FILE_BUCKET_ACCESS_SUPPORT[formProvider]?.setBlockPublicAccess && (
                <Button
                  size="small"
                  type={bucketAccess?.blockPublicAccess ? 'danger' : 'primary'}
                  loading={updateBucketMutation.isPending || updateDraftBucketMutation.isPending}
                  disabled={!canManageBucketAccess || !bucketAccess || probeBucketMutation.isPending || probeDraftBucketMutation.isPending || updateBucketMutation.isPending || updateDraftBucketMutation.isPending}
                  onClick={() => void handleToggleBlockPublicAccess(!(bucketAccess?.blockPublicAccess ?? false))}
                >
                  {bucketAccess?.blockPublicAccess ? '关闭阻止公共访问' : '开启阻止公共访问'}
                </Button>
              )}
            </div>
            <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              以下操作会立即修改云端 Bucket，不受「保存」影响；新增配置使用当前表单凭据，权限变更会影响同 Bucket 的其他应用。
            </Text>
          </Form.Section>
        )}
      </EditFormSheet>

      <StorageFileBrowser config={browsingConfig} onClose={() => setBrowsingConfig(null)} />
    </div>
  );
}
