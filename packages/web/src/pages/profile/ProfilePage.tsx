import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Form, Button, Typography, Toast, Tag, Space, Spin,
  Modal, Input, Tabs, List as SemiList, Descriptions,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { UserRound, Shield, Monitor, List, Key, LogOut, Plus, Copy, CheckCircle, Smartphone } from 'lucide-react';
import { Icon } from '@iconify/react';
import { QRCodeSVG } from 'qrcode.react';

import type {
  User as UserType, OAuthProviderType,
  UserSession, UserApiTokenCreated, MfaFactor, TotpSetupResult,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { AppModal } from '@/components/AppModal';
import { AvatarCropperModal } from '@/components/AvatarCropperModal';
import { UserAvatar } from '@/components/UserAvatar';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { type PasswordPolicy } from '@/utils/password-policy';
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter';
import ConfigurableTable from '@/components/ConfigurableTable';
import { useDictItems } from '@/hooks/useDictItems';
import DictTag from '@/components/DictTag';
import { LoginLogsTable } from '@/components/logs/LoginLogsTable';
import { OperationLogsTable } from '@/components/logs/OperationLogsTable';
import {
  useBeginTotpSetup,
  useChangeProfilePassword,
  useCreateApiToken,
  useDeleteApiToken,
  useDisableMfaFactor,
  useKickOtherProfileSessions,
  useKickProfileSession,
  useProfileApiTokens,
  useProfileLoginLogs,
  useProfileMfaFactors,
  useProfileOauthAccounts,
  useProfileOAuthBindUrl,
  useProfileOperationLogs,
  useProfilePasswordPolicy,
  useProfileSessions,
  useUnbindProfileOAuth,
  useUpdateProfile,
  useVerifyTotpSetup,
} from '@/hooks/queries/profile';
import './ProfilePage.css';
import { createdAtColumn } from '../../utils/table-columns';

const { Title, Text } = Typography;

type SectionKey = 'profile' | 'security' | 'devices' | 'login' | 'operation' | 'api-tokens';

interface ProfilePageProps {
  readonly user: Omit<UserType, 'password'>;
  readonly onUserUpdate: (user: Omit<UserType, 'password'>) => void;
}

function SessionList({
  sessions,
  loading,
  onKick,
}: {
  readonly sessions: UserSession[];
  readonly loading?: boolean;
  readonly onKick: (tokenId: string) => void;
}) {
  return (
    <SemiList
      bordered
      className="session-list"
      dataSource={sessions}
      emptyContent={<div style={{ textAlign: 'center', padding: 40, color: 'var(--semi-color-text-2)' }}>暂无在线设备信息</div>}
      loading={loading}
      renderItem={(session: UserSession) => (
        <SemiList.Item
          key={session.tokenId}
          align="center"
          className={`session-list-item${session.isCurrent ? ' current' : ''}`}
          header={(
            <div className="session-list-icon">
              <Monitor size={17} />
            </div>
          )}
          main={(
            <div className="session-list-main">
              <div className="session-list-title">
                <Text strong>{session.browser}</Text>
                {session.isCurrent && <Tag color="blue" size="small">当前设备</Tag>}
              </div>
              <Text type="tertiary" size="small" className="session-list-meta">
                {session.os} · {session.location ? `${session.location}（${session.ip}）` : `IP: ${session.ip}`}
              </Text>
              <Text type="tertiary" size="small" className="session-list-meta">
                登录于 {formatDateTime(session.loginAt)} · 最后活跃 {formatDateTime(session.lastActiveAt)}
              </Text>
            </div>
          )}
          extra={!session.isCurrent && (
            <Button
              theme="borderless"
              type="danger"
              size="small"
              onClick={() => {
                Modal.confirm({
                  title: '确定要退出该设备吗？',
                  okButtonProps: { type: 'danger', theme: 'solid' },
                  onOk: () => onKick(session.tokenId),
                });
              }}
            >
              退出
            </Button>
          )}
        />
      )}
    />
  );
}

export default function ProfilePage({ user, onUserUpdate }: ProfilePageProps) {
  /** 更新当前用户：同步 App 状态 + dispatch 事件（让 AdminLayout 立即更新头像）*/
  function applyUserUpdate(updated: Omit<UserType, 'password'>) {
    onUserUpdate(updated);
    globalThis.dispatchEvent(new CustomEvent('auth:user-updated', { detail: updated }));
  }
  const [activeSection, setActiveSection] = useState<SectionKey>('profile');

  // ─── 基本信息 ────────────────────────────────────────────────────────────────
  const { items: genderItems } = useDictItems('user_gender');

  // ─── 头像裁剪 ────────────────────────────────────────────────────────────────
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [presetModalVisible, setPresetModalVisible] = useState(false);
  // ─── 账号安全 ────────────────────────────────────────────────────────────────
  const [changePwdVal, setChangePwdVal] = useState('');
  const [totpSetup, setTotpSetup] = useState<TotpSetupResult | null>(null);
  const [totpCode, setTotpCode] = useState('');

  // ─── 我的设备 ────────────────────────────────────────────────────────────────

  // ─── 操作日志 ────────────────────────────────────────────────────────────────

  const [loginLogsPage, setLoginLogsPage] = useState(1);
  const [operationLogsPage, setOperationLogsPage] = useState(1);

  // ─── API Token ───────────────────────────────────────────────────────────────
  const [newTokenVisible, setNewTokenVisible] = useState(false);
  const [createdToken, setCreatedToken] = useState<UserApiTokenCreated | null>(null);
  const newTokenFormApi = useRef<FormApi | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  const passwordPolicyQuery = useProfilePasswordPolicy();
  const oauthAccountsQuery = useProfileOauthAccounts(activeSection === 'security');
  const mfaFactorsQuery = useProfileMfaFactors(activeSection === 'security');
  const sessionsQuery = useProfileSessions(activeSection === 'devices');
  const loginLogsQuery = useProfileLoginLogs({ page: loginLogsPage, pageSize: 10 }, activeSection === 'login');
  const operationLogsQuery = useProfileOperationLogs({ page: operationLogsPage, pageSize: 10 }, activeSection === 'operation');
  const apiTokensQuery = useProfileApiTokens(activeSection === 'api-tokens');

  const passwordPolicy: PasswordPolicy | null = passwordPolicyQuery.data ?? null;
  const oauthAccounts = oauthAccountsQuery.data ?? [];
  const mfaFactors = mfaFactorsQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const loginLogs = loginLogsQuery.data?.list ?? [];
  const loginLogsTotal = loginLogsQuery.data?.total ?? 0;
  const operationLogs = operationLogsQuery.data?.list ?? [];
  const operationLogsTotal = operationLogsQuery.data?.total ?? 0;
  const apiTokens = apiTokensQuery.data ?? [];

  const updateProfileMutation = useUpdateProfile();
  const updateAvatarMutation = useUpdateProfile();
  const uploadAvatarMutation = useMutation({
    mutationFn: (formData: FormData) => request.post<{ url: string }>('/api/files/upload-one', formData),
  });
  const changePasswordMutation = useChangeProfilePassword();
  const oauthBindUrlMutation = useProfileOAuthBindUrl();
  const oauthUnbindMutation = useUnbindProfileOAuth();
  const beginTotpSetupMutation = useBeginTotpSetup();
  const verifyTotpSetupMutation = useVerifyTotpSetup();
  const disableMfaMutation = useDisableMfaFactor();
  const kickOthersMutation = useKickOtherProfileSessions();
  const kickSessionMutation = useKickProfileSession();
  const createTokenMutation = useCreateApiToken();
  const deleteTokenMutation = useDeleteApiToken();

  const profileLoading = updateProfileMutation.isPending;
  const pwdLoading = changePasswordMutation.isPending;
  const oauthLoading = oauthAccountsQuery.isFetching;
  const mfaLoading = mfaFactorsQuery.isFetching;
  const sessionsLoading = sessionsQuery.isFetching;
  const kickOthersLoading = kickOthersMutation.isPending;
  const loginLogsLoading = loginLogsQuery.isFetching;
  const operationLogsLoading = operationLogsQuery.isFetching;
  const apiTokensLoading = apiTokensQuery.isFetching;
  const newTokenCreating = createTokenMutation.isPending;
  const totpSubmitting = beginTotpSetupMutation.isPending || verifyTotpSetupMutation.isPending;
  const avatarLoading = uploadAvatarMutation.isPending || updateAvatarMutation.isPending;

  // ─── 事件处理 ────────────────────────────────────────────────────────────────

  async function handleUpdateProfile(values: { nickname: string; email: string; phone?: string; gender?: string | null }) {
    const payload = { ...values, gender: values.gender ?? null };
    const updated = await updateProfileMutation.mutateAsync(payload);
    Toast.success('资料已更新');
    applyUserUpdate(updated);
  }

  async function handleChangePassword(values: { oldPassword: string; newPassword: string; confirmPassword: string }) {
    if (values.newPassword !== values.confirmPassword) { Toast.error('两次密码输入不一致'); return; }
    await changePasswordMutation.mutateAsync({ oldPassword: values.oldPassword, newPassword: values.newPassword });
    Toast.success('密码修改成功，请重新登录');
    setChangePwdVal('');
  }

  async function handleOAuthBind(provider: OAuthProviderType) {
    const res = await oauthBindUrlMutation.mutateAsync(provider);
    if (res.authUrl) {
      sessionStorage.setItem('oauth_bind_provider', provider);
      globalThis.location.href = res.authUrl;
    }
  }

  async function handleOAuthUnbind(provider: OAuthProviderType) {
    await oauthUnbindMutation.mutateAsync(provider);
    Toast.success('已解绑');
  }

  async function handleBeginTotpSetup() {
    const res = await beginTotpSetupMutation.mutateAsync();
    setTotpSetup(res);
    setTotpCode('');
  }

  async function handleVerifyTotpSetup() {
    if (!totpSetup) return;
    await verifyTotpSetupMutation.mutateAsync({ factorId: totpSetup.factorId, code: totpCode });
    Toast.success('TOTP 已绑定');
    setTotpSetup(null);
    setTotpCode('');
  }

  async function handleDisableMfaFactor(id: number) {
    await disableMfaMutation.mutateAsync(id);
    Toast.success('已停用');
  }

  function handleAvatarFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropFile(file);
    e.target.value = '';
  }

  async function handleCropConfirm(blob: Blob) {
    const formData = new FormData();
    formData.append('file', blob, 'avatar.jpg');
    const uploadRes = await uploadAvatarMutation.mutateAsync(formData);
    const uploadedUrl = uploadRes.data?.url;
    if (uploadRes.code === 0 && uploadedUrl) {
      const updated = await updateAvatarMutation.mutateAsync({ avatar: uploadedUrl });
      applyUserUpdate(updated);
      Toast.success('头像已更新');
      setCropFile(null);
    } else {
      Toast.error(uploadRes.message ?? '上传失败');
    }
  }

  async function handleKickOthers() {
    await kickOthersMutation.mutateAsync();
    Toast.success('操作成功');
  }

  async function handleKickSession(tokenId: string) {
    await kickSessionMutation.mutateAsync(tokenId);
    Toast.success('已退出该设备');
  }

  function closeNewTokenModal() {
    setNewTokenVisible(false);
    newTokenFormApi.current = null;
  }

  async function handleCreateToken(values: { name: string; expiresAt?: Date | string | null }) {
    if (!values.name.trim()) { Toast.error('请填写 Token 名称'); return; }
    const body: { name: string; expiresAt?: string } = { name: values.name.trim() };
    if (values.expiresAt) body.expiresAt = formatDateTimeForApi(values.expiresAt);
    const res = await createTokenMutation.mutateAsync(body);
    setCreatedToken(res);
    closeNewTokenModal();
  }

  async function handleCreateTokenOk() {
    if (!newTokenFormApi.current) return;
    let values: { name: string; expiresAt?: Date | string | null };
    try {
      values = await newTokenFormApi.current.validate() as { name: string; expiresAt?: Date | string | null };
    } catch {
      throw new Error('validation');
    }
    await handleCreateToken(values);
  }

  async function handleDeleteToken(id: number) {
    await deleteTokenMutation.mutateAsync(id);
    Toast.success('Token 已撤销');
  }

  function copyToken(token: string) {
    void navigator.clipboard.writeText(token).then(() => {
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    });
  }

  async function handleRemoveAvatar() {
    Modal.confirm({
      title: '确定要移除头像吗？',
      content: '移除后将使用昵称缩写作为默认头像。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const updated = await updateAvatarMutation.mutateAsync({ avatar: null });
        applyUserUpdate(updated);
        Toast.success('头像已移除');
      },
    });
  }

  function openAvatarPicker() {
    avatarInputRef.current?.click();
  }

  async function handleApplyPreset(url: string) {
    setPresetModalVisible(false);
    const updated = await updateAvatarMutation.mutateAsync({ avatar: url });
    applyUserUpdate(updated);
    Toast.success('头像已更新');
  }

  // ─── 预设头像 ──────────────────────────────────────────────────────────────
  const PRESET_AVATARS = Array.from({ length: 12 }, (_, i) => `/avatars/avatar-${String(i + 1).padStart(2, '0')}.svg`);

  // ─── 静态配置 ────────────────────────────────────────────────────────────────

  const PROVIDER_INFO: Record<OAuthProviderType, { label: string; icon: React.ReactNode }> = {
    github: { label: 'GitHub', icon: <Icon icon="simple-icons:github" width="16" height="16" /> },
    dingtalk: { label: '钉钉', icon: <Icon icon="ant-design:dingtalk-outlined" width="16" height="16" /> },
    wechat_work: { label: '企业微信', icon: <Icon icon="ant-design:wechat-work-filled" width="16" height="16" /> },
  };
  const OAUTH_PROVIDERS: OAuthProviderType[] = ['github', 'dingtalk', 'wechat_work'];

  return (
    <div className="page-container">
      <div className="profile-content-card">
        <Tabs
          activeKey={activeSection}
          onChange={(v) => setActiveSection(v as SectionKey)}
          className="profile-tabs"
        >
            {/* ── 基本信息 ──────────────────────────────────────── */}
            <Tabs.TabPane
              itemKey="profile"
              tab={<span className="profile-tab-label"><UserRound size={14} /><span>基本信息</span></span>}
            >
              <div className="profile-section">
                  <div className="section-title">基本信息</div>
                    <div className="profile-basic-overview">
                      <div className="avatar-column">
                        <button
                          type="button"
                          className="avatar-upload-trigger"
                          onClick={openAvatarPicker}
                          aria-label="更换头像"
                        >
                          {avatarLoading ? (
                            <div className="avatar-loading-wrapper" style={{ width: 80, height: 80 }}><Spin /></div>
                          ) : (
                            <>
                              <UserAvatar
                                name={user.nickname || '用户'}
                                avatar={user.avatar}
                                semiSize="extra-large"
                                size={80}
                                style={{ fontSize: 28 }}
                              />
                              <div className="avatar-upload-mask">更换头像</div>
                            </>
                          )}
                        </button>
                        <Button size="small" theme="light" loading={avatarLoading} onClick={openAvatarPicker} style={{ width: '100%' }}>更换头像</Button>
                        <Button size="small" theme="borderless" onClick={() => setPresetModalVisible(true)} style={{ width: '100%' }}>选择预设头像</Button>
                        {user.avatar && (
                          <Button size="small" theme="borderless" type="danger" loading={avatarLoading} onClick={handleRemoveAvatar} style={{ width: '100%' }}>移除头像</Button>
                        )}
                        <input
                          ref={avatarInputRef}
                          id="avatar-file-input"
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={handleAvatarFileSelect}
                        />
                      </div>
                      <div className="profile-basic-summary">
                        <div className="profile-basic-heading">
                          <Title heading={5} style={{ margin: 0 }}>{user.nickname}</Title>
                          <Text type="tertiary" size="small">@{user.username}</Text>
                        </div>
                        <Descriptions
                          align="plain"
                          layout="horizontal"
                          column={2}
                          style={{ width: '100%' }}
                          data={[
                            { key: '邮箱', value: user.email },
                            { key: '手机号', value: user.phone, hidden: !user.phone },
                            {
                              key: '性别',
                              value: <DictTag dictCode="user_gender" value={user.gender} />,
                              hidden: !user.gender,
                            },
                            { key: '部门', value: user.departmentName, hidden: !user.departmentName },
                            {
                              key: '岗位',
                              value: user.positions?.length ? (
                                <Space spacing={4} style={{ display: 'inline-flex', flexWrap: 'wrap' }}>
                                  {user.positions.map((p) => <Tag key={p.id} size="small" color="teal">{p.name}</Tag>)}
                                </Space>
                              ) : undefined,
                              hidden: !user.positions?.length,
                            },
                            {
                              key: '角色',
                              value: user.roles?.length ? (
                                <Space spacing={4} style={{ display: 'inline-flex', flexWrap: 'wrap' }}>
                                  {user.roles.map((r) => <Tag key={r.id} size="small" color="blue">{r.name}</Tag>)}
                                </Space>
                              ) : '无角色',
                            },
                            { key: '注册时间', value: formatDateTime(user.createdAt) },
                          ]}
                        />
                      </div>
                    </div>

                    <div className="section-divider" />

                    <div className="section-title">资料编辑</div>
                  <Form
                    initValues={{ nickname: user.nickname, email: user.email, phone: user.phone ?? '', gender: user.gender ?? undefined }}
                    onSubmit={handleUpdateProfile}
                    allowEmpty
                    labelPosition="left"
                    labelWidth={80}
                  >
                    <Form.Input
                      field="nickname"
                      label="昵称"
                      placeholder="请输入昵称"
                      rules={[{ required: true, message: '昵称不能为空' }]}
                      style={{ width: 320 }}
                    />
                    <Form.Input
                      field="email"
                      label="邮箱"
                      placeholder="请输入邮箱"
                      rules={[
                        { required: true, message: '邮箱不能为空' },
                        { type: 'email', message: '邮箱格式不正确' },
                      ]}
                      style={{ width: 320 }}
                    />
                    <Form.Input
                      field="phone"
                      label="手机号"
                      placeholder="请输入手机号（选填）"
                      rules={[
                        { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号码' },
                      ]}
                      style={{ width: 320 }}
                    />
                    <Form.Select
                      field="gender"
                      label="性别"
                      style={{ width: 320 }}
                      showClear
                      optionList={genderItems.map((i) => ({ value: i.value, label: i.label }))}
                      placeholder="请选择性别（选填）"
                    />
                    <Form.Slot>
                      <Button htmlType="submit" type="primary" loading={profileLoading}>保存修改</Button>
                    </Form.Slot>
                  </Form>
              </div>
            </Tabs.TabPane>

            {/* ── 账号安全 ──────────────────────────────────────── */}
            <Tabs.TabPane
              itemKey="security"
              tab={<span className="profile-tab-label"><Shield size={14} /><span>账号安全</span></span>}
            >
              <div className="profile-section">
                  <div className="section-title">修改密码</div>
                  <Form onSubmit={handleChangePassword} labelPosition="left" labelWidth={100}>
                    <Form.Input
                      field="oldPassword"
                      label="原密码"
                      placeholder="请输入原密码"
                      mode="password"
                      rules={[{ required: true, message: '请输入原密码' }]}
                      style={{ width: 320 }}
                    />
                    <Form.Input
                      field="newPassword"
                      label="新密码"
                      placeholder="请输入新密码"
                      mode="password"
                      rules={[
                        { required: true, message: '请输入新密码' },
                        ...(passwordPolicy?.minLength ? [{ min: passwordPolicy.minLength, message: `密码至少${passwordPolicy.minLength}个字符` }] : []),
                      ]}
                      style={{ width: 320 }}
                      onChange={(v) => setChangePwdVal(String(v ?? ''))}
                      helpText={<PasswordStrengthMeter password={changePwdVal} policy={passwordPolicy} />}
                    />
                    <Form.Input
                      field="confirmPassword"
                      label="确认密码"
                      placeholder="请再次输入新密码"
                      mode="password"
                      rules={[{ required: true, message: '请确认新密码' }]}
                      style={{ width: 320 }}
                    />
                    <Form.Slot>
                      <Button htmlType="submit" type="primary" loading={pwdLoading}>修改密码</Button>
                    </Form.Slot>
                  </Form>

                  <div className="section-divider" />

                  <div className="section-title">多因素认证</div>
                  <SemiList
                    bordered
                    className="oauth-list"
                    dataSource={mfaFactors}
                    loading={mfaLoading}
                    emptyContent={<div style={{ padding: 24, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>暂未绑定 MFA 因子</div>}
                    renderItem={(factor: MfaFactor) => (
                      <SemiList.Item
                        key={factor.id}
                        align="center"
                        className="oauth-list-item"
                        header={<span className="oauth-list-icon"><Smartphone size={16} /></span>}
                        main={(
                          <div className="oauth-list-main">
                            <Text strong>{factor.name}</Text>
                            <Tag color={factor.status === 'enabled' ? 'green' : 'grey'} size="small">
                              {factor.status === 'enabled' ? '已启用' : factor.status === 'pending' ? '待验证' : '已停用'}
                            </Tag>
                            {factor.lastUsedAt && <Text type="tertiary" size="small">上次使用 {formatDateTime(factor.lastUsedAt)}</Text>}
                          </div>
                        )}
                        extra={factor.status === 'enabled' && (
                          <Button
                            theme="borderless"
                            type="danger"
                            size="small"
                            onClick={() => {
                              Modal.confirm({
                                title: '确定要停用该 MFA 因子吗？',
                                okButtonProps: { type: 'danger', theme: 'solid' },
                                onOk: () => handleDisableMfaFactor(factor.id),
                              });
                            }}
                          >
                            停用
                          </Button>
                        )}
                      />
                    )}
                  />
                  <Button
                    type="primary"
                    theme="light"
                    size="small"
                    icon={<Plus size={14} />}
                    loading={totpSubmitting}
                    style={{ marginTop: 12 }}
                    onClick={handleBeginTotpSetup}
                  >
                    绑定身份验证器
                  </Button>

                  <div className="section-divider" />

                  <div className="section-title">第三方账号绑定</div>
                  <SemiList
                    bordered
                    className="oauth-list"
                    dataSource={OAUTH_PROVIDERS}
                    loading={oauthLoading}
                    renderItem={(provider: OAuthProviderType) => {
                        const info = PROVIDER_INFO[provider];
                        const bound = oauthAccounts.find((a) => a.provider === provider);
                        return (
                          <SemiList.Item
                            key={provider}
                            align="center"
                            className="oauth-list-item"
                            header={(
                              <span className="oauth-list-icon">
                              {info.icon}
                              </span>
                            )}
                            main={(
                              <div className="oauth-list-main">
                                <Text strong>{info.label}</Text>
                                {bound ? (
                                  <Tag color="green" size="small">已绑定 · {bound.nickname || bound.openId}</Tag>
                                ) : (
                                  <Tag color="grey" size="small">未绑定</Tag>
                                )}
                              </div>
                            )}
                            extra={bound ? (
                              <Button theme="borderless" type="danger" size="small" onClick={() => {
                                Modal.confirm({
                                  title: `确定要解绑 ${info.label} 账号吗？`,
                                  okButtonProps: { type: 'danger', theme: 'solid' },
                                  onOk: () => handleOAuthUnbind(provider),
                                });
                              }}>解绑</Button>
                            ) : (
                              <Button theme="borderless" size="small" onClick={() => handleOAuthBind(provider)}>绑定</Button>
                            )}
                          />
                        );
                    }}
                  />
              </div>
            </Tabs.TabPane>

            {/* ── 我的设备 ──────────────────────────────────────── */}
            <Tabs.TabPane
              itemKey="devices"
              tab={<span className="profile-tab-label"><Monitor size={14} /><span>我的设备</span></span>}
            >
              <div className="profile-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <div className="section-title" style={{ margin: 0 }}>在线设备</div>
                    <Button type="danger" theme="light" size="small" loading={kickOthersLoading} icon={<LogOut size={14} />} onClick={() => {
                      Modal.confirm({
                        title: '确定要退出其他所有设备吗？',
                        content: '退出后其他设备将需要重新登录。',
                        okButtonProps: { type: 'danger', theme: 'solid' },
                        onOk: handleKickOthers,
                      });
                    }}>
                      退出其他设备
                    </Button>
                  </div>
                  <SessionList sessions={sessions} loading={sessionsLoading} onKick={handleKickSession} />
              </div>
            </Tabs.TabPane>

            {/* ── 登录记录 ──────────────────────────────────────── */}
            <Tabs.TabPane
              itemKey="login"
              tab={<span className="profile-tab-label"><List size={14} /><span>登录记录</span></span>}
            >
              <div className="profile-section">
                <LoginLogsTable
                  loading={loginLogsLoading}
                  dataSource={loginLogs}
                  onRefresh={() => void loginLogsQuery.refetch()}
                  columnSettingsKey="profile-login-logs"
                  pagination={{
                    total: loginLogsTotal,
                    currentPage: loginLogsPage,
                    pageSize: 10,
                    showSizeChanger: false,
                    onPageChange: (page) => setLoginLogsPage(page),
                  }}
                />
              </div>
            </Tabs.TabPane>

            {/* ── 操作记录 ──────────────────────────────────────── */}
            <Tabs.TabPane
              itemKey="operation"
              tab={<span className="profile-tab-label"><List size={14} /><span>操作记录</span></span>}
            >
              <div className="profile-section">
                <OperationLogsTable
                  loading={operationLogsLoading}
                  dataSource={operationLogs}
                  onRefresh={() => void operationLogsQuery.refetch()}
                  columnSettingsKey="profile-operation-logs"
                  pagination={{
                    total: operationLogsTotal,
                    currentPage: operationLogsPage,
                    pageSize: 10,
                    showSizeChanger: false,
                    onPageChange: (page) => setOperationLogsPage(page),
                  }}
                />
              </div>
            </Tabs.TabPane>

            {/* ── API Token ─────────────────────────────────────── */}
            <Tabs.TabPane
              itemKey="api-tokens"
              tab={<span className="profile-tab-label"><Key size={14} /><span>API Token</span></span>}
            >
              <div className="profile-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div className="section-title" style={{ margin: 0 }}>API Token</div>
                    <Button type="primary" size="small" icon={<Plus size={14} />} onClick={() => setNewTokenVisible(true)}>
                      新建 Token
                    </Button>
                  </div>
                  <Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 16 }}>
                    Token 可通过 <code>Authorization: Bearer YOUR_TOKEN</code> 头访问 API，每人最多 20 个。
                  </Text>
                  {apiTokensLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                  ) : (
                    <ConfigurableTable
                      bordered
                      dataSource={apiTokens}
                      rowKey="id"
                      onRefresh={() => void apiTokensQuery.refetch()}
                      refreshLoading={apiTokensLoading}
                      pagination={false}
                      columns={[
                        { title: '名称', dataIndex: 'name', width: 150, render: (v: string) => <Text strong>{v}</Text> },
                        { title: 'Token 前缀', dataIndex: 'tokenPrefix', width: 160, render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code> },
                        { title: '最后使用', dataIndex: 'lastUsedAt', render: (v: string | null) => v ? formatDateTime(v) : '未使用', width: 180 },
                        { title: '过期时间', dataIndex: 'expiresAt', render: (v: string | null) => v ? formatDateTime(v) : '永久有效', width: 180 },
                        createdAtColumn,
                        {
                          title: '操作', dataIndex: 'id', width: 80, fixed: 'right',
                          render: (id: number) => (
                            <Button theme="borderless" type="danger" size="small" onClick={() => {
                              Modal.confirm({
                                title: '确定要撤销该 Token 吗？',
                                content: '撤销后将无法恢复，使用该 Token 的调用将立即失效。',
                                okButtonProps: { type: 'danger', theme: 'solid' },
                                onOk: () => handleDeleteToken(id),
                              });
                            }}>撤销</Button>
                          ),
                        },
                      ]}
                    />
                  )}
              </div>
            </Tabs.TabPane>

          </Tabs>
      </div>

      {/* ── 预设头像选择 Modal ─────────────────────────────────────────────── */}
      <AppModal
        title="选择预设头像"
        visible={presetModalVisible}
        onCancel={() => setPresetModalVisible(false)}
        footer={null}
        width={460}
        centered
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '8px 0 16px' }}>
          {PRESET_AVATARS.map((url) => (
            <button
              key={url}
              type="button"
              onClick={() => void handleApplyPreset(url)}
              style={{
                border: user.avatar === url ? '2px solid var(--semi-color-primary)' : '2px solid transparent',
                borderRadius: 8, padding: 4, cursor: 'pointer', background: 'var(--semi-color-fill-0)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => { if (user.avatar !== url) e.currentTarget.style.borderColor = 'var(--semi-color-primary-light-hover)'; }}
              onMouseLeave={(e) => { if (user.avatar !== url) e.currentTarget.style.borderColor = 'transparent'; }}
            >
              <img
                src={url}
                alt="预设头像"
                width={72}
                height={72}
                style={{ borderRadius: 4, display: 'block' }}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      </AppModal>

      <AppModal
        title="绑定身份验证器"
        visible={!!totpSetup}
        onCancel={() => { setTotpSetup(null); setTotpCode(''); }}
        footer={
          <Space>
            <Button onClick={() => { setTotpSetup(null); setTotpCode(''); }}>取消</Button>
            <Button type="primary" loading={totpSubmitting} onClick={handleVerifyTotpSetup}>确认绑定</Button>
          </Space>
        }
        width={480}
        centered
      >
        {totpSetup && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <QRCodeSVG value={totpSetup.otpauthUrl} size={180} />
            <Text type="tertiary" size="small" style={{ textAlign: 'center' }}>
              使用身份验证器扫描二维码，或手动输入密钥 <code>{totpSetup.secret}</code>。
            </Text>
            <Input
              value={totpCode}
              onChange={setTotpCode}
              placeholder="输入 6 位动态验证码"
              style={{ width: 220 }}
            />
          </div>
        )}
      </AppModal>

      {/* ── 头像裁剪 Modal ────────────────────────────────────────────────────────────────── */}
      <AvatarCropperModal
        file={cropFile}
        confirmLoading={avatarLoading}
        onCancel={() => setCropFile(null)}
        onConfirm={(blob) => void handleCropConfirm(blob)}
      />

      {/* ── 新建 Token Modal ──────────────────────────────────────────────────────────────── */}
      <AppModal
        title="新建 API Token"
        visible={newTokenVisible}
        onCancel={closeNewTokenModal}
        onOk={handleCreateTokenOk}
        okText="创建"
        cancelText="取消"
        okButtonProps={{ loading: newTokenCreating }}
        width={480}
        centered
      >
        <Form
          key={newTokenVisible ? 'new-token-open' : 'new-token-closed'}
          getFormApi={(api) => { newTokenFormApi.current = api; }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input
            field="name"
            label="Token 名称"
            placeholder="如：本地开发、CI/CD 环境"
            rules={[{ required: true, message: '请填写 Token 名称' }]}
            style={{ width: '100%' }}
          />
          <Form.DatePicker
            field="expiresAt"
            label="过期时间"
            type="dateTime"
            placeholder="不填则永久有效"
            style={{ width: '100%' }}
            disabledDate={(date) => !!date && date < new Date()}
          />
        </Form>
      </AppModal>

      {/* ── 创建成功展示完整 Token ──────────────────────────────────────────── */}
      <Modal
        title="Token 创建成功"
        visible={!!createdToken}
        onCancel={() => setCreatedToken(null)}
        footer={<Button type="primary" onClick={() => setCreatedToken(null)}>关闭</Button>}
        width={520}
        centered
      >
        <Text
          type="warning"
          style={{ display: 'block', marginBottom: 12, padding: '8px 12px', background: 'var(--semi-color-warning-light-default)', borderRadius: 6 }}
        >
          ⚠️ 请立即复制并安全保存此 Token，关闭后将无法再次查看完整内容。
        </Text>
        {createdToken && (
          <div className="token-display">
            <code style={{ flex: 1, wordBreak: 'break-all', fontSize: 12, lineHeight: 1.6 }}>{createdToken.token}</code>
            <Button
              icon={tokenCopied ? <CheckCircle size={14} /> : <Copy size={14} />}
              type={tokenCopied ? 'tertiary' : 'primary'}
              onClick={() => copyToken(createdToken.token)}
              style={{ flexShrink: 0 }}
            >
              {tokenCopied ? '已复制' : '复制'}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
