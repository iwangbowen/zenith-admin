import { useState } from 'react';
import ModalFooter from '@/components/ModalFooter';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Checkbox, Col, Form, Modal, Row, SideSheet, Spin, Tag, TagGroup, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Activity } from 'lucide-react';
import { enumValueOf } from '@zenith/shared/core';
import { OAUTH2_GRANT_TYPE_LABELS, OAUTH2_GRANT_TYPES, OPEN_APP_ENVIRONMENT_LABELS, OPEN_APP_ENVIRONMENTS, OPEN_APP_REVIEW_STATUS_LABELS, OPEN_APP_REVIEW_STATUSES } from '@zenith/shared/open-platform';
import type { OAuth2Client, OAuth2GrantType } from '@zenith/shared/open-platform';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
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
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { useEditModal } from '@/hooks/useEditModal';
import { MetricMeter, type MetricMeterTone } from '@/components/data-viz/MetricMeter';
import { copyableNoColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';

const { Paragraph, Text } = Typography;

interface FormValues {
  name: string;
  description?: string;
  logoUrl?: string;
  redirectUris: string[];
  allowedScopes: string[];
  grantTypes: OAuth2GrantType[];
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
  const tone: MetricMeterTone = percentage >= 95 ? 'danger' : percentage >= 80 ? 'warning' : 'primary';
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text strong>{label}</Text>
        <Text type="tertiary">{limit > 0 ? `${used.toLocaleString()} / ${limit.toLocaleString()} · ${Math.round(percentage)}%` : '不限'}</Text>
      </div>
      {limit > 0 && (
        <MetricMeter
          value={percentage}
          label={`${label}用量`}
          valueText={`${used} / ${limit}，${Math.round(percentage)}%`}
          tone={tone}
        />
      )}
    </div>
  );
}

export default function MyAppsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  type SearchParams = {
    keyword: string;
    environment?: OAuth2Client['environment'];
    reviewStatus?: OAuth2Client['reviewStatus'];
  };
  const defaults: SearchParams = { keyword: '' };
  const [draft, setDraft] = useState<SearchParams>(defaults);
  const [submitted, setSubmitted] = useState<SearchParams>(defaults);
  const [secret, setSecret] = useState<{ clientId: string; value: string; previousValidUntil?: string } | null>(null);
  const [usageApp, setUsageApp] = useState<OAuth2Client | null>(null);

  const listQuery = useMyAppList({
    page,
    pageSize,
    keyword: submitted.keyword || undefined,
    environment: submitted.environment,
    reviewStatus: submitted.reviewStatus,
  });
  const scopes = useOAuth2ApiScopes().data ?? [];
  const quotaQuery = useMyAppQuota(usageApp?.id, Boolean(usageApp));
  const saveMutation = useSaveMyApp();
  const deleteMutation = useDeleteMyApp();
  const submitMutation = useSubmitMyApp();
  const rotateMutation = useRotateMyAppSecret();
  const modal = useEditModal<OAuth2Client, FormValues>({
    save: saveMutation,
    useDetail: useMyAppDetail,
    defaults: {
      redirectUris: [],
      allowedScopes: ['openid', 'profile'],
      grantTypes: ['authorization_code', 'refresh_token'],
      isPublic: false,
      signEnabled: true,
      ipAllowlist: [],
      environment: 'sandbox',
    },
    // 记录里的 null 描述 / Logo 在表单中视为未填；授权类型按常量目录收窄
    toValues: (record) => ({
      name: record.name,
      description: record.description ?? undefined,
      logoUrl: record.logoUrl ?? undefined,
      redirectUris: record.redirectUris,
      allowedScopes: record.allowedScopes,
      grantTypes: record.grantTypes.flatMap((type) => enumValueOf(OAUTH2_GRANT_TYPES, type) ?? []),
      isPublic: record.isPublic,
      signEnabled: record.signEnabled,
      ipAllowlist: record.ipAllowlist,
      environment: record.environment,
    }),
    onSaved: (result) => {
      if ('clientSecret' in result && typeof result.clientSecret === 'string' && result.clientSecret) {
        setSecret({ clientId: result.clientId, value: result.clientSecret });
      }
    },
    successMessage: ({ isEdit }) => (isEdit ? '应用已更新并回到草稿状态' : '创建成功'),
    labelWidth: 140,
  });

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
  const rotateSecret = async (app: OAuth2Client) => {
    const result = await rotateMutation.mutateAsync({ params: { id: app.id } });
    setSecret({
      clientId: result.clientId,
      value: result.clientSecret,
      previousValidUntil: result.previousValidUntil,
    });
  };

  const columns: ColumnProps<OAuth2Client>[] = [
    { title: '应用名称', dataIndex: 'name', minWidth: 240, render: renderEllipsis },
    copyableNoColumn('Client ID', 'clientId', { width: 270 }),
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
    { title: 'Scope', dataIndex: 'allowedScopes', width: 240, render: (values: string[]) => <TagGroup maxTagCount={2} showPopover size="small" tagList={(values ?? []).map((value) => ({ tagKey: value, children: value, size: 'small' as const }))} /> },
    dateTimeColumn('创建时间', 'createdAt'),
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: string) => <Tag size="small" color={value === 'enabled' ? 'green' : 'grey'}>{value === 'enabled' ? '启用' : '禁用'}</Tag>,
    },
    createOperationColumn<OAuth2Client>({
      // 提交审核 / 在线调试 / 轮换密钥 / 删除 随审核状态出现，进更多；行内保留编辑 / 用量
      width: 180,
      desktopInlineKeys: ['edit', 'usage'],
      actions: (app) => [
        { key: 'edit', label: '编辑', hidden: app.reviewStatus === 'pending', onClick: () => modal.openEdit(app) },
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
                await submitMutation.mutateAsync({ params: { id: app.id } });
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
        deleteAction({
          hidden: app.reviewStatus === 'pending',
          title: '确认删除应用？',
          run: () => deleteMutation.mutateAsync({ params: { id: app.id } }),
          successMessage: '应用已删除',
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索我的应用" value={draft.keyword} onChange={(keyword) => setDraft({ ...draft, keyword })} onSearch={search} width={210} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部环境"
              items={OPEN_APP_ENVIRONMENTS.map((value) => ({ value, label: OPEN_APP_ENVIRONMENT_LABELS[value] }))}
              value={draft.environment}
              onChange={(environment) => setDraft({ ...draft, environment: environment as OAuth2Client['environment'] })}
            />
            <FilterSelect
              placeholder="全部审核状态"
              items={OPEN_APP_REVIEW_STATUSES.map((value) => ({ value, label: OPEN_APP_REVIEW_STATUS_LABELS[value] }))}
              value={draft.reviewStatus}
              onChange={(reviewStatus) => setDraft({ ...draft, reviewStatus: reviewStatus as OAuth2Client['reviewStatus'] })}
              width={140}
            />
          </>
        )}
        onSearch={search}
        onReset={reset}
        create={<CreateButton onClick={modal.openCreate}>创建应用</CreateButton>}
        actionTitle="应用操作"
      />
      <ConfigurableTable<OAuth2Client>
        columns={columns}
        {...listTableProps(listQuery, {
          empty: '还没有应用，创建一个沙箱应用开始接入',
          pagination: buildPagination,
        })}
      />

      <SideSheet
        title={modal.isEdit ? '编辑我的应用' : '创建应用'}
        visible={modal.visible}
        onCancel={modal.close}
        closeOnEsc
        width={800}
        footer={<ModalFooter {...modal.footerProps} okText="保存" />}
      >
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
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
              <Col span={12}><Form.Switch field="signEnabled" label="AppKey 签名通道" extraText="开启后可用 AppKey + HMAC 签名调用；关闭则仅支持 OAuth2 Bearer" /></Col>
            </Row>
            <Form.Input field="logoUrl" label="Logo URL" />
            <Form.TagInput field="ipAllowlist" label="IP 白名单" placeholder="IP 或 CIDR，留空不限制" />
            <Form.TextArea field="description" label="应用描述" rows={3} />
          </Form>
        </Spin>
      </SideSheet>

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
