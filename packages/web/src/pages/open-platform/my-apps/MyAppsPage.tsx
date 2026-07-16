import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banner,
  Button,
  Checkbox,
  Col,
  Form,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  SideSheet,
  Space,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Activity, Plus, RotateCcw, Search } from 'lucide-react';
import {
  OAUTH2_GRANT_TYPE_LABELS,
  OAUTH2_GRANT_TYPES,
  OPEN_APP_ENVIRONMENT_LABELS,
  OPEN_APP_ENVIRONMENTS,
  OPEN_APP_REVIEW_STATUS_LABELS,
  OPEN_APP_REVIEW_STATUSES,
} from '@zenith/shared';
import type { OAuth2Client } from '@zenith/shared';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { useOAuth2ApiScopes } from '@/hooks/queries/oauth2-apps';
import {
  developerAppKeys,
  useDeleteMyApp,
  useMyAppDetail,
  useMyAppList,
  useMyAppQuota,
  useRotateMyAppSecret,
  useSaveMyApp,
  useSubmitMyApp,
} from '@/hooks/queries/developer-apps';
import { useQueryClient } from '@tanstack/react-query';

const { Paragraph, Text } = Typography;

interface FormValues {
  name: string;
  description?: string;
  logoUrl?: string;
  redirectUris: string[];
  allowedScopes: string[];
  grantTypes: Array<'authorization_code' | 'client_credentials' | 'refresh_token'>;
  isPublic: boolean;
  signEnabled: boolean;
  ipAllowlist: string[];
  environment: OAuth2Client['environment'];
}

function UsageLine({ label, used, limit, percentage }: Readonly<{
  label: string;
  used: number;
  limit: number;
  percentage: number;
}>) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text strong>{label}</Text>
        <Text type="tertiary">{limit > 0 ? `${used.toLocaleString()} / ${limit.toLocaleString()}` : '不限'}</Text>
      </div>
      <Progress
        percent={limit > 0 ? percentage : 0}
        showInfo
        stroke={percentage >= 95 ? 'var(--semi-color-danger)' : percentage >= 80 ? 'var(--semi-color-warning)' : 'var(--semi-color-primary)'}
      />
    </div>
  );
}

export default function MyAppsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  type SearchParams = {
    keyword: string;
    environment?: OAuth2Client['environment'];
    reviewStatus?: OAuth2Client['reviewStatus'];
  };
  const defaults: SearchParams = { keyword: '' };
  const [draft, setDraft] = useState<SearchParams>(defaults);
  const [submitted, setSubmitted] = useState<SearchParams>(defaults);
  const [editing, setEditing] = useState<OAuth2Client | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [secret, setSecret] = useState<{ clientId: string; value: string; previousValidUntil?: string } | null>(null);
  const [usageApp, setUsageApp] = useState<OAuth2Client | null>(null);

  const listQuery = useMyAppList({
    page,
    pageSize,
    keyword: submitted.keyword || undefined,
    environment: submitted.environment,
    reviewStatus: submitted.reviewStatus,
  });
  const detailQuery = useMyAppDetail(editing?.id, modalVisible && Boolean(editing));
  const scopes = useOAuth2ApiScopes().data ?? [];
  const quotaQuery = useMyAppQuota(usageApp?.id, Boolean(usageApp));
  const saveMutation = useSaveMyApp();
  const deleteMutation = useDeleteMyApp();
  const submitMutation = useSubmitMyApp();
  const rotateMutation = useRotateMyAppSecret();
  const data = listQuery.data;
  const editingDetail = detailQuery.data ?? editing;

  const search = () => {
    setPage(1);
    setSubmitted(draft);
    void queryClient.invalidateQueries({ queryKey: developerAppKeys.lists });
  };
  const reset = () => {
    setDraft(defaults);
    setSubmitted(defaults);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: developerAppKeys.lists });
  };
  const openCreate = () => {
    setEditing(null);
    setModalVisible(true);
  };
  const openEdit = (app: OAuth2Client) => {
    setEditing(app);
    setModalVisible(true);
  };
  const closeModal = () => {
    setModalVisible(false);
    setEditing(null);
  };

  const initialValues: Partial<FormValues> = editingDetail ? {
    name: editingDetail.name,
    description: editingDetail.description ?? '',
    logoUrl: editingDetail.logoUrl ?? '',
    redirectUris: editingDetail.redirectUris,
    allowedScopes: editingDetail.allowedScopes,
    grantTypes: editingDetail.grantTypes as FormValues['grantTypes'],
    isPublic: editingDetail.isPublic,
    signEnabled: editingDetail.signEnabled ?? false,
    ipAllowlist: editingDetail.ipAllowlist,
    environment: editingDetail.environment,
  } : {
    redirectUris: [],
    allowedScopes: ['openid', 'profile'],
    grantTypes: ['authorization_code', 'refresh_token'],
    isPublic: false,
    signEnabled: true,
    ipAllowlist: [],
    environment: 'sandbox',
  };

  const save = async () => {
    const values = await formApi.current?.validate() as FormValues;
    const result = await saveMutation.mutateAsync({
      id: editing?.id,
      values: { ...values },
    });
    closeModal();
    if ('clientSecret' in result && typeof result.clientSecret === 'string' && result.clientSecret) {
      setSecret({ clientId: result.clientId, value: result.clientSecret });
    } else {
      Toast.success('应用已更新并回到草稿状态');
    }
  };

  const rotateSecret = async (app: OAuth2Client) => {
    const result = await rotateMutation.mutateAsync(app.id);
    setSecret({
      clientId: result.clientId,
      value: result.clientSecret,
      previousValidUntil: result.previousValidUntil,
    });
  };

  const columns: ColumnProps<OAuth2Client>[] = [
    { title: '应用名称', dataIndex: 'name', width: 180 },
    { title: 'Client ID', dataIndex: 'clientId', width: 270, render: (value: string) => <Text copyable={{ content: value }}>{value}</Text> },
    {
      title: '环境',
      dataIndex: 'environment',
      width: 100,
      render: (value: OAuth2Client['environment']) => <Tag size="small" color={value === 'sandbox' ? 'orange' : 'blue'}>{OPEN_APP_ENVIRONMENT_LABELS[value]}</Tag>,
    },
    {
      title: '审核状态',
      dataIndex: 'reviewStatus',
      width: 110,
      render: (value: OAuth2Client['reviewStatus']) => (
        <Tag size="small" color={value === 'approved' ? 'green' : value === 'rejected' ? 'red' : value === 'pending' ? 'orange' : 'grey'}>
          {OPEN_APP_REVIEW_STATUS_LABELS[value]}
        </Tag>
      ),
    },
    { title: 'Scope', dataIndex: 'allowedScopes', width: 280, render: (values: string[]) => <Space wrap>{values.map((value) => <Tag key={value} size="small">{value}</Tag>)}</Space> },
    { title: '创建时间', dataIndex: 'createdAt', width: 170 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: string) => <Tag size="small" color={value === 'enabled' ? 'green' : 'grey'}>{value === 'enabled' ? '启用' : '禁用'}</Tag>,
    },
    createOperationColumn<OAuth2Client>({
      width: 220,
      desktopInlineKeys: ['edit', 'usage', 'submit'],
      actions: (app) => [
        { key: 'edit', label: '编辑', hidden: app.reviewStatus === 'pending', onClick: () => openEdit(app) },
        { key: 'usage', label: '用量', onClick: () => setUsageApp(app) },
        {
          key: 'submit',
          label: '提交审核',
          hidden: !['draft', 'rejected'].includes(app.reviewStatus),
          onClick: () => {
            Modal.confirm({
              title: '提交应用审核？',
              content: '审核期间将暂时无法修改应用配置。',
              onOk: async () => {
                await submitMutation.mutateAsync(app.id);
                Toast.success('已提交审核');
              },
            });
          },
        },
        { key: 'debug', label: '在线调试', onClick: () => navigate(`/open-platform/debug?appId=${app.id}`) },
        {
          key: 'rotate',
          label: '轮换密钥',
          hidden: app.isPublic,
          onClick: () => {
            Modal.confirm({
              title: '轮换应用密钥？',
              content: '旧密钥将在宽限期内继续有效，已颁发令牌会被撤销。',
              onOk: () => rotateSecret(app),
            });
          },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: app.reviewStatus === 'pending',
          onClick: () => {
            Modal.confirm({
              title: '确认删除应用？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: async () => {
                await deleteMutation.mutateAsync(app.id);
                Toast.success('应用已删除');
              },
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索我的应用" value={draft.keyword} onChange={(keyword) => setDraft({ ...draft, keyword })} onEnterPress={search} showClear style={{ width: 210 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={search}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={reset}>重置</Button>
            <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>创建应用</Button>
          </>
        )}
        filters={(
          <>
            <Select placeholder="环境" value={draft.environment} onChange={(environment) => setDraft({ ...draft, environment: environment as OAuth2Client['environment'] })} optionList={OPEN_APP_ENVIRONMENTS.map((value) => ({ value, label: OPEN_APP_ENVIRONMENT_LABELS[value] }))} showClear style={{ width: 120 }} />
            <Select placeholder="审核状态" value={draft.reviewStatus} onChange={(reviewStatus) => setDraft({ ...draft, reviewStatus: reviewStatus as OAuth2Client['reviewStatus'] })} optionList={OPEN_APP_REVIEW_STATUSES.map((value) => ({ value, label: OPEN_APP_REVIEW_STATUS_LABELS[value] }))} showClear style={{ width: 130 }} />
          </>
        )}
        mobilePrimary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索我的应用" value={draft.keyword} onChange={(keyword) => setDraft({ ...draft, keyword })} onEnterPress={search} showClear style={{ width: 190 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={search}>查询</Button>
            <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>创建</Button>
          </>
        )}
        mobileFilters={(
          <>
            <Select placeholder="环境" value={draft.environment} onChange={(environment) => setDraft({ ...draft, environment: environment as OAuth2Client['environment'] })} optionList={OPEN_APP_ENVIRONMENTS.map((value) => ({ value, label: OPEN_APP_ENVIRONMENT_LABELS[value] }))} showClear style={{ width: '100%' }} />
            <Select placeholder="审核状态" value={draft.reviewStatus} onChange={(reviewStatus) => setDraft({ ...draft, reviewStatus: reviewStatus as OAuth2Client['reviewStatus'] })} optionList={OPEN_APP_REVIEW_STATUSES.map((value) => ({ value, label: OPEN_APP_REVIEW_STATUS_LABELS[value] }))} showClear style={{ width: '100%' }} />
          </>
        )}
        mobileActions={<Button theme="borderless" onClick={reset}>重置筛选</Button>}
        actionTitle="应用操作"
      />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="id"
        empty="还没有应用，创建一个沙箱应用开始接入"
        pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal title={editing ? '编辑我的应用' : '创建应用'} visible={modalVisible} onCancel={closeModal} onOk={save} width={700} closeOnEsc okButtonProps={{ loading: saveMutation.isPending }}>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={initialValues} labelPosition="left" labelWidth={110} allowEmpty>
          <Row gutter={16}>
            <Col span={12}><Form.Input field="name" label="应用名称" rules={[{ required: true, message: '请输入应用名称' }]} /></Col>
            <Col span={12}><Form.Select field="environment" label="环境" optionList={OPEN_APP_ENVIRONMENTS.map((value) => ({ value, label: OPEN_APP_ENVIRONMENT_LABELS[value] }))} rules={[{ required: true, message: '请选择环境' }]} style={{ width: '100%' }} /></Col>
          </Row>
          <Form.TagInput field="redirectUris" label="回调 URL" placeholder="授权码模式必填，输入后回车" />
          <Form.CheckboxGroup field="allowedScopes" label="允许 Scope" direction="horizontal" rules={[{ required: true, message: '请选择 Scope' }]}>
            {scopes.map((scope) => <Checkbox key={scope.code} value={scope.code}>{scope.name}</Checkbox>)}
          </Form.CheckboxGroup>
          <Form.CheckboxGroup field="grantTypes" label="授权类型" direction="horizontal" rules={[{ required: true, message: '请选择授权类型' }]}>
            {OAUTH2_GRANT_TYPES.map((value) => <Checkbox key={value} value={value}>{OAUTH2_GRANT_TYPE_LABELS[value]}</Checkbox>)}
          </Form.CheckboxGroup>
          <Row gutter={16}>
            <Col span={12}><Form.Switch field="isPublic" label="公开客户端" extraText="公开客户端必须使用 PKCE S256" /></Col>
            <Col span={12}><Form.Switch field="signEnabled" label="HMAC 签名" extraText="开放 API 请求验签" /></Col>
          </Row>
          <Form.Input field="logoUrl" label="Logo URL" />
          <Form.TagInput field="ipAllowlist" label="IP 白名单" placeholder="IP 或 CIDR，留空不限制" />
          <Form.TextArea field="description" label="应用描述" rows={3} />
        </Form>
      </AppModal>

      <Modal title="请立即保存应用密钥" visible={Boolean(secret)} onCancel={() => setSecret(null)} closeOnEsc={false} maskClosable={false} footer={<Button type="primary" onClick={() => setSecret(null)}>我已保存</Button>}>
        <Banner type="warning" description="密钥仅显示一次。请存入服务端密钥管理系统，不要写入前端代码或代码仓库。" style={{ marginBottom: 16 }} />
        {secret?.previousValidUntil && <Banner type="info" description={`旧密钥有效至 ${secret.previousValidUntil}，请在宽限期内完成切换。`} style={{ marginBottom: 16 }} />}
        <Text strong>Client ID</Text>
        <Paragraph copyable style={{ wordBreak: 'break-all', padding: 8, background: 'var(--semi-color-fill-0)' }}>{secret?.clientId}</Paragraph>
        <Text strong>Client Secret</Text>
        <Paragraph copyable style={{ wordBreak: 'break-all', padding: 8, background: 'var(--semi-color-fill-0)' }}>{secret?.value}</Paragraph>
      </Modal>

      <SideSheet title={`实时配额用量 - ${usageApp?.name ?? ''}`} visible={Boolean(usageApp)} onCancel={() => setUsageApp(null)} width={520}>
        {quotaQuery.data?.environment === 'sandbox' && <Banner type="info" description="沙箱应用不消耗生产配额。" style={{ marginBottom: 20 }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Activity size={16} />
          <Text>{quotaQuery.data?.planName ?? '默认套餐'} · 每 10 秒自动刷新</Text>
        </div>
        <UsageLine label="当前 QPS" {...(quotaQuery.data?.qps ?? { used: 0, limit: 0, percentage: 0 })} />
        <UsageLine label="今日调用" {...(quotaQuery.data?.daily ?? { used: 0, limit: 0, percentage: 0 })} />
        <UsageLine label="本月调用" {...(quotaQuery.data?.monthly ?? { used: 0, limit: 0, percentage: 0 })} />
      </SideSheet>
    </div>
  );
}
