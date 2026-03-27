import { useState, useEffect, useRef } from 'react';
import {
  Card, Form, Button, Typography, Toast, Avatar, Tag, Space, Spin, Table,
  Modal, Cropper, Input, Tabs,
} from '@douyinfe/semi-ui';
import { UserRound, Shield, Monitor, List, Key, LogOut, Plus, Copy, CheckCircle } from 'lucide-react';
import { Icon } from '@iconify/react';

import type {
  User as UserType, LoginLog, OperationLog, OAuthAccount, OAuthProviderType,
  UserSession, UserApiToken, UserApiTokenCreated,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { formatPasswordPolicyHint, type PasswordPolicy } from '@/utils/password-policy';
import './ProfilePage.css';

const { Title, Text } = Typography;

type SectionKey = 'profile' | 'security' | 'devices' | 'logs' | 'api-tokens';

interface ProfilePageProps {
  readonly user: Omit<UserType, 'password'>;
  readonly onUserUpdate: (user: Omit<UserType, 'password'>) => void;
}

function SessionList({ sessions, onKick }: { readonly sessions: UserSession[]; readonly onKick: (tokenId: string) => void }) {
  if (sessions.length === 0) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--semi-color-text-2)' }}>暂无在线设备信息</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sessions.map((session) => (
        <div key={session.tokenId} className={`session-item${session.isCurrent ? ' current' : ''}`}>
          <div className="session-info">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Monitor size={15} style={{ color: 'var(--semi-color-text-2)', flexShrink: 0 }} />
              <Text strong>{session.browser}</Text>
              {session.isCurrent && <Tag color="blue" size="small">当前设备</Tag>}
            </div>
            <Text type="tertiary" size="small" style={{ display: 'block' }}>
              {session.os} · IP: {session.ip}
            </Text>
            <Text type="tertiary" size="small" style={{ display: 'block' }}>
              登录于 {formatDateTime(session.loginAt)} · 最后活跃 {formatDateTime(session.lastActiveAt)}
            </Text>
          </div>
          {!session.isCurrent && (
            <Button theme="borderless" type="danger" size="small" onClick={() => {
              Modal.confirm({
                title: '确定要退出该设备吗？',
                okButtonProps: { type: 'danger', theme: 'solid' },
                onOk: () => onKick(session.tokenId),
              });
            }}>退出</Button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ProfilePage({ user, onUserUpdate }: ProfilePageProps) {
  const [activeSection, setActiveSection] = useState<SectionKey>('profile');

  // ─── 基本信息 ────────────────────────────────────────────────────────────────
  const [profileLoading, setProfileLoading] = useState(false);

  // ─── 头像裁剪 ────────────────────────────────────────────────────────────────
  const cropperRef = useRef<Cropper>(null);
  const [cropperVisible, setCropperVisible] = useState(false);
  const [cropperSrc, setCropperSrc] = useState('');
  const [avatarLoading, setAvatarLoading] = useState(false);

  // ─── 账号安全 ────────────────────────────────────────────────────────────────
  const [pwdLoading, setPwdLoading] = useState(false);
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy | null>(null);
  const [oauthAccounts, setOauthAccounts] = useState<OAuthAccount[]>([]);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthLoaded, setOauthLoaded] = useState(false);

  // ─── 我的设备 ────────────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [kickOthersLoading, setKickOthersLoading] = useState(false);

  // ─── 操作日志 ────────────────────────────────────────────────────────────────
  const [logTab, setLogTab] = useState<'login' | 'operation'>('login');
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  const [loginLogsLoading, setLoginLogsLoading] = useState(false);
  const [loginLogsPage, setLoginLogsPage] = useState(1);
  const [loginLogsTotal, setLoginLogsTotal] = useState(0);
  const [operationLogs, setOperationLogs] = useState<OperationLog[]>([]);
  const [operationLogsLoading, setOperationLogsLoading] = useState(false);
  const [operationLogsPage, setOperationLogsPage] = useState(1);
  const [operationLogsTotal, setOperationLogsTotal] = useState(0);

  // ─── API Token ───────────────────────────────────────────────────────────────
  const [apiTokens, setApiTokens] = useState<UserApiToken[]>([]);
  const [apiTokensLoading, setApiTokensLoading] = useState(false);
  const [newTokenVisible, setNewTokenVisible] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenCreating, setNewTokenCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<UserApiTokenCreated | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  useEffect(() => {
    request.get<PasswordPolicy>('/api/system-configs/password-policy')
      .then((res) => { if (res.code === 0) setPasswordPolicy(res.data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeSection === 'security' && !oauthLoaded) void fetchOauthAccounts();
    if (activeSection === 'devices') void fetchSessions();
    if (activeSection === 'logs' && !logsLoaded) { void fetchLoginLogs(1); setLogsLoaded(true); }
    if (activeSection === 'api-tokens') void fetchApiTokens();
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== 'logs') return;
    if (logTab === 'login') void fetchLoginLogs(loginLogsPage);
    else void fetchOperationLogs(operationLogsPage);
  }, [logTab]);

  // ─── 数据获取 ────────────────────────────────────────────────────────────────

  async function fetchOauthAccounts() {
    setOauthLoading(true);
    const res = await request.get<OAuthAccount[]>('/api/auth/oauth/accounts');
    setOauthLoading(false);
    if (res.code === 0 && res.data) { setOauthAccounts(res.data); setOauthLoaded(true); }
  }

  async function fetchSessions() {
    setSessionsLoading(true);
    const res = await request.get<UserSession[]>('/api/auth/my-sessions');
    setSessionsLoading(false);
    if (res.code === 0 && res.data) setSessions(res.data);
  }

  async function fetchLoginLogs(page = 1) {
    setLoginLogsLoading(true);
    const res = await request.get<{ list: LoginLog[]; total: number }>(`/api/auth/my-login-logs?page=${page}&pageSize=10`);
    setLoginLogsLoading(false);
    if (res.code === 0 && res.data) {
      setLoginLogs(res.data.list);
      setLoginLogsTotal(res.data.total);
      setLoginLogsPage(page);
    }
  }

  async function fetchOperationLogs(page = 1) {
    setOperationLogsLoading(true);
    const res = await request.get<{ list: OperationLog[]; total: number }>(`/api/auth/my-operation-logs?page=${page}&pageSize=10`);
    setOperationLogsLoading(false);
    if (res.code === 0 && res.data) {
      setOperationLogs(res.data.list);
      setOperationLogsTotal(res.data.total);
      setOperationLogsPage(page);
    }
  }

  async function fetchApiTokens() {
    setApiTokensLoading(true);
    const res = await request.get<UserApiToken[]>('/api/api-tokens');
    setApiTokensLoading(false);
    if (res.code === 0 && res.data) setApiTokens(res.data);
  }

  // ─── 事件处理 ────────────────────────────────────────────────────────────────

  async function handleUpdateProfile(values: { nickname: string; email: string }) {
    setProfileLoading(true);
    const res = await request.put<Omit<UserType, 'password'>>('/api/auth/profile', values);
    setProfileLoading(false);
    if (res.code === 0) { Toast.success('资料已更新'); onUserUpdate(res.data); }
  }

  async function handleChangePassword(values: { oldPassword: string; newPassword: string; confirmPassword: string }) {
    if (values.newPassword !== values.confirmPassword) { Toast.error('两次密码输入不一致'); return; }
    setPwdLoading(true);
    const res = await request.put('/api/auth/password', { oldPassword: values.oldPassword, newPassword: values.newPassword });
    setPwdLoading(false);
    if (res.code === 0) Toast.success('密码修改成功，请重新登录');
  }

  async function handleOAuthBind(provider: OAuthProviderType) {
    const res = await request.get<{ authUrl: string; state: string }>(`/api/auth/oauth/${provider}`);
    if (res.code === 0 && res.data?.authUrl) {
      sessionStorage.setItem('oauth_bind_provider', provider);
      globalThis.location.href = res.data.authUrl;
    }
  }

  async function handleOAuthUnbind(provider: OAuthProviderType) {
    const res = await request.delete(`/api/auth/oauth/unbind/${provider}`);
    if (res.code === 0) { Toast.success('已解绑'); setOauthAccounts((prev) => prev.filter((a) => a.provider !== provider)); }
  }

  function handleAvatarFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropperSrc(URL.createObjectURL(file));
    setCropperVisible(true);
    e.target.value = '';
  }

  function closeCropper() {
    setCropperVisible(false);
    if (cropperSrc) { URL.revokeObjectURL(cropperSrc); setCropperSrc(''); }
  }

  async function handleCropConfirm() {
    const canvas = cropperRef.current?.getCropperCanvas();
    if (!canvas) return;
    setAvatarLoading(true);
    canvas.toBlob(async (blob) => {
      if (!blob) { setAvatarLoading(false); return; }
      const formData = new FormData();
      formData.append('file', blob, 'avatar.jpg');
      const uploadRes = await request.post<{ url: string }>('/api/files/upload', formData);
      if (uploadRes.code === 0 && uploadRes.data?.url) {
        const profileRes = await request.put<Omit<UserType, 'password'>>('/api/auth/profile', { avatar: uploadRes.data.url });
        if (profileRes.code === 0) { onUserUpdate(profileRes.data); Toast.success('头像已更新'); closeCropper(); }
        else Toast.error(profileRes.message ?? '头像更新失败');
      } else {
        Toast.error(uploadRes.message ?? '上传失败');
      }
      setAvatarLoading(false);
    }, 'image/jpeg', 0.85);
  }

  async function handleKickOthers() {
    setKickOthersLoading(true);
    const res = await request.delete<{ count: number }>('/api/auth/my-sessions/others');
    setKickOthersLoading(false);
    if (res.code === 0) { Toast.success(res.message || '操作成功'); void fetchSessions(); }
  }

  async function handleKickSession(tokenId: string) {
    const res = await request.delete(`/api/auth/my-sessions/${tokenId}`);
    if (res.code === 0) { Toast.success('已退出该设备'); setSessions((prev) => prev.filter((s) => s.tokenId !== tokenId)); }
  }

  async function handleCreateToken() {
    if (!newTokenName.trim()) { Toast.error('请填写 Token 名称'); return; }
    setNewTokenCreating(true);
    const res = await request.post<UserApiTokenCreated>('/api/api-tokens', { name: newTokenName.trim() });
    setNewTokenCreating(false);
    if (res.code === 0) {
      setCreatedToken(res.data);
      setNewTokenName('');
      setNewTokenVisible(false);
      void fetchApiTokens();
    }
  }

  async function handleDeleteToken(id: number) {
    const res = await request.delete(`/api/api-tokens/${id}`);
    if (res.code === 0) { Toast.success('Token 已撤销'); setApiTokens((prev) => prev.filter((t) => t.id !== id)); }
  }

  function copyToken(token: string) {
    void navigator.clipboard.writeText(token).then(() => {
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    });
  }

  // ─── 静态配置 ────────────────────────────────────────────────────────────────

  const PROVIDER_INFO: Record<OAuthProviderType, { label: string; icon: React.ReactNode }> = {
    github: { label: 'GitHub', icon: <Icon icon="simple-icons:github" width="16" height="16" /> },
    dingtalk: { label: '钉钉', icon: <Icon icon="ant-design:dingtalk-outlined" width="16" height="16" /> },
    wechat_work: { label: '企业微信', icon: <Icon icon="ant-design:wechat-work-filled" width="16" height="16" /> },
  };

  return (
    <div className="page-container">
      <div className="profile-layout">

        {/* ── 左侧头像卡片 ────────────────────────────────────────────────── */}
        <Card className="profile-avatar-card">
          <div className="profile-avatar-section">
            <button
              type="button"
              className="avatar-upload-trigger"
              onClick={() => document.getElementById('avatar-file-input')?.click()}
            >
              {avatarLoading ? (
                <div className="avatar-loading-wrapper" style={{ width: 80, height: 80 }}><Spin /></div>
              ) : (
                <>
                  <Avatar
                    size="extra-large"
                    color="blue"
                    style={{ fontSize: 28, width: 80, height: 80 }}
                    src={user.avatar || undefined}
                  >
                    {!user.avatar && (user.nickname?.charAt(0)?.toUpperCase() || 'U')}
                  </Avatar>
                  <div className="avatar-upload-mask">更换头像</div>
                </>
              )}
            </button>
            <input
              id="avatar-file-input"
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleAvatarFileSelect}
            />
            <Title heading={5} style={{ margin: '12px 0 4px' }}>{user.nickname}</Title>
            <Text type="tertiary" size="small">@{user.username}</Text>
            <div className="profile-meta">
              <Text type="tertiary" size="small">邮箱：{user.email}</Text>
              <Text type="tertiary" size="small">
                角色：{user.roles?.length ? (
                  <Space spacing={4} style={{ display: 'inline-flex' }}>
                    {user.roles.map((r) => <Tag key={r.id} size="small" color="blue">{r.name}</Tag>)}
                  </Space>
                ) : '无角色'}
              </Text>
              <Text type="tertiary" size="small">注册时间：{formatDateTime(user.createdAt)}</Text>
            </div>
          </div>
        </Card>

        {/* ── 右侧：Semi Tabs 垂直导航 ──────────────────────────────── */}
        <Card className="profile-content-card" bodyStyle={{ padding: 0 }}>
          <Tabs
            tabPosition="left"
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
                  <Form
                    initValues={{ nickname: user.nickname, email: user.email }}
                    onSubmit={handleUpdateProfile}
                    labelPosition="left"
                    labelWidth={80}
                  >
                    <Form.Input
                      field="nickname"
                      label="昵称"
                      rules={[{ required: true, message: '昵称不能为空' }]}
                      style={{ width: 320 }}
                    />
                    <Form.Input
                      field="email"
                      label="邮箱"
                      rules={[
                        { required: true, message: '邮箱不能为空' },
                        { type: 'email', message: '邮箱格式不正确' },
                      ]}
                      style={{ width: 320 }}
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
                      mode="password"
                      rules={[{ required: true, message: '请输入原密码' }]}
                      style={{ width: 320 }}
                    />
                    <Form.Input
                      field="newPassword"
                      label="新密码"
                      mode="password"
                      rules={[
                        { required: true, message: '请输入新密码' },
                        ...(passwordPolicy?.minLength ? [{ min: passwordPolicy.minLength, message: `密码至少${passwordPolicy.minLength}个字符` }] : []),
                      ]}
                      style={{ width: 320 }}
                      helpText={formatPasswordPolicyHint(passwordPolicy)}
                    />
                    <Form.Input
                      field="confirmPassword"
                      label="确认密码"
                      mode="password"
                      rules={[{ required: true, message: '请确认新密码' }]}
                      style={{ width: 320 }}
                    />
                    <Form.Slot>
                      <Button htmlType="submit" type="primary" loading={pwdLoading}>修改密码</Button>
                    </Form.Slot>
                  </Form>

                  <div className="section-divider" />

                  <div className="section-title">第三方账号绑定</div>
                  {oauthLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {(['github', 'dingtalk', 'wechat_work'] as OAuthProviderType[]).map((provider) => {
                        const info = PROVIDER_INFO[provider];
                        const bound = oauthAccounts.find((a) => a.provider === provider);
                        return (
                          <div key={provider} className="oauth-item">
                            <Space>
                              {info.icon}
                              <Text strong>{info.label}</Text>
                              {bound ? (
                                <Tag color="green" size="small">已绑定 · {bound.nickname || bound.openId}</Tag>
                              ) : (
                                <Tag color="grey" size="small">未绑定</Tag>
                              )}
                            </Space>
                            {bound ? (
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
                          </div>
                        );
                      })}
                    </div>
                  )}
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
                  {sessionsLoading ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                  ) : (
                    <SessionList sessions={sessions} onKick={handleKickSession} />
                  )}
              </div>
            </Tabs.TabPane>

            {/* ── 操作日志 ──────────────────────────────────────── */}
            <Tabs.TabPane
              itemKey="logs"
              tab={<span className="profile-tab-label"><List size={14} /><span>操作日志</span></span>}
            >
              <div className="profile-section">
                <Tabs
                  activeKey={logTab}
                  onChange={(v) => setLogTab(v as 'login' | 'operation')}
                  size="small"
                >
                  <Tabs.TabPane itemKey="login" tab="登录记录">
                    <Table
                      bordered
                      loading={loginLogsLoading}
                      dataSource={loginLogs}
                      rowKey="id"
                      pagination={{
                        total: loginLogsTotal,
                        currentPage: loginLogsPage,
                        pageSize: 10,
                        showSizeChanger: false,
                        onPageChange: (page) => void fetchLoginLogs(page),
                      }}
                      columns={[
                        { title: '登录时间', dataIndex: 'createdAt', render: (v: string) => formatDateTime(v), width: 180 },
                        { title: 'IP', dataIndex: 'ip', width: 140 },
                        { title: '浏览器', dataIndex: 'browser' },
                        { title: '操作系统', dataIndex: 'os' },
                        {
                          title: '状态', dataIndex: 'status', width: 80,
                          render: (v: string) => <Tag color={v === 'success' ? 'green' : 'red'} size="small">{v === 'success' ? '成功' : '失败'}</Tag>,
                        },
                      ]}
                    />
                  </Tabs.TabPane>
                  <Tabs.TabPane itemKey="operation" tab="操作记录">
                    <Table
                      bordered
                      loading={operationLogsLoading}
                      dataSource={operationLogs}
                      rowKey="id"
                      pagination={{
                        total: operationLogsTotal,
                        currentPage: operationLogsPage,
                        pageSize: 10,
                        showSizeChanger: false,
                        onPageChange: (page) => void fetchOperationLogs(page),
                      }}
                      columns={[
                        { title: '操作时间', dataIndex: 'createdAt', render: (v: string) => formatDateTime(v), width: 180 },
                        { title: '操作模块', dataIndex: 'module', width: 120 },
                        { title: '操作描述', dataIndex: 'description' },
                        { title: '请求方法', dataIndex: 'method', width: 90 },
                      ]}
                    />
                  </Tabs.TabPane>
                </Tabs>
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
                    <Table
                      bordered
                      dataSource={apiTokens}
                      rowKey="id"
                      pagination={false}
                      columns={[
                        { title: '名称', dataIndex: 'name', render: (v: string) => <Text strong>{v}</Text> },
                        { title: 'Token 前缀', dataIndex: 'tokenPrefix', render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code> },
                        { title: '最后使用', dataIndex: 'lastUsedAt', render: (v: string | null) => v ? formatDateTime(v) : '未使用', width: 180 },
                        { title: '过期时间', dataIndex: 'expiresAt', render: (v: string | null) => v ? formatDateTime(v) : '永久有效', width: 180 },
                        { title: '创建时间', dataIndex: 'createdAt', render: (v: string) => formatDateTime(v), width: 180 },
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
        </Card>
      </div>

      {/* ── 头像裁剪 Modal ──────────────────────────────────────────────────── */}
      <Modal
        title="裁剪头像"
        visible={cropperVisible}
        onCancel={closeCropper}
        footer={
          <Space>
            <Button onClick={closeCropper}>取消</Button>
            <Button type="primary" loading={avatarLoading} onClick={handleCropConfirm}>确认并上传</Button>
          </Space>
        }
        width={520}
        centered
      >
        <div style={{ width: '100%', height: 380 }}>
          {cropperSrc && (
            <Cropper
              ref={cropperRef}
              src={cropperSrc}
              shape="round"
              aspectRatio={1}
              showResizeBox
              style={{ width: '100%', height: '100%' }}
            />
          )}
        </div>
      </Modal>

      {/* ── 新建 Token Modal ────────────────────────────────────────────────── */}
      <Modal
        title="新建 API Token"
        visible={newTokenVisible}
        onCancel={() => { setNewTokenVisible(false); setNewTokenName(''); }}
        footer={
          <Space>
            <Button onClick={() => { setNewTokenVisible(false); setNewTokenName(''); }}>取消</Button>
            <Button type="primary" loading={newTokenCreating} onClick={handleCreateToken}>创建</Button>
          </Space>
        }
        width={480}
        centered
      >
        <Form labelPosition="left" labelWidth={90}>
          <Form.Slot label="Token 名称">
            <Input
              value={newTokenName}
              onChange={setNewTokenName}
              placeholder="如：本地开发、CI/CD 环境"
              style={{ width: '100%' }}
            />
          </Form.Slot>
        </Form>
      </Modal>

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
