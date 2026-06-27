import { useState, useEffect, useCallback, useRef } from 'react';
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
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { OAUTH2_GRANT_TYPES, OAUTH2_SCOPES } from '@zenith/shared';
import type { OAuth2Client, OAuth2ClientCreated, PaginatedResponse, RatePlan, ApiScope } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { createdAtColumn } from '@/utils/table-columns';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';

const { Text, Paragraph } = Typography;

const GRANT_TYPE_LABELS: Record<string, string> = {
  authorization_code: '授权码',
  client_credentials: '客户端凭证',
  implicit: '隐式（已废弃）',
  refresh_token: '刷新令牌',
};

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
  status?: 'enabled' | 'disabled';
};

export default function OAuth2AppsPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:oauth2-apps:manage');
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  const handleToggleStatus = (record: OAuth2Client, checked: boolean) => {
    const newStatus = checked ? 'enabled' : 'disabled';
    const doToggle = async () => {
      setTogglingIds((prev) => new Set(prev).add(record.id));
      try {
        await request.put(`/api/oauth2/clients/${record.id}`, { status: newStatus });
        Toast.success(checked ? '已启用' : '已禁用');
        void fetchData();
      } catch (err: unknown) {
        Toast.error((err as { message?: string })?.message || '操作失败');
      } finally {
        setTogglingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; });
      }
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
  interface SearchParams { keyword: string; }
  const defaultSearchParams: SearchParams = { keyword: '' };
  const [data, setData] = useState<PaginatedResponse<OAuth2Client> | null>(null);
  const [loading, setLoading] = useState(false);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [scopeOptions, setScopeOptions] = useState<ApiScope[]>([]);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  // 弹窗状态
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<OAuth2Client | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);

  // 一次性 Secret 展示
  const [secretModal, setSecretModal] = useState(false);
  const [oneTimeSecret, setOneTimeSecret] = useState('');
  const [oneTimeClientId, setOneTimeClientId] = useState('');

  // ─── 数据加载 ──────────────────────────────────────────────────────────
  const fetchData = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const { keyword: activeKw } = params ?? searchParamsRef.current;
      setLoading(true);
      try {
        const queryObj: Record<string, string> = { page: String(p), pageSize: String(ps) };
        if (activeKw) queryObj.keyword = activeKw;
        const qs = new URLSearchParams(queryObj).toString();
        const res = await request.get<PaginatedResponse<OAuth2Client>>(`/api/oauth2/clients?${qs}`);
        if (res.code === 0) {
          setData(res.data);
          setPage(res.data.page);
        }
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize],
  );

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载限流套餐与 scope 注册表（供应用配置下拉）
  useEffect(() => {
    void (async () => {
      const [planRes, scopeRes] = await Promise.all([
        request.get<RatePlan[]>('/api/rate-plans/options', { silent: true }),
        request.get<ApiScope[]>('/api/api-scopes/options', { silent: true }),
      ]);
      if (planRes.code === 0 && planRes.data) setRatePlans(planRes.data);
      if (scopeRes.code === 0 && scopeRes.data) setScopeOptions(scopeRes.data);
    })();
  }, []);

  // ─── 搜索 / 重置 ────────────────────────────────────────────────────────
  function handleSearch() {
    setPage(1);
    void fetchData(1, pageSize);
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchData(1, pageSize, defaultSearchParams);
  }

  // ─── 新增 ──────────────────────────────────────────────────────────────
  function openCreate() {
    setEditing(null);
    setModalVisible(true);
  }

  // ─── 编辑：先弹窗再异步回填 ──────────────────────────────────────────────
  async function openEdit(record: OAuth2Client) {
    setEditing(record);
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<OAuth2Client>(`/api/oauth2/clients/${record.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditing(res.data);
      // initValues 仅在 Form 挂载时生效，主动 setValues 保证回填最新数据
      formApi.current?.setValues({
        name: res.data.name,
        description: res.data.description ?? '',
        logoUrl: res.data.logoUrl ?? '',
        redirectUris: res.data.redirectUris,
        allowedScopes: res.data.allowedScopes,
        grantTypes: res.data.grantTypes,
        isPublic: res.data.isPublic,
        ratePlanId: res.data.ratePlanId ?? undefined,
        signEnabled: res.data.signEnabled ?? false,
        status: res.data.status,
      });
    } else {
      Toast.error(res.message || '获取应用信息失败');
    }
  }

  function closeModal() {
    setModalVisible(false);
    setEditing(null);
    setModalDetailLoading(false);
  }

  const formInitValues: Partial<FormValues> = editing
    ? {
        name: editing.name,
        description: editing.description ?? '',
        logoUrl: editing.logoUrl ?? '',
        redirectUris: editing.redirectUris,
        allowedScopes: editing.allowedScopes,
        grantTypes: editing.grantTypes,
        isPublic: editing.isPublic,
        ratePlanId: editing.ratePlanId ?? undefined,
        signEnabled: editing.signEnabled ?? false,
        status: editing.status,
      }
    : { isPublic: false, signEnabled: false, allowedScopes: ['openid', 'profile'], grantTypes: ['authorization_code', 'refresh_token'] };

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
    setSubmitting(true);
    try {
      if (editing) {
        const res = await request.put(`/api/oauth2/clients/${editing.id}`, payload);
        if (res.code === 0) {
          Toast.success('更新成功');
          closeModal();
          void fetchData();
        } else {
          throw new Error(res.message);
        }
      } else {
        const res = await request.post<OAuth2ClientCreated>('/api/oauth2/clients', payload);
        if (res.code === 0) {
          closeModal();
          void fetchData();
          if (res.data?.clientSecret) {
            setOneTimeClientId(res.data.clientId);
            setOneTimeSecret(res.data.clientSecret);
            setSecretModal(true);
          }
        } else {
          throw new Error(res.message);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ─── 删除 ──────────────────────────────────────────────────────────────
  async function handleDelete(id: number) {
    const res = await request.delete(`/api/oauth2/clients/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchData();
    }
  }

  // ─── 重置 Secret ────────────────────────────────────────────────────────
  async function handleRegenerate(row: OAuth2Client) {
    const res = await request.post<{ clientId: string; clientSecret: string }>(`/api/oauth2/clients/${row.id}/regenerate-secret`);
    if (res.code === 0 && res.data?.clientSecret) {
      setOneTimeClientId(res.data.clientId);
      setOneTimeSecret(res.data.clientSecret);
      setSecretModal(true);
    }
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
          {v?.map((t) => <Tag key={t} size="small">{GRANT_TYPE_LABELS[t] ?? t}</Tag>)}
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
          loading={togglingIds.has(record.id)}
          disabled={!canManage}
          onChange={(checked) => handleToggleStatus(record, checked)}
          size="small"
        />
      ),
    },
    createOperationColumn<OAuth2Client>({
      width: 200,
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(record),
        },
        {
          key: 'regenerate',
          label: '重置 Secret',
          hidden: !canManage || record.isPublic,
          onClick: () => {
            Modal.confirm({
              title: '重置 client_secret？此操作不可撤销',
              onOk: () => handleRegenerate(record),
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
              value={searchParams.keyword}
              onChange={(v) => setSearchParams({ keyword: v })}
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
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索应用名称"
              value={searchParams.keyword}
              onChange={(v) => setSearchParams({ keyword: v })}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 220 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {canManage && (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
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
        loading={loading}
        onRefresh={fetchData}
        refreshLoading={loading}
        rowKey="id"
        size="small"
        empty="暂无数据"
        pagination={buildPagination(data?.total ?? 0, fetchData)}
      />

      {/* 新增 / 编辑弹窗 */}
      <AppModal
        title={editing ? '编辑 OAuth2 应用' : '新增 OAuth2 应用'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: submitting, disabled: modalDetailLoading }}
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
                    <Checkbox key={t} value={t}>{GRANT_TYPE_LABELS[t] ?? t}</Checkbox>
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
                    optionList={[
                      { value: 'enabled', label: '启用' },
                      { value: 'disabled', label: '禁用' },
                    ]}
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
        <div style={{ marginBottom: 8 }}>
          <Text strong>Client ID：</Text>
        </div>
        <Paragraph copyable style={{ wordBreak: 'break-all', background: 'var(--semi-color-fill-0)', padding: 8, borderRadius: 4 }}>
          {oneTimeClientId}
        </Paragraph>
        <div style={{ marginTop: 12, marginBottom: 8 }}>
          <Text strong>Client Secret：</Text>
        </div>
        <Paragraph copyable style={{ wordBreak: 'break-all', background: 'var(--semi-color-fill-0)', padding: 8, borderRadius: 4 }}>
          {oneTimeSecret}
        </Paragraph>
      </Modal>
    </div>
  );
}
