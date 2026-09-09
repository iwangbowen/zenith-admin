import { useState } from 'react';
import ModalFooter from '@/components/ModalFooter';
import { useNavigate } from 'react-router-dom';
import { Button, Tag, TagGroup, Modal, Form, Toast, Typography, Checkbox, Spin, Banner, Row, Col, SideSheet, TextArea } from '@douyinfe/semi-ui';
import { enumValueOf } from '@zenith/shared/core';
import { OAUTH2_GRANT_TYPE_LABELS, OAUTH2_GRANT_TYPES, OAUTH2_SCOPES, OPEN_APP_ENVIRONMENT_LABELS, OPEN_APP_ENVIRONMENTS, OPEN_APP_REVIEW_STATUS_LABELS, OPEN_APP_REVIEW_STATUSES } from '@zenith/shared/open-platform';
import type { OAuth2Client, OAuth2GrantType } from '@zenith/shared/open-platform';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { copyableNoColumn, createdAtColumn } from '@/utils/table-columns';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import {
  oauth2AppKeys,
  useDeleteOAuth2App,
  useOAuth2ApiScopes,
  useOAuth2AppDetail,
  useOAuth2AppList,
  useOAuth2RatePlans,
  useRegenerateOAuth2AppSecret,
  useReviewOAuth2App,
  useSaveOAuth2App,
  type SaveOAuth2AppValues,
} from '@/hooks/queries/oauth2-apps';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDanger } from '@/utils/confirm';

const { Text, Paragraph } = Typography;

const SCOPE_LABELS: Record<string, string> = {
  openid: 'OpenID（确认身份）',
  profile: 'Profile（基本信息）',
  email: 'Email（邮箱）',
  offline_access: 'Offline Access（离线访问）',
};

type FormValues = {
  name: string;
  description?: string;
  logoUrl?: string;
  redirectUris: string[];
  allowedScopes: string[];
  grantTypes: OAuth2GrantType[];
  isPublic: boolean;
  ratePlanId?: number | null;
  signEnabled?: boolean;
  ipAllowlist: string[];
  environment: 'production' | 'sandbox';
  status?: 'enabled' | 'disabled';
};

type OAuth2ClientSaved = OAuth2Client & {
  clientSecret?: string;
};

export default function OAuth2AppsPage() {
  const navigate = useNavigate();
  const { options: statusOptions } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:oauth2-apps:manage');
  const toggleStatusMutation = useSaveOAuth2App();
  const status = useStatusToggle<OAuth2Client>({
    toggle: (record, enabled) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({
      title: '确认禁用',
      content: `禁用后「${record.name}」将无法进行 OAuth2 授权，确认禁用？`,
    }),
    disabled: !canManage,
    messages: { disabled: '已禁用' },
  });
  // ─── 状态 ──────────────────────────────────────────────────────────────
  interface SearchParams {
    keyword: string;
    environment?: 'production' | 'sandbox';
    reviewStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
  }
  const defaultSearchParams: SearchParams = { keyword: '' };
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: oauth2AppKeys.lists });

  // 一次性 Secret 展示
  const [secretModal, setSecretModal] = useState(false);
  const [oneTimeSecret, setOneTimeSecret] = useState('');
  const [oneTimeClientId, setOneTimeClientId] = useState('');
  const [previousValidUntil, setPreviousValidUntil] = useState('');

  // ─── 数据加载 ──────────────────────────────────────────────────────────
  const listQuery = useOAuth2AppList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    environment: submittedParams.environment,
    reviewStatus: submittedParams.reviewStatus,
  });
  const ratePlans = useOAuth2RatePlans().data ?? [];
  const scopeOptions = useOAuth2ApiScopes().data ?? [];
  const saveMutation = useSaveOAuth2App();
  const appModal = useEditModal<OAuth2ClientSaved, FormValues, SaveOAuth2AppValues>({
    entityName: ' OAuth2 应用',
    save: saveMutation,
    useDetail: useOAuth2AppDetail,
    defaults: {
      isPublic: false,
      signEnabled: false,
      ipAllowlist: [],
      environment: 'production',
      allowedScopes: ['openid', 'profile'],
      grantTypes: ['authorization_code', 'refresh_token'],
    },
    // 记录里的 null 描述 / Logo / 套餐在表单中视为未填；授权类型按常量目录收窄
    toValues: (app) => ({
      name: app.name,
      description: app.description ?? undefined,
      logoUrl: app.logoUrl ?? undefined,
      redirectUris: app.redirectUris,
      allowedScopes: app.allowedScopes,
      grantTypes: app.grantTypes.flatMap((type) => enumValueOf(OAUTH2_GRANT_TYPES, type) ?? []),
      isPublic: app.isPublic,
      ratePlanId: app.ratePlanId ?? undefined,
      signEnabled: app.signEnabled,
      ipAllowlist: app.ipAllowlist,
      environment: app.environment,
      status: app.status,
    }),
    beforeSave: (values) => ({ ...values, ratePlanId: values.ratePlanId ?? null, signEnabled: values.signEnabled ?? false }),
    onSaved: (saved, { isEdit }) => {
      if (!isEdit && saved.clientSecret) {
        setOneTimeClientId(String(saved.clientId));
        setOneTimeSecret(saved.clientSecret);
        setPreviousValidUntil('');
        setSecretModal(true);
      }
    },
    labelWidth: 140,
  });
  const editing = appModal.editing;
  const deleteMutation = useDeleteOAuth2App();
  const regenerateMutation = useRegenerateOAuth2AppSecret();
  const reviewMutation = useReviewOAuth2App();

  // ─── 重置 Secret ────────────────────────────────────────────────────────
  async function handleRegenerate(row: OAuth2Client) {
    const result = await regenerateMutation.mutateAsync({ params: { id: row.id } });
    if (result.clientSecret) {
      setOneTimeClientId(result.clientId);
      setOneTimeSecret(result.clientSecret);
      setPreviousValidUntil(result.previousValidUntil);
      setSecretModal(true);
    }
  }

  /**
   * 审核操作。
   *
   * 通过与驳回都是不可逆的流程动作，必须显式确认；驳回还必须写明原因——
   * 开发者只看到「已驳回」而不知道改什么，等于把审核流程卡死。
   */
  const [reviewTarget, setReviewTarget] = useState<OAuth2Client | null>(null);
  const [reviewComment, setReviewComment] = useState('');

  async function handleApprove(record: OAuth2Client) {
    await reviewMutation.mutateAsync({ params: { id: record.id }, body: { action: 'approve' } });
    Toast.success('审核已通过');
  }

  async function handleReject() {
    if (!reviewTarget) return;
    const comment = reviewComment.trim();
    if (!comment) {
      Toast.warning('请填写驳回原因');
      return;
    }
    await reviewMutation.mutateAsync({ params: { id: reviewTarget.id }, body: { action: 'reject', comment } });
    Toast.success('应用已驳回，审核意见已通知开发者');
    setReviewTarget(null);
    setReviewComment('');
  }

  const columns: ColumnProps<OAuth2Client>[] = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '应用名称',
      dataIndex: 'name',
      minWidth: 160,
      render: (v: string) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 150 }}>{v}</Text>,
    },
    copyableNoColumn('Client ID', 'clientId', { width: 260 }),
    {
      title: 'Secret 前缀',
      dataIndex: 'clientSecretPrefix',
      width: 140,
      render: (v: string | null) => v ?? <Text type="tertiary">（公开客户端）</Text>,
    },
    {
      title: '授权类型',
      dataIndex: 'grantTypes',
      width: 200,
      render: (v: string[]) => (
        <TagGroup
          maxTagCount={2}
          showPopover
          size="small"
          tagList={(v ?? []).map((t) => ({
            tagKey: t,
            children: OAUTH2_GRANT_TYPE_LABELS[t as keyof typeof OAUTH2_GRANT_TYPE_LABELS] ?? t,
            size: 'small' as const,
          }))}
        />
      ),
    },
    {
      title: '权限范围',
      dataIndex: 'allowedScopes',
      width: 220,
      render: (v: string[]) => (
        <TagGroup
          maxTagCount={2}
          showPopover
          size="small"
          tagList={(v ?? []).map((s) => ({ tagKey: s, children: s, color: 'blue' as const, size: 'small' as const }))}
        />
      ),
    },
    {
      title: '环境',
      dataIndex: 'environment',
      width: 100,
      render: (value: OAuth2Client['environment']) => (
        <Tag size="small" color={value === 'sandbox' ? 'orange' : 'blue'}>{OPEN_APP_ENVIRONMENT_LABELS[value]}</Tag>
      ),
    },
    {
      title: '审核',
      dataIndex: 'reviewStatus',
      width: 100,
      render: (value: OAuth2Client['reviewStatus']) => (
        <Tag size="small" color={value === 'approved' ? 'green' : value === 'rejected' ? 'red' : value === 'pending' ? 'orange' : 'grey'}>
          {OPEN_APP_REVIEW_STATUS_LABELS[value]}
        </Tag>
      ),
    },
    {
      title: '限流套餐',
      dataIndex: 'ratePlanId',
      width: 120,
      render: (v: number | null) => {
        const p = ratePlans.find((rp) => rp.id === v);
        return p ? <Tag color="green" size="small">{p.name}</Tag> : <Text type="tertiary">默认</Text>;
      },
    },
    {
      title: '签名通道',
      dataIndex: 'signEnabled',
      width: 100,
      render: (v: boolean) => (v ? <Tag color="orange" size="small">已开启</Tag> : <Text type="tertiary">仅 Bearer</Text>),
    },
    createdAtColumn,
    status.column(),
    createOperationColumn<OAuth2Client>({
      width: 180,
      desktopInlineKeys: ['detail', 'edit'],
      actions: (record) => [
        {
          key: 'detail',
          label: '详情',
          onClick: () => navigate(`/system/oauth2-apps/${record.id}`),
        },
        {
          key: 'edit',
          label: '编辑',
          onClick: () => appModal.openEdit(record),
        },
        {
          key: 'approve',
          label: '通过',
          hidden: !canManage || record.reviewStatus !== 'pending',
          onClick: () => {
            Modal.confirm({
              title: '通过应用审核？',
              content: `「${record.name}」通过后即可调用开放 API。`,
              onOk: () => handleApprove(record),
            });
          },
        },
        {
          key: 'reject',
          label: '驳回',
          danger: true,
          hidden: !canManage || record.reviewStatus !== 'pending',
          onClick: () => {
            setReviewComment('');
            setReviewTarget(record);
          },
        },
        {
          key: 'regenerate',
          label: '重置 Secret',
          hidden: !canManage || record.isPublic,
          onClick: () => {
            confirmDanger({
              title: '重置 client_secret？此操作不可撤销',
              onOk: () => { void handleRegenerate(record); },
            });
          },
        },
        deleteAction({
          hidden: !canManage,
          title: '确定要删除此应用吗？',
          content: '删除后不可恢复',
          run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索应用名称" {...bindKeyword('keyword')} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部环境"
              items={OPEN_APP_ENVIRONMENTS.map((value) => ({ value, label: OPEN_APP_ENVIRONMENT_LABELS[value] }))}
              {...bind('environment')}
            />
            <FilterSelect
              placeholder="全部审核状态"
              items={OPEN_APP_REVIEW_STATUSES.map((value) => ({ value, label: OPEN_APP_REVIEW_STATUS_LABELS[value] }))}
              {...bind('reviewStatus')}
              width={140}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={canManage && <CreateButton onClick={appModal.openCreate} />}
        actionTitle="应用操作"
      />

      <ConfigurableTable<OAuth2Client>
        columns={columns}
        empty="暂无数据"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      {/* 新增 / 编辑抽屉 */}
      <SideSheet
        title={appModal.modalProps.title}
        visible={appModal.visible}
        onCancel={appModal.close}
        closeOnEsc
        width={800}
        footer={<ModalFooter {...appModal.footerProps} okText="保存" />}
      >
        <Spin spinning={appModal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={appModal.formKey} {...appModal.formProps}>
            {/* 必填：应用名称（全宽） */}
            <Row gutter={16}>
              <Col span={24}>
                <Form.Input
                  field="name"
                  label="应用名称"
                  placeholder="请输入应用名称"
                  rules={[{ required: true, message: '应用名称不能为空' }]}
                />
              </Col>
            </Row>
            {/* 必填：回调 URL（全宽） */}
            <Row gutter={16}>
              <Col span={24}>
                <Form.TagInput
                  field="redirectUris"
                  label="回调 URL"
                  placeholder="输入后回车添加"
                  rules={[{ required: true, message: '至少填写一个回调 URL' }]}
                />
              </Col>
            </Row>
            {/* 必填：允许的 scope（全宽） */}
            <Row gutter={16}>
              <Col span={24}>
                <Form.CheckboxGroup
                  field="allowedScopes"
                  label="允许的 scope"
                  direction="horizontal"
                  rules={[{ required: true, message: '至少选择一个' }]}
                >
                  {(scopeOptions.length
                    ? scopeOptions.map((s) => ({ value: s.code, label: `${s.name}（${s.code}）` }))
                    : OAUTH2_SCOPES.map((s) => ({ value: s, label: SCOPE_LABELS[s] ?? s }))
                  ).map((o) => (
                    <Checkbox key={o.value} value={o.value}>{o.label}</Checkbox>
                  ))}
                </Form.CheckboxGroup>
              </Col>
            </Row>
            {/* 必填：授权类型（全宽） */}
            <Row gutter={16}>
              <Col span={24}>
                <Form.CheckboxGroup
                  field="grantTypes"
                  label="授权类型"
                  direction="horizontal"
                  rules={[{ required: true, message: '至少选择一种' }]}
                >
                  {OAUTH2_GRANT_TYPES.map((t) => (
                    <Checkbox key={t} value={t}>{OAUTH2_GRANT_TYPE_LABELS[t]}</Checkbox>
                  ))}
                </Form.CheckboxGroup>
              </Col>
            </Row>
            {/* 可选：Logo URL（全宽） */}
            <Row gutter={16}>
              <Col span={24}>
                <Form.Input
                  field="logoUrl"
                  label="Logo URL"
                  placeholder="https://example.com/logo.png"
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select
                  field="environment"
                  label="运行环境"
                  optionList={OPEN_APP_ENVIRONMENTS.map((value) => ({ value, label: OPEN_APP_ENVIRONMENT_LABELS[value] }))}
                  style={{ width: '100%' }}
                  rules={[{ required: true, message: '请选择运行环境' }]}
                />
              </Col>
            </Row>
            {/* 可选：公开客户端 + 状态（编辑时） */}
            <Row gutter={16}>
              <Col span={editing ? 12 : 24}>
                <Form.Switch
                  field="isPublic"
                  label="公开客户端"
                  extraText="不使用 client_secret，需配合 PKCE"
                />
              </Col>
              {editing && (
                <Col span={12}>
                  <Form.Select
                    field="status"
                    label="状态"
                    style={{ width: '100%' }}
                    optionList={statusOptions}
                    rules={[{ required: true, message: '请选择状态' }]}
                  />
                </Col>
              )}
            </Row>
            {/* 开放平台：限流套餐 + 签名验签 */}
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select
                  field="ratePlanId"
                  label="限流套餐"
                  placeholder="默认套餐"
                  showClear
                  style={{ width: '100%' }}
                  optionList={ratePlans.map((p) => ({
                    value: p.id,
                    label: `${p.name}（${p.qpsLimit > 0 ? `${p.qpsLimit}/s` : '不限'}）`,
                  }))}
                />
              </Col>
              <Col span={12}>
                <Form.Switch
                  field="signEnabled"
                  label="AppKey 签名通道"
                  extraText="开启后可用 AppKey + HMAC 签名调用（签名强制）；关闭则仅支持 OAuth2 Bearer 令牌"
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={24}>
                <Form.TagInput
                  field="ipAllowlist"
                  label="IP 白名单"
                  placeholder="输入 IP 或 CIDR 后回车；留空表示不限制"
                  extraText="示例：203.0.113.10、10.0.0.0/8、2001:db8::/32"
                />
              </Col>
            </Row>
            {/* 可选：应用描述（全宽，放最后） */}
            <Row gutter={16}>
              <Col span={24}>
                <Form.TextArea
                  field="description"
                  label="应用描述"
                  placeholder="请输入描述（可选）"
                  rows={2}
                />
              </Col>
            </Row>
          </Form>
        </Spin>
      </SideSheet>

      {/* 一次性 Secret 展示弹窗 */}
      <Modal
        title="请复制保存 client_secret"
        visible={secretModal}
        onCancel={() => setSecretModal(false)}
        footer={<Button type="primary" onClick={() => setSecretModal(false)}>我已复制，关闭</Button>}
        closeOnEsc={false}
        maskClosable={false}
      >
        <Banner
          type="warning"
          description="此 client_secret 仅显示一次，关闭后将无法再次查看。请立即复制并妥善保存。"
          style={{ marginBottom: 16 }}
        />
        {previousValidUntil && (
          <Banner
            type="info"
            description={`旧密钥在 ${previousValidUntil} 前仍可用于验签和换取令牌，请在此之前完成切换。`}
            style={{ marginBottom: 16 }}
          />
        )}
        <div style={{ marginBottom: 8 }}>
          <Text strong>Client ID：</Text>
        </div>
        <Paragraph copyable style={{ wordBreak: 'break-all', background: 'var(--semi-color-fill-0)', padding: 8, borderRadius: 'var(--semi-border-radius-small)' }}>
          {oneTimeClientId}
        </Paragraph>
        <div style={{ marginTop: 12, marginBottom: 8 }}>
          <Text strong>Client Secret：</Text>
        </div>
        <Paragraph copyable style={{ wordBreak: 'break-all', background: 'var(--semi-color-fill-0)', padding: 8, borderRadius: 'var(--semi-border-radius-small)' }}>
          {oneTimeSecret}
        </Paragraph>
      </Modal>

      {/* 驳回审核：必须填写原因，内容会通知到开发者 */}
      <Modal
        title="驳回应用审核"
        visible={!!reviewTarget}
        onCancel={() => { setReviewTarget(null); setReviewComment(''); }}
        onOk={() => void handleReject()}
        okText="确认驳回"
        okButtonProps={{ type: 'danger', loading: reviewMutation.isPending }}
      >
        <Banner
          type="info"
          description={`「${reviewTarget?.name ?? ''}」将被驳回，审核意见会通知到应用负责人。`}
          style={{ marginBottom: 16 }}
        />
        <div style={{ marginBottom: 8 }}>
          <Text strong>驳回原因</Text>
          <Text type="danger"> *</Text>
        </div>
        <TextArea
          value={reviewComment}
          onChange={setReviewComment}
          placeholder="说明需要开发者修改的内容，例如：回调地址必须使用 HTTPS，且申请的 scope 超出实际业务范围"
          maxCount={500}
          rows={4}
          autoFocus
        />
      </Modal>
    </div>
  );
}
