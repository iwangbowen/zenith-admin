import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Input,
  Tag,
  Space,
  Modal,
  Form,
  Toast,
  Typography,
  Checkbox,
  Spin,
  Banner,
  Row,
  Col,
  Switch,
  Select,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, RotateCcw, Search } from 'lucide-react';
import {
  OAUTH2_GRANT_TYPE_LABELS,
  OAUTH2_GRANT_TYPES,
  OAUTH2_SCOPES,
  OPEN_APP_ENVIRONMENT_LABELS,
  OPEN_APP_ENVIRONMENTS,
  OPEN_APP_REVIEW_STATUS_LABELS,
  OPEN_APP_REVIEW_STATUSES,
} from '@zenith/shared';
import type { OAuth2Client } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { createdAtColumn } from '@/utils/table-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
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
} from '@/hooks/queries/oauth2-apps';
import { useDictItems } from '@/hooks/useDictItems';

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
  grantTypes: string[];
  isPublic: boolean;
  ratePlanId?: number | null;
  signEnabled?: boolean;
  ipAllowlist: string[];
  environment: 'production' | 'sandbox';
  status?: 'enabled' | 'disabled';
};

export default function OAuth2AppsPage() {
  const navigate = useNavigate();
  const { items: statusItems } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canManage = hasPermission('system:oauth2-apps:manage');
  const toggleStatusMutation = useSaveOAuth2App();

  const handleToggleStatus = (record: OAuth2Client, checked: boolean) => {
    const newStatus = checked ? 'enabled' : 'disabled';
    const doToggle = async () => {
      await toggleStatusMutation.mutateAsync({ id: record.id, values: { status: newStatus } });
      Toast.success(checked ? '已启用' : '已禁用');
    };
    if (checked) {
      void doToggle();
    } else {
      Modal.confirm({
        title: '确认禁用',
        content: `禁用后「${record.name}」将无法进行 OAuth2 授权，确认禁用？`,
        onOk: () => void doToggle(),
      });
    }
  };
  const formApi = useRef<FormApi | null>(null);

  // ─── 状态 ──────────────────────────────────────────────────────────────
  interface SearchParams {
    keyword: string;
    environment?: 'production' | 'sandbox';
    reviewStatus?: 'draft' | 'pending' | 'approved' | 'rejected';
  }
  const defaultSearchParams: SearchParams = { keyword: '' };
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  // 弹窗状态
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<OAuth2Client | null>(null);

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
  const data = listQuery.data ?? null;
  const ratePlans = useOAuth2RatePlans().data ?? [];
  const scopeOptions = useOAuth2ApiScopes().data ?? [];
  const detailQuery = useOAuth2AppDetail(editing?.id, modalVisible);
  const editingDetail = editing ? (detailQuery.data ?? editing) : null;
  const modalDetailLoading = !!editing && detailQuery.isFetching;
  const saveMutation = useSaveOAuth2App();
  const deleteMutation = useDeleteOAuth2App();
  const regenerateMutation = useRegenerateOAuth2AppSecret();
  const reviewMutation = useReviewOAuth2App();
  const togglingId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  useEffect(() => {
    if (!detailQuery.data) return;
    formApi.current?.setValues({
      name: detailQuery.data.name,
      description: detailQuery.data.description ?? '',
      logoUrl: detailQuery.data.logoUrl ?? '',
      redirectUris: detailQuery.data.redirectUris,
      allowedScopes: detailQuery.data.allowedScopes,
      grantTypes: detailQuery.data.grantTypes,
      isPublic: detailQuery.data.isPublic,
      ratePlanId: detailQuery.data.ratePlanId ?? undefined,
      signEnabled: detailQuery.data.signEnabled ?? false,
      ipAllowlist: detailQuery.data.ipAllowlist,
      environment: detailQuery.data.environment,
      status: detailQuery.data.status,
    });
  }, [detailQuery.data]);

  // ─── 搜索 / 重置 ────────────────────────────────────────────────────────
  function handleSearch() {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: oauth2AppKeys.lists });
  }

  function handleReset() {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: oauth2AppKeys.lists });
  }

  // ─── 新增 ──────────────────────────────────────────────────────────────
  function openCreate() {
    setEditing(null);
    setModalVisible(true);
  }

  // ─── 编辑：先弹窗再异步回填 ──────────────────────────────────────────────
  function openEdit(record: OAuth2Client) {
    setEditing(record);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditing(null);
  }

  const formInitValues: Partial<FormValues> = editingDetail
    ? {
        name: editingDetail.name,
        description: editingDetail.description ?? '',
        logoUrl: editingDetail.logoUrl ?? '',
        redirectUris: editingDetail.redirectUris,
        allowedScopes: editingDetail.allowedScopes,
        grantTypes: editingDetail.grantTypes,
        isPublic: editingDetail.isPublic,
        ratePlanId: editingDetail.ratePlanId ?? undefined,
        signEnabled: editingDetail.signEnabled ?? false,
        ipAllowlist: editingDetail.ipAllowlist,
        environment: editingDetail.environment,
        status: editingDetail.status,
      }
    : {
        isPublic: false,
        signEnabled: false,
        ipAllowlist: [],
        environment: 'production',
        allowedScopes: ['openid', 'profile'],
        grantTypes: ['authorization_code', 'refresh_token'],
      };

  async function handleModalOk() {
    let values: FormValues;
    try {
      values = (await formApi.current?.validate()) as FormValues;
    } catch {
      throw new Error('validation');
    }
    if (!values) throw new Error('validation');
    // 未选套餐时显式置 null，便于解绑
    const payload: FormValues = { ...values, ratePlanId: values.ratePlanId ?? null, signEnabled: values.signEnabled ?? false };
    const result = await saveMutation.mutateAsync({ id: editing?.id, values: payload as Record<string, unknown> });
    if (editing) {
      Toast.success('更新成功');
      closeModal();
    } else {
      closeModal();
      if ('clientSecret' in result && typeof result.clientSecret === 'string' && result.clientSecret) {
        setOneTimeClientId(String(result.clientId));
        setOneTimeSecret(result.clientSecret);
        setPreviousValidUntil('');
        setSecretModal(true);
      }
    }
  }

  // ─── 删除 ──────────────────────────────────────────────────────────────
  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  // ─── 重置 Secret ────────────────────────────────────────────────────────
  async function handleRegenerate(row: OAuth2Client) {
    const result = await regenerateMutation.mutateAsync(row.id);
    if (result.clientSecret) {
      setOneTimeClientId(result.clientId);
      setOneTimeSecret(result.clientSecret);
      setPreviousValidUntil(result.previousValidUntil);
      setSecretModal(true);
    }
  }

  async function handleReview(record: OAuth2Client, action: 'approve' | 'reject') {
    await reviewMutation.mutateAsync({
      id: record.id,
      action,
      comment: action === 'reject' ? '请完善应用配置后重新提交' : undefined,
    });
    Toast.success(action === 'approve' ? '审核已通过' : '应用已驳回');
  }

  const columns: ColumnProps<OAuth2Client>[] = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '应用名称', dataIndex: 'name', width: 160 },
    {
      title: 'Client ID',
      dataIndex: 'clientId',
      width: 260,
      render: (v: string) => <Text copyable={{ content: v }}>{v}</Text>,
    },
    {
      title: 'Secret 前缀',
      dataIndex: 'clientSecretPrefix',
      width: 140,
      render: (v: string | null) => v ?? <Text type="tertiary">（公开客户端）</Text>,
    },
    {
      title: '授权类型',
      dataIndex: 'grantTypes',
      width: 240,
      render: (v: string[]) => (
        <Space wrap>
          {v?.map((t) => (
            <Tag key={t} size="small">
              {OAUTH2_GRANT_TYPE_LABELS[t as keyof typeof OAUTH2_GRANT_TYPE_LABELS] ?? t}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '权限范围',
      dataIndex: 'allowedScopes',
      width: 220,
      render: (v: string[]) => (
        <Space wrap>
          {v?.map((s) => <Tag key={s} color="blue" size="small">{s}</Tag>)}
        </Space>
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
      title: '签名',
      dataIndex: 'signEnabled',
      width: 80,
      render: (v: boolean) => (v ? <Tag color="orange" size="small">已开启</Tag> : <Text type="tertiary">关闭</Text>),
    },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right' as const,
      render: (v: string, record: OAuth2Client) => (
        <Switch
          checked={v === 'enabled'}
          loading={togglingId === record.id}
          disabled={!canManage}
          onChange={(checked) => handleToggleStatus(record, checked)}
          size="small"
        />
      ),
    },
    createOperationColumn<OAuth2Client>({
      width: 220,
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
          onClick: () => openEdit(record),
        },
        {
          key: 'approve',
          label: '通过',
          hidden: !canManage || record.reviewStatus !== 'pending',
          onClick: () => void handleReview(record, 'approve'),
        },
        {
          key: 'reject',
          label: '驳回',
          danger: true,
          hidden: !canManage || record.reviewStatus !== 'pending',
          onClick: () => void handleReview(record, 'reject'),
        },
        {
          key: 'regenerate',
          label: '重置 Secret',
          hidden: !canManage || record.isPublic,
          onClick: () => {
            Modal.confirm({
              title: '重置 client_secret？此操作不可撤销',
              onOk: () => { void handleRegenerate(record); },
            });
          },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canManage,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除此应用吗？',
              content: '删除后不可恢复',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
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
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索应用名称"
              value={draftParams.keyword}
              onChange={(v) => setDraftParams({ ...draftParams, keyword: v })}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 220 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {canManage && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
            )}
          </>
        )}
        filters={(
          <>
            <Select
              placeholder="环境"
              value={draftParams.environment}
              onChange={(environment) => setDraftParams({ ...draftParams, environment: environment as SearchParams['environment'] })}
              optionList={OPEN_APP_ENVIRONMENTS.map((value) => ({ value, label: OPEN_APP_ENVIRONMENT_LABELS[value] }))}
              showClear
              style={{ width: 120 }}
            />
            <Select
              placeholder="审核状态"
              value={draftParams.reviewStatus}
              onChange={(reviewStatus) => setDraftParams({ ...draftParams, reviewStatus: reviewStatus as SearchParams['reviewStatus'] })}
              optionList={OPEN_APP_REVIEW_STATUSES.map((value) => ({ value, label: OPEN_APP_REVIEW_STATUS_LABELS[value] }))}
              showClear
              style={{ width: 130 }}
            />
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索应用名称"
              value={draftParams.keyword}
              onChange={(v) => setDraftParams({ ...draftParams, keyword: v })}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 220 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {canManage && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
            )}
            mobileFilters={(
              <>
                <Select
                  placeholder="环境"
                  value={draftParams.environment}
                  onChange={(environment) => setDraftParams({ ...draftParams, environment: environment as SearchParams['environment'] })}
                  optionList={OPEN_APP_ENVIRONMENTS.map((value) => ({ value, label: OPEN_APP_ENVIRONMENT_LABELS[value] }))}
                  showClear
                  style={{ width: '100%' }}
                />
                <Select
                  placeholder="审核状态"
                  value={draftParams.reviewStatus}
                  onChange={(reviewStatus) => setDraftParams({ ...draftParams, reviewStatus: reviewStatus as SearchParams['reviewStatus'] })}
                  optionList={OPEN_APP_REVIEW_STATUSES.map((value) => ({ value, label: OPEN_APP_REVIEW_STATUS_LABELS[value] }))}
                  showClear
                  style={{ width: '100%' }}
                />
              </>
            )}
          </>
        )}
        mobileActions={<Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>}
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
        size="small"
        empty="暂无数据"
        pagination={buildPagination(data?.total ?? 0)}
      />

      {/* 新增 / 编辑弹窗 */}
      <AppModal
        title={editing ? '编辑 OAuth2 应用' : '新增 OAuth2 应用'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: saveMutation.isPending, disabled: modalDetailLoading }}
        width={660}
        closeOnEsc
      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
          <Form
            key={editing?.id ?? 'new'}
            getFormApi={(api) => { formApi.current = api; }}
            allowEmpty
            initValues={formInitValues}
            labelPosition="left"
            labelWidth={120}
          >
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
                    optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
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
                  label="签名验签"
                  extraText="开放 API 调用强制 HMAC 签名"
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
      </AppModal>

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
    </div>
  );
}
