/**
 * 应用版本管理页。
 *
 * Tab「版本管理」：应用（对话框内维护）→ 版本（主表格，状态机 draft → published → revoked）
 * → 制品（抽屉内上传 / 外链）。
 * Tab「统计图表」：检查 / 下载 / 安装回执的升级看板（趋势、平台分布、版本分布）。
 */
import { useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Modal,
  Row,
  Select,
  SideSheet,
  Skeleton,
  Space,
  Spin,
  Switch,
  Table,
  TabPane,
  Tabs,
  Tag,
  Toast,
  Typography,
  Upload,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import {
  Activity,
  CheckCircle2,
  Download,
  MonitorSmartphone,
  Settings2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import {
  APP_ARCH_LABELS,
  APP_ARCH_OPTIONS,
  APP_ARTIFACT_KIND_LABELS,
  APP_PLATFORM_LABELS,
  APP_PLATFORM_OPTIONS,
  APP_RELEASE_CHANNEL_LABELS,
  APP_RELEASE_CHANNEL_OPTIONS,
  APP_RELEASE_STATUS_LABELS,
  APP_RELEASE_STATUS_OPTIONS,
  APP_FILE_ARTIFACT_KINDS,
  APP_PLATFORMS,
  APP_RELEASE_CHANNELS,
  APP_RELEASE_STATUSES,
  DEVICE_SUBJECT_TYPES,
  type AppArch,
  type AppArtifact,
  type AppFileArtifactKind,
  type AppPlatform,
  type AppRelease,
  type AppReleaseChannel,
  type AppReleaseStatus,
  type ClientApp,
  type ClientDevice,
  type CreateAppReleaseInput,
  type CreateClientAppInput,
  publicAppReleaseContract,
} from '@zenith/shared/ops';
import { enumValueOf } from '@zenith/shared/core';
import ConfigurableTable from '@/components/ConfigurableTable';
import AppModal from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { CreateButton, RefreshButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { SliderInput, FormSliderInput } from '@/components/SliderInput';
import {
  BarChart,
  LineChart,
  PieChart,
  chartOptions,
  makeBarSpec,
  makeLineSpec,
  makePieSpec,
  useChartPalette,
  StatCard,
  StatGrid,
} from '@/components/charts';
import { EMPTY_PLACEHOLDER, createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { confirmDelete } from '@/utils/confirm';
import { copyTextWithToast } from '@/utils/clipboard';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import {
  appReleaseKeys,
  clientDeviceKeys,
  useAddExternalArtifact,
  useAllClientApps,
  useAppReleaseDetail,
  useAppReleaseList,
  useAppReleaseStats,
  useClientAppList,
  useClientDeviceList,
  useDeleteAppArtifact,
  useDeleteAppReleases,
  useDeleteClientApps,
  useDeleteClientDevice,
  usePublishAppRelease,
  useRevokeAppRelease,
  useSaveAppRelease,
  useSaveClientApp,
  useSetAppReleaseRollout,
  useUnbindDevicePush,
  useUploadAppArtifact,
} from '@/hooks/queries/app-releases';
import { formatBytes } from '@zenith/shared/core';
import { urlOf } from '@/lib/contract-query';

const { Text } = Typography;

const CHANNEL_TAG_COLORS: Record<AppReleaseChannel, 'green' | 'orange' | 'grey'> = {
  stable: 'green',
  beta: 'orange',
  internal: 'grey',
};

const STATUS_TAG_COLORS: Record<AppReleaseStatus, 'grey' | 'green' | 'red'> = {
  draft: 'grey',
  published: 'green',
  revoked: 'red',
};

function shortDate(dateStr: string) {
  return dateStr.length >= 5 ? dateStr.slice(5) : dateStr;
}

/** 复制托管制品的公开下载链接（external 直接复制外链） */
function copyArtifactLink(release: AppRelease, artifact: AppArtifact) {
  const url = artifact.kind === 'external' && artifact.externalUrl
    ? artifact.externalUrl
    : `${window.location.origin}${urlOf(publicAppReleaseContract.download, {
      params: { app: release.appKey ?? '', channel: release.channel, platform: artifact.platform, filename: artifact.fileName },
    })}`;
  void copyTextWithToast(url, { success: '下载链接已复制', error: '复制失败' });
}

// ─── 应用管理对话框（应用是轻量配置，列表 + 行内编辑对话框即可）────────────────

function AppsManageModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { hasPermission } = usePermission();
  const listQuery = useClientAppList({ page: 1, pageSize: 100 }, visible);
  const apps = listQuery.data?.list ?? [];

  const modal = useEditModal<ClientApp, Partial<CreateClientAppInput>>({
    entityName: '应用',
    save: useSaveClientApp(),
    toValues: (r) => ({ appKey: r.appKey, name: r.name, description: r.description ?? '' }),
  });
  const toggleMutation = useSaveClientApp();
  const deleteMutation = useDeleteClientApps();
  const togglingId = toggleMutation.isPending ? (toggleMutation.variables?.id ?? null) : null;

  const canUpdate = hasPermission('system:app-release:update');

  const columns: ColumnProps<ClientApp>[] = [
    { title: 'appKey', dataIndex: 'appKey', width: 160, render: renderEllipsis },
    { title: '名称', dataIndex: 'name', minWidth: 150, render: renderEllipsis },
    { title: '版本数', dataIndex: 'releaseCount', width: 80 },
    {
      title: '最新版本', dataIndex: 'latestVersion', width: 100,
      render: (v: string | null) => v ?? EMPTY_PLACEHOLDER,
    },
    {
      title: '状态', dataIndex: 'status', width: 70,
      render: (_: unknown, record: ClientApp) => (
        <Switch
          checked={record.status === 'enabled'}
          loading={togglingId === record.id}
          disabled={!canUpdate}
          size="small"
          onChange={(checked) => {
            const doToggle = () => toggleMutation.mutate(
              { id: record.id, values: { status: checked ? 'enabled' : 'disabled' } },
              { onSuccess: () => Toast.success(checked ? '已启用' : '已停用') },
            );
            if (checked) doToggle();
            else Modal.confirm({
              title: '确认停用',
              content: `停用后「${record.name}」的公开升级接口将不可用，确认停用？`,
              onOk: doToggle,
            });
          }}
        />
      ),
    },
    createOperationColumn<ClientApp>({
      width: 150,
      actions: (record) => [
        ...(canUpdate ? [{ key: 'edit', label: '编辑', onClick: () => modal.openEdit(record) }] : []),
        ...(hasPermission('system:app-release:delete') ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            confirmDelete({
              title: `确定要删除应用「${record.name}」吗？`,
              content: '需先删除该应用下的全部版本，删除后客户端将无法再检查更新',
              onOk: async () => {
                await deleteMutation.mutateAsync([record.id]);
                Toast.success('删除成功');
              },
            });
          },
        }] : []),
      ],
    }),
  ];

  return (
    <>
      <Modal
        title="应用管理"
        visible={visible}
        onCancel={onClose}
        footer={null}
        closeOnEsc
        width={760}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          {hasPermission('system:app-release:create') && <CreateButton onClick={modal.openCreate}>新增应用</CreateButton>}
        </div>
        <Table
          bordered
          columns={columns}
          dataSource={apps}
          loading={listQuery.isFetching}
          rowKey="id"
          size="small"
          pagination={false}
          empty="暂无应用，先创建一个（如 zenith-desktop）"
        />
      </Modal>

      <AppModal {...modal.modalProps} width={560}>
        <Form key={modal.formKey} {...modal.formProps}>
          <Form.Input
            field="appKey"
            label="应用标识"
            placeholder="如 zenith-desktop（客户端用它检查更新，创建后不可修改）"
            disabled={modal.isEdit}
            rules={[
              { required: true, message: '应用标识不能为空' },
              { pattern: /^[a-z0-9][a-z0-9-]*$/, message: '仅允许小写字母、数字与连字符' },
            ]}
          />
          <Form.Input field="name" label="应用名称" placeholder="请输入应用名称"
            rules={[{ required: true, message: '名称不能为空' }]} />
          <Form.TextArea field="description" label="描述" placeholder="选填" rows={2} maxCount={500} />
        </Form>
      </AppModal>
    </>
  );
}

// ─── 制品抽屉 ─────────────────────────────────────────────────────────────────

function ExternalArtifactModal({ releaseId, visible, onClose }: {
  releaseId: number;
  visible: boolean;
  onClose: () => void;
}) {
  // 不用 useEditModal：这是绑定 releaseId 的子资源创建表单，save 契约是
  // { releaseId, values } 而非标准 CRUD 的 { id, values }
  const formApiRef = useRef<FormApi | null>(null);
  const addMutation = useAddExternalArtifact();

  async function handleOk() {
    const api = formApiRef.current;
    if (!api) return;
    let values: { platform: AppPlatform; arch: AppArch; externalUrl: string; fileName: string };
    try {
      values = await api.validate() as typeof values;
    } catch {
      return;
    }
    await addMutation.mutateAsync({ params: { id: releaseId }, body: values });
    Toast.success('外链制品已添加');
    onClose();
  }

  return (
    <Modal
      title="添加外链制品"
      visible={visible}
      onOk={() => void handleOk()}
      onCancel={onClose}
      okButtonProps={{ loading: addMutation.isPending }}
      closeOnEsc
      width={560}
    >
      <Form
        getFormApi={(api) => { formApiRef.current = api; }}
        labelPosition="left"
        labelWidth={90}
        allowEmpty
        initValues={{ platform: 'ios', arch: 'universal' }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Select field="platform" label="平台" style={{ width: '100%' }}
              optionList={APP_PLATFORM_OPTIONS} rules={[{ required: true, message: '请选择平台' }]} />
          </Col>
          <Col span={12}>
            <Form.Select field="arch" label="架构" style={{ width: '100%' }} optionList={APP_ARCH_OPTIONS} />
          </Col>
        </Row>
        <Form.Input field="externalUrl" label="外部链接" placeholder="App Store / TestFlight 等下载页地址"
          rules={[{ required: true, message: '外部链接不能为空' }]} />
        <Form.Input field="fileName" label="显示名" placeholder="如 App Store（对外展示与去重用）"
          rules={[{ required: true, message: '显示名不能为空' }]} />
      </Form>
    </Modal>
  );
}

function ArtifactsSheet({ releaseId, onClose }: { releaseId: number | null; onClose: () => void }) {
  const { hasPermission } = usePermission();
  const detailQuery = useAppReleaseDetail(releaseId ?? undefined, releaseId != null);
  const release = detailQuery.data ?? null;

  const [uploadPlatform, setUploadPlatform] = useState<AppPlatform>('windows');
  const [uploadArch, setUploadArch] = useState<AppArch>('x64');
  const [uploadKind, setUploadKind] = useState<AppFileArtifactKind>('installer');
  const [externalVisible, setExternalVisible] = useState(false);

  const uploadMutation = useUploadAppArtifact();
  const deleteMutation = useDeleteAppArtifact();

  const canCreate = hasPermission('system:app-release:create');
  const canDelete = hasPermission('system:app-release:delete');

  const columns: ColumnProps<AppArtifact>[] = [
    { title: '平台', dataIndex: 'platform', width: 90, render: (v: AppPlatform) => APP_PLATFORM_LABELS[v] },
    { title: '架构', dataIndex: 'arch', width: 80, render: (v: AppArch) => APP_ARCH_LABELS[v] },
    {
      title: '类型', dataIndex: 'kind', width: 100,
      render: (v: AppArtifact['kind']) => <Tag color={v === 'metadata' ? 'grey' : 'blue'} size="small">{APP_ARTIFACT_KIND_LABELS[v]}</Tag>,
    },
    { title: '文件名', dataIndex: 'fileName', minWidth: 220, render: renderEllipsis },
    {
      title: '大小', dataIndex: 'size', width: 90,
      render: (v: number, record: AppArtifact) => (record.kind === 'external' ? EMPTY_PLACEHOLDER : formatBytes(v)),
    },
    { title: '下载量', dataIndex: 'downloadCount', width: 80 },
    createOperationColumn<AppArtifact>({
      width: 180,
      actions: (record) => [
        {
          key: 'copy', label: '复制链接',
          onClick: () => { if (release) copyArtifactLink(release, record); },
        },
        ...(canDelete ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            confirmDelete({
              title: `确定要删除制品「${record.fileName}」吗？`,
              content: '删除后该文件立即不可下载',
              onOk: async () => {
                await deleteMutation.mutateAsync({ artifactId: record.id, releaseId: record.releaseId });
                Toast.success('删除成功');
              },
            });
          },
        }] : []),
      ],
    }),
  ];

  return (
    <SideSheet
      title={release ? `制品管理 · ${release.appName ?? ''} v${release.version}` : '制品管理'}
      visible={releaseId != null}
      onCancel={onClose}
      width={820}
      closeOnEsc
    >
      <Spin spinning={detailQuery.isFetching && !release}>
        {release && (
          <Space style={{ marginBottom: 12 }} spacing={8}>
            <Tag color={CHANNEL_TAG_COLORS[release.channel]} size="small">{APP_RELEASE_CHANNEL_LABELS[release.channel]}</Tag>
            <Tag color={STATUS_TAG_COLORS[release.status]} size="small">{APP_RELEASE_STATUS_LABELS[release.status]}</Tag>
            <Text type="tertiary" size="small">
              electron-updater feed：{publicAppReleaseContract.basePath}/{release.appKey}/{release.channel}/{'{platform}'}/latest.yml
            </Text>
          </Space>
        )}

        {canCreate && (
          <Card style={{ marginBottom: 12 }} bodyStyle={{ padding: 12 }}>
            <Space wrap spacing={8} style={{ marginBottom: 8 }}>
              <Select prefix="平台" value={uploadPlatform} onChange={(v) => setUploadPlatform(v as AppPlatform)}
                optionList={APP_PLATFORM_OPTIONS} style={{ width: 150 }} />
              <Select prefix="架构" value={uploadArch} onChange={(v) => setUploadArch(v as AppArch)}
                optionList={APP_ARCH_OPTIONS} style={{ width: 130 }} />
              <Select prefix="类型" value={uploadKind} onChange={(v) => setUploadKind(v as AppFileArtifactKind)}
                optionList={APP_FILE_ARTIFACT_KINDS.map((k) => ({ value: k, label: APP_ARTIFACT_KIND_LABELS[k] }))}
                style={{ width: 150 }} />
              <Button theme="light" onClick={() => setExternalVisible(true)}>添加外链制品</Button>
            </Space>
            <Upload
              action=""
              limit={1}
              showUploadList={false}
              disabled={uploadMutation.isPending || releaseId == null}
              draggable
              customRequest={async ({ fileInstance, onProgress, onSuccess, onError }) => {
                if (releaseId == null) return;
                try {
                  const formData = new FormData();
                  formData.append('file', fileInstance);
                  formData.append('platform', uploadPlatform);
                  formData.append('arch', uploadArch);
                  formData.append('kind', uploadKind);
                  await uploadMutation.mutateAsync({
                    releaseId,
                    formData,
                    onProgress: (percent) => onProgress?.({ total: 100, loaded: percent }),
                  });
                  Toast.success('上传成功');
                  onSuccess?.({});
                } catch {
                  onError?.({ status: 0 });
                }
              }}
            >
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--semi-color-text-2)' }}>
                {uploadMutation.isPending
                  ? <Spin />
                  : (
                    <>
                      <UploadCloud size={26} style={{ marginBottom: 6 }} />
                      <div>点击或拖拽上传制品（安装包 / 热更包 / latest.yml / blockmap）</div>
                    </>
                  )}
              </div>
            </Upload>
          </Card>
        )}

        <Table
          bordered
          columns={columns}
          dataSource={release?.artifacts ?? []}
          loading={detailQuery.isFetching}
          rowKey="id"
          size="small"
          pagination={false}
          empty="暂无制品，上传安装包或添加外链后才能发布"
        />
      </Spin>

      {releaseId != null && (
        <ExternalArtifactModal
          releaseId={releaseId}
          visible={externalVisible}
          onClose={() => setExternalVisible(false)}
        />
      )}
    </SideSheet>
  );
}

// ─── 灰度调整对话框 ───────────────────────────────────────────────────────────

function RolloutModal({ release, onClose }: { release: AppRelease | null; onClose: () => void }) {
  const rolloutMutation = useSetAppReleaseRollout();
  const [percent, setPercent] = useState<number | null>(null);
  const releaseId = release?.id ?? null;
  // 未拖动前显示当前值
  const effectivePercent = percent ?? release?.rolloutPercent ?? 100;

  return (
    <Modal
      title={release ? `调整灰度 · v${release.version}` : '调整灰度'}
      visible={release != null}
      onOk={async () => {
        if (releaseId == null) return;
        await rolloutMutation.mutateAsync({ params: { id: releaseId }, body: { rolloutPercent: effectivePercent } });
        Toast.success(`灰度已调整为 ${effectivePercent}%`);
        onClose();
      }}
      onCancel={onClose}
      okButtonProps={{ loading: rolloutMutation.isPending }}
      closeOnEsc
      afterClose={() => setPercent(null)}
      width={480}
    >
      <Text type="tertiary" size="small">
        按设备标识哈希放量，同一设备对同一版本的命中结论恒定；未携带设备标识的客户端只在 100% 时可见。
      </Text>
      <div style={{ marginTop: 16 }}>
        <SliderInput value={effectivePercent} onChange={setPercent} min={0} max={100} suffix="%" />
      </div>
    </Modal>
  );
}

// ─── 版本管理 Tab ─────────────────────────────────────────────────────────────

interface SearchParams {
  appId?: number;
  channel?: string;
  status?: string;
  keyword: string;
}

const defaultSearchParams: SearchParams = { appId: undefined, channel: undefined, status: undefined, keyword: '' };

function ReleaseManageTab({ active }: { active: boolean }) {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: appReleaseKeys.lists });

  const listQuery = useAppReleaseList({
    page,
    pageSize,
    appId: submittedParams.appId,
    channel: enumValueOf(APP_RELEASE_CHANNELS, submittedParams.channel),
    status: enumValueOf(APP_RELEASE_STATUSES, submittedParams.status),
    keyword: submittedParams.keyword || undefined,
  }, active);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const appsQuery = useAllClientApps(active);
  const apps = appsQuery.data ?? [];
  const appOptions = apps.map((a) => ({ value: a.id, label: a.name }));

  const modal = useEditModal<AppRelease, Partial<CreateAppReleaseInput>>({
    entityName: '版本',
    save: useSaveAppRelease(),
    useDetail: useAppReleaseDetail,
    defaults: { channel: 'stable', mandatory: false, rolloutPercent: 100 },
    toValues: (r) => ({
      appId: r.appId,
      channel: r.channel,
      version: r.version,
      minVersion: r.minVersion ?? '',
      rolloutPercent: r.rolloutPercent,
      mandatory: r.mandatory,
      notes: r.notes ?? '',
    }),
    // minVersion 留空须转 null（后端 semver 校验拒绝空串）
    beforeSave: (values) => ({
      ...values,
      version: typeof values.version === 'string' ? values.version.trim() : values.version,
      minVersion: typeof values.minVersion === 'string' && values.minVersion.trim() ? values.minVersion.trim() : null,
    }),
  });

  const publishMutation = usePublishAppRelease();
  const revokeMutation = useRevokeAppRelease();
  const deleteMutation = useDeleteAppReleases();

  const [appsModalVisible, setAppsModalVisible] = useState(false);
  const [artifactReleaseId, setArtifactReleaseId] = useState<number | null>(null);
  const [rolloutRelease, setRolloutRelease] = useState<AppRelease | null>(null);

  const canUpdate = hasPermission('system:app-release:update');
  const canPublish = hasPermission('system:app-release:publish');

  function confirmPublish(record: AppRelease) {
    Modal.confirm({
      title: `确认发布 v${record.version}？`,
      content: '发布后该版本立即对客户端可见（按灰度比例放量）',
      onOk: async () => {
        await publishMutation.mutateAsync({ params: { id: record.id } });
        Toast.success('发布成功');
      },
    });
  }

  function confirmRevoke(record: AppRelease) {
    Modal.confirm({
      title: `确认撤回 v${record.version}？`,
      content: '撤回后客户端将不再收到该版本，已下载的不受影响',
      onOk: async () => {
        await revokeMutation.mutateAsync({ params: { id: record.id } });
        Toast.success('已撤回');
      },
    });
  }

  const columns: ColumnProps<AppRelease>[] = [
    {
      title: '版本号', dataIndex: 'version', width: 120,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    { title: '应用', dataIndex: 'appName', minWidth: 140, render: renderEllipsis },
    {
      title: '渠道', dataIndex: 'channel', width: 90,
      render: (v: AppReleaseChannel) => <Tag color={CHANNEL_TAG_COLORS[v]} size="small">{APP_RELEASE_CHANNEL_LABELS[v]}</Tag>,
    },
    {
      title: '强制更新', dataIndex: 'mandatory', width: 130,
      render: (v: boolean, record: AppRelease) => (v || record.minVersion
        ? <Tag color="red" size="small">{v ? '强更' : `< ${record.minVersion} 强更`}</Tag>
        : EMPTY_PLACEHOLDER),
    },
    {
      title: '灰度', dataIndex: 'rolloutPercent', width: 80,
      render: (v: number) => (v === 100 ? '全量' : `${v}%`),
    },
    { title: '制品数', dataIndex: 'artifactCount', width: 80 },
    dateTimeColumn('发布时间', 'publishedAt', { empty: '未发布' }),
    createdAtColumn,
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: AppReleaseStatus) => <Tag color={STATUS_TAG_COLORS[v]} size="small">{APP_RELEASE_STATUS_LABELS[v]}</Tag>,
    },
    createOperationColumn<AppRelease>({
      width: 180,
      desktopInlineKeys: ['artifacts', 'edit'],
      actions: (record) => [
        { key: 'artifacts', label: '制品', onClick: () => setArtifactReleaseId(record.id) },
        ...(canUpdate ? [{ key: 'edit', label: '编辑', onClick: () => modal.openEdit(record) }] : []),
        ...(canPublish && record.status !== 'published' ? [{
          key: 'publish', label: '发布', onClick: () => confirmPublish(record),
        }] : []),
        ...(canPublish && record.status === 'published' ? [{
          key: 'revoke', label: '撤回', onClick: () => confirmRevoke(record),
        }] : []),
        ...(canUpdate && record.status === 'published' ? [{
          key: 'rollout', label: '灰度', onClick: () => setRolloutRelease(record),
        }] : []),
        ...(hasPermission('system:app-release:delete') && record.status !== 'published' ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            confirmDelete({
              title: `确定要删除版本 v${record.version} 吗？`,
              content: '版本下的制品文件将一并删除，不可恢复',
              onOk: async () => {
                await deleteMutation.mutateAsync([record.id]);
                Toast.success('删除成功');
              },
            });
          },
        }] : []),
      ],
    }),
  ];

  const renderAppFilter = () => (
    <FilterSelect
      placeholder="全部应用"
      items={appOptions}
      value={draftParams.appId}
      onChange={(v) => setDraftParams((p) => ({ ...p, appId: v as number | undefined }))}
      width={160}
    />
  );

  const renderChannelFilter = () => (
    <FilterSelect
      placeholder="全部渠道"
      items={APP_RELEASE_CHANNEL_OPTIONS}
      value={draftParams.channel}
      onChange={(v) => setDraftParams((p) => ({ ...p, channel: v }))}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={APP_RELEASE_STATUS_OPTIONS}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderKeywordSearch = () => (
    <KeywordInput
      placeholder="搜索版本号 / 更新日志..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      onSearch={handleSearch}
    />
  );

  const renderCreateButton = () => hasPermission('system:app-release:create')
    ? <CreateButton onClick={modal.openCreate}>新增版本</CreateButton> : null;

  const renderAppsManageButton = (borderless?: boolean) => (
    <Button
      icon={<Settings2 size={14} />}
      theme={borderless ? 'borderless' : 'light'}
      onClick={() => setAppsModalVisible(true)}
    >
      应用管理
    </Button>
  );

  const isEditLocked = modal.isEdit && modal.editing?.status !== 'draft';

  return (
    <>
      <SearchToolbar
        primary={<>
          {renderAppFilter()}
          {renderKeywordSearch()}
          <SearchButton onClick={handleSearch} />
          <ResetButton onClick={handleReset} />
        </>}
        filters={<>
          {renderChannelFilter()}
          {renderStatusFilter()}
        </>}
        actions={<>
          {renderAppsManageButton()}
          {renderCreateButton()}
        </>}
        mobilePrimary={<>
          {renderKeywordSearch()}
          <SearchButton onClick={handleSearch} />
          {renderCreateButton()}
        </>}
        mobileFilters={<>
          {renderAppFilter()}
          {renderChannelFilter()}
          {renderStatusFilter()}
        </>}
        mobileActions={renderAppsManageButton(true)}
        filterTitle="筛选条件"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无版本，点击「新增版本」创建草稿"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />

      <AppModal {...modal.modalProps} width={660}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select field="appId" label="所属应用" style={{ width: '100%' }}
                  optionList={appOptions} disabled={modal.isEdit}
                  rules={[{ required: true, message: '请选择应用' }]} />
              </Col>
              <Col span={12}>
                <Form.Select field="channel" label="渠道" style={{ width: '100%' }}
                  optionList={APP_RELEASE_CHANNEL_OPTIONS} disabled={isEditLocked} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="version" label="版本号" placeholder="如 1.86.0" disabled={isEditLocked}
                  rules={[
                    { required: true, message: '版本号不能为空' },
                    { pattern: /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, message: '须为 semver 格式，如 1.2.3' },
                  ]} />
              </Col>
              <Col span={12}>
                <Form.Input field="minVersion" label="最低版本" placeholder="低于该版本强制更新（选填）"
                  rules={[{ pattern: /^$|^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, message: '须为 semver 格式' }]} />
              </Col>
            </Row>
            <FormSliderInput field="rolloutPercent" label="灰度比例" min={0} max={100} suffix="%" />
            <Form.Switch field="mandatory" label="强制更新" />
            <Form.TextArea field="notes" label="更新日志" placeholder="支持 Markdown，客户端更新弹窗展示" rows={5} maxCount={20000} />
          </Form>
        </Spin>
      </AppModal>

      <AppsManageModal visible={appsModalVisible} onClose={() => setAppsModalVisible(false)} />
      <ArtifactsSheet releaseId={artifactReleaseId} onClose={() => setArtifactReleaseId(null)} />
      <RolloutModal release={rolloutRelease} onClose={() => setRolloutRelease(null)} />
    </>
  );
}

// ─── 统计图表 Tab ─────────────────────────────────────────────────────────────

const DAYS_OPTIONS = [
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
  { value: 90, label: '近 90 天' },
];

function ReleaseStatsTab({ active }: { active: boolean }) {
  const palette = useChartPalette();
  const appsQuery = useAllClientApps(active);
  const apps = appsQuery.data ?? [];
  const [selectedAppId, setSelectedAppId] = useState<number>();
  const appId = selectedAppId ?? apps[0]?.id;
  const [days, setDays] = useState(30);

  const statsQuery = useAppReleaseStats(active ? appId : undefined, days);
  const stats = statsQuery.data ?? null;
  const loading = statsQuery.isFetching;

  const trendSpec = useMemo(() => makeLineSpec({
    data: stats?.trend ?? [],
    xField: 'date',
    series: [
      { field: 'checks', name: '检查更新', color: '#4A90E2' },
      { field: 'downloads', name: '下载', color: '#722ED1' },
      { field: 'installSuccess', name: '安装成功', color: '#52C41A' },
      { field: 'installFail', name: '安装失败', color: '#F5222D' },
    ],
    palette,
    axis: { xLabel: shortDate },
  }), [stats, palette]);

  const platformData = useMemo(() => (stats?.platforms ?? []).map((p) => ({
    name: APP_PLATFORM_LABELS[p.platform],
    value: p.count,
  })), [stats]);
  const platformSpec = useMemo(() => makePieSpec({
    data: platformData,
    categoryField: 'name',
    valueField: 'value',
    donut: true,
    palette,
    label: 'percent',
    valueUnit: '次',
  }), [platformData, palette]);

  const versionSpec = useMemo(() => makeBarSpec({
    data: stats?.versions ?? [],
    xField: 'version',
    series: [{ field: 'devices', name: '设备数', color: '#13C2C2' }],
    palette,
    showLabel: true,
    tooltip: { value: (v) => `${v} 台设备` },
  }), [stats, palette]);

  const statItems = [
    { key: 'checks', label: '检查次数', icon: <Activity size={19} />, color: '#4A90E2', value: stats?.totals.checks },
    { key: 'downloads', label: '下载次数', icon: <Download size={19} />, color: '#722ED1', value: stats?.totals.downloads },
    { key: 'devices', label: '活跃设备', icon: <MonitorSmartphone size={19} />, color: '#13C2C2', value: stats?.totals.devices },
    { key: 'installSuccess', label: '安装成功', icon: <CheckCircle2 size={19} />, color: '#52C41A', value: stats?.totals.installSuccess },
    { key: 'installFail', label: '安装失败', icon: <XCircle size={19} />, color: '#F5222D', value: stats?.totals.installFail },
  ];

  const chartSkeleton = (
    <Skeleton
      active
      loading
      placeholder={<Skeleton.Image style={{ height: 240, width: '100%' }} />}
      style={{ width: '100%' }}
    />
  );

  return (
    <>
      <Space style={{ marginBottom: 12 }} spacing={8} wrap>
        <Select
          prefix="应用"
          placeholder="选择应用"
          value={appId}
          onChange={(v) => setSelectedAppId(v as number)}
          optionList={apps.map((a) => ({ value: a.id, label: a.name }))}
          style={{ width: 200 }}
        />
        <Select value={days} onChange={(v) => setDays(v as number)} optionList={DAYS_OPTIONS} style={{ width: 120 }} />
        <RefreshButton onClick={() => void statsQuery.refetch()} loading={loading} />
      </Space>

      {appId === undefined ? (
        <Empty description="暂无应用，请先在「版本管理」中创建应用" style={{ marginTop: 60 }} />
      ) : (
        <>
          <StatGrid minItemWidth={170}>
            {statItems.map((item) => (
              <StatCard
                key={item.key}
                title={item.label}
                value={item.value ?? EMPTY_PLACEHOLDER}
                icon={item.icon}
                accent={item.color}
              />
            ))}
          </StatGrid>

          <div className="chart-grid" style={{ marginTop: 12 }}>
            <Card title={<Text strong style={{ fontSize: 14 }}>升级事件趋势</Text>} bodyStyle={{ padding: '12px 16px 8px' }}>
              {loading ? chartSkeleton : (
                <LineChart {...trendSpec} options={chartOptions} height={240} />
              )}
            </Card>
            <Card title={<Text strong style={{ fontSize: 14 }}>平台分布（按检查请求）</Text>} bodyStyle={{ padding: '12px 16px 8px' }}>
              {loading ? chartSkeleton : platformData.length === 0 ? (
                <Empty description="暂无检查数据" style={{ padding: '48px 0' }} />
              ) : (
                <PieChart {...platformSpec} options={chartOptions} height={240} />
              )}
            </Card>
          </div>

          <div className="chart-grid" style={{ marginTop: 12 }}>
            <Card title={<Text strong style={{ fontSize: 14 }}>在网版本分布（按活跃设备）</Text>} bodyStyle={{ padding: '12px 16px 8px' }}>
              {loading ? chartSkeleton : (stats?.versions.length ?? 0) === 0 ? (
                <Empty description="暂无设备版本数据" style={{ padding: '48px 0' }} />
              ) : (
                <BarChart {...versionSpec} options={chartOptions} height={240} />
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

// ─── 设备 Tab（统一设备中心:升级心跳与推送绑定共用的设备档案）──────────────────

const SUBJECT_TYPE_OPTIONS = [
  { value: 'user', label: '系统用户' },
  { value: 'member', label: '会员' },
];

const PUSH_BOUND_OPTIONS = [
  { value: 'true', label: '已绑定推送' },
];

interface DeviceSearchParams {
  appId?: number;
  platform?: string;
  subjectType?: string;
  pushBound?: string;
  keyword: string;
}

const defaultDeviceSearchParams: DeviceSearchParams = {
  appId: undefined, platform: undefined, subjectType: undefined, pushBound: undefined, keyword: '',
};

function DevicesTab({ active }: { active: boolean }) {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<DeviceSearchParams>({ defaults: defaultDeviceSearchParams, listKey: clientDeviceKeys.lists });

  const listQuery = useClientDeviceList({
    page,
    pageSize,
    appId: submittedParams.appId,
    platform: enumValueOf(APP_PLATFORMS, submittedParams.platform),
    subjectType: enumValueOf(DEVICE_SUBJECT_TYPES, submittedParams.subjectType),
    pushBound: enumValueOf(['true', 'false'] as const, submittedParams.pushBound),
    keyword: submittedParams.keyword || undefined,
  }, active);
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const appsQuery = useAllClientApps(active);
  const appOptions = (appsQuery.data ?? []).map((a) => ({ value: a.id, label: a.name }));

  const unbindMutation = useUnbindDevicePush();
  const deleteMutation = useDeleteClientDevice();
  const canUpdate = hasPermission('system:app-release:update');

  const columns: ColumnProps<ClientDevice>[] = [
    { title: '设备标识', dataIndex: 'deviceId', minWidth: 180, render: renderEllipsis },
    { title: '应用', dataIndex: 'appName', width: 130, render: renderEllipsis },
    {
      title: '平台', dataIndex: 'platform', width: 100,
      render: (v: AppPlatform, record: ClientDevice) => (
        <>{APP_PLATFORM_LABELS[v]}{record.arch ? ` / ${APP_ARCH_LABELS[record.arch]}` : ''}</>
      ),
    },
    { title: '设备型号', dataIndex: 'deviceModel', width: 140, render: renderEllipsis },
    {
      title: '客户端版本', dataIndex: 'appVersion', width: 110,
      render: (v: string | null) => v ?? EMPTY_PLACEHOLDER,
    },
    {
      title: '绑定人', dataIndex: 'subjectName', width: 130,
      render: (_: unknown, record: ClientDevice) => (record.subjectType
        ? <Tag color={record.subjectType === 'user' ? 'blue' : 'cyan'} size="small">
            {record.subjectName ?? `${record.subjectType}#${record.subjectId}`}
          </Tag>
        : <Text type="tertiary">匿名</Text>),
    },
    {
      title: '推送', dataIndex: 'pushRegistrationId', width: 90,
      render: (v: string | null, record: ClientDevice) => (v
        ? <Tag color={record.pushEnabled ? 'green' : 'grey'} size="small">{record.pushEnabled ? '已绑定' : '已关闭'}</Tag>
        : EMPTY_PLACEHOLDER),
    },
    dateTimeColumn('最近活跃', 'lastActiveAt'),
    createdAtColumn,
    createOperationColumn<ClientDevice>({
      width: 180,
      actions: (record) => [
        ...(canUpdate && (record.pushRegistrationId || record.subjectType) ? [{
          key: 'unbind', label: '解绑推送',
          onClick: () => {
            Modal.confirm({
              title: `确认解绑设备「${record.deviceId}」的推送？`,
              content: '解绑后该设备不再接收 App 推送,设备档案保留',
              onOk: async () => {
                await unbindMutation.mutateAsync({ params: { id: record.id } });
                Toast.success('已解绑');
              },
            });
          },
        }] : []),
        ...(hasPermission('system:app-release:delete') ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            confirmDelete({
              title: `确定要删除设备「${record.deviceId}」的档案吗？`,
              content: '删除后该设备的活跃与版本信息将从统计中消失,下次心跳会重新登记',
              onOk: async () => {
                await deleteMutation.mutateAsync({ params: { id: record.id } });
                Toast.success('删除成功');
              },
            });
          },
        }] : []),
      ],
    }),
  ];

  const renderAppFilter = () => (
    <FilterSelect
      placeholder="全部应用"
      items={appOptions}
      value={draftParams.appId}
      onChange={(v) => setDraftParams((p) => ({ ...p, appId: v as number | undefined }))}
      width={160}
    />
  );

  const renderPlatformFilter = () => (
    <FilterSelect
      placeholder="全部平台"
      items={APP_PLATFORM_OPTIONS}
      value={draftParams.platform}
      onChange={(v) => setDraftParams((p) => ({ ...p, platform: v }))}
    />
  );

  const renderSubjectFilter = () => (
    <FilterSelect
      placeholder="全部绑定人类型"
      items={SUBJECT_TYPE_OPTIONS}
      value={draftParams.subjectType}
      onChange={(v) => setDraftParams((p) => ({ ...p, subjectType: v }))}
      width={140}
    />
  );

  const renderPushBoundFilter = () => (
    <FilterSelect
      placeholder="全部推送绑定"
      width={130}
      items={PUSH_BOUND_OPTIONS}
      value={draftParams.pushBound}
      onChange={(v) => setDraftParams((p) => ({ ...p, pushBound: v }))}
    />
  );

  const renderKeywordSearch = () => (
    <KeywordInput
      placeholder="搜索设备标识 / 型号 / 版本..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      onSearch={handleSearch}
    />
  );

  return (
    <>
      <SearchToolbar
        primary={<>
          {renderAppFilter()}
          {renderKeywordSearch()}
          <SearchButton onClick={handleSearch} />
          <ResetButton onClick={handleReset} />
        </>}
        filters={<>
          {renderPlatformFilter()}
          {renderSubjectFilter()}
          {renderPushBoundFilter()}
        </>}
        mobilePrimary={<>
          {renderKeywordSearch()}
          <SearchButton onClick={handleSearch} />
        </>}
        mobileFilters={<>
          {renderAppFilter()}
          {renderPlatformFilter()}
          {renderSubjectFilter()}
          {renderPushBoundFilter()}
        </>}
        filterTitle="筛选条件"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无设备,客户端检查更新或绑定推送后自动登记"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
      />
    </>
  );
}

// ─── 页面入口 ─────────────────────────────────────────────────────────────────

export default function AppReleasesPage() {
  const [activeTab, setActiveTab] = useUrlTabState(['manage', 'stats', 'devices'] as const, 'manage');

  return (
    <div className="page-container page-tabs-page zx-flat-panels">
      <Tabs
        collapsible="auto"
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as typeof activeTab)}
        type="line"
        lazyRender
        keepDOM={false}
      >
        <TabPane tab="版本管理" itemKey="manage">
          <ReleaseManageTab active={activeTab === 'manage'} />
        </TabPane>
        <TabPane tab="统计分析" itemKey="stats">
          <ReleaseStatsTab active={activeTab === 'stats'} />
        </TabPane>
        <TabPane tab="设备" itemKey="devices">
          <DevicesTab active={activeTab === 'devices'} />
        </TabPane>
      </Tabs>
    </div>
  );
}
