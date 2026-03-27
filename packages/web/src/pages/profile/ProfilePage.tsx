import { useState, useEffect } from 'react';
import {
  Card, Form, Button, Typography, Tabs, TabPane, Toast, Avatar, Tag, Space, Upload, Spin, Table, Popconfirm,
} from '@douyinfe/semi-ui';
// import removed
import { Icon } from '@iconify/react';

import type { User, LoginLog, OperationLog, OAuthAccount, OAuthProviderType } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { formatPasswordPolicyHint, type PasswordPolicy } from '@/utils/password-policy';
import './ProfilePage.css';

const { Title, Text } = Typography;

interface ProfilePageProps {
  readonly user: Omit<User, 'password'>;
  readonly onUserUpdate: (user: Omit<User, 'password'>) => void;
}

export default function ProfilePage({ user, onUserUpdate }: ProfilePageProps) {
  const [profileLoading, setProfileLoading] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy | null>(null);

  // 获取密码策略
  useEffect(() => {
    request
      .get<PasswordPolicy>('/api/system-configs/password-policy')
      .then((res) => {
        if (res.code === 0) setPasswordPolicy(res.data);
      })
      .catch(() => {
        // 请求失败时保持使用默认策略（null），避免未处理的 Promise 拒绝
        setPasswordPolicy(null);
      });
  }, []);

  // 登录记录
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  const [loginLogsLoading, setLoginLogsLoading] = useState(false);
  const [loginLogsLoaded, setLoginLogsLoaded] = useState(false);
  const [loginLogsPage, setLoginLogsPage] = useState(1);
  const [loginLogsTotal, setLoginLogsTotal] = useState(0);

  // 操作记录
  const [operationLogs, setOperationLogs] = useState<OperationLog[]>([]);
  const [operationLogsLoading, setOperationLogsLoading] = useState(false);
  const [operationLogsLoaded, setOperationLogsLoaded] = useState(false);
  const [operationLogsPage, setOperationLogsPage] = useState(1);
  const [operationLogsTotal, setOperationLogsTotal] = useState(0);

  // OAuth 绑定
  const [oauthAccounts, setOauthAccounts] = useState<OAuthAccount[]>([]);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthLoaded, setOauthLoaded] = useState(false);

  async function fetchLoginLogs(page = 1) {
    setLoginLogsLoading(true);
    const res = await request.get<{ list: LoginLog[]; total: number }>(`/api/auth/my-login-logs?page=${page}&pageSize=10`);
    setLoginLogsLoading(false);
    if (res.code === 0 && res.data) {
      setLoginLogs(res.data.list);
      setLoginLogsTotal(res.data.total);
      setLoginLogsPage(page);
      setLoginLogsLoaded(true);
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
      setOperationLogsLoaded(true);
    }
  }

  function handleTabChange(key: string) {
    if (key === 'login-logs' && !loginLogsLoaded) void fetchLoginLogs();
    if (key === 'operation-logs' && !operationLogsLoaded) void fetchOperationLogs();
    if (key === 'oauth-accounts' && !oauthLoaded) void fetchOauthAccounts();
  }

  async function fetchOauthAccounts() {
    setOauthLoading(true);
    const res = await request.get<OAuthAccount[]>('/api/auth/oauth/accounts');
    setOauthLoading(false);
    if (res.code === 0 && res.data) {
      setOauthAccounts(res.data);
      setOauthLoaded(true);
    }
  }

  const PROVIDER_INFO: Record<OAuthProviderType, { label: string; icon: React.ReactNode }> = {
    github: { label: 'GitHub', icon: <Icon icon="simple-icons:github" width="16" height="16" /> },
    dingtalk: { label: '钉钉', icon: <Icon icon="ant-design:dingtalk-outlined" width="16" height="16" /> },
    wechat_work: { label: '企业微信', icon: <Icon icon="ant-design:wechat-work-filled" width="16" height="16" /> },
  };

  async function handleOAuthBind(provider: OAuthProviderType) {
    const res = await request.get<{ authUrl: string; state: string }>(`/api/auth/oauth/${provider}`);
    if (res.code === 0 && res.data?.authUrl) {
      // 绑定流程：先记录当前页面，OAuth 回调后回来
      sessionStorage.setItem('oauth_bind_provider', provider);
      globalThis.location.href = res.data.authUrl;
    }
  }

  async function handleOAuthUnbind(provider: OAuthProviderType) {
    const res = await request.delete(`/api/auth/oauth/unbind/${provider}`);
    if (res.code === 0) {
      Toast.success('已解绑');
      setOauthAccounts((prev) => prev.filter((a) => a.provider !== provider));
    }
  }

  async function handleUpdateProfile(values: { nickname: string; email: string }) {
    setProfileLoading(true);
    const res = await request.put<Omit<User, 'password'>>('/api/auth/profile', values);
    setProfileLoading(false);
    if (res.code === 0) {
      Toast.success('资料已更新');
      onUserUpdate(res.data);
    }
  }

  async function handleChangePassword(values: { oldPassword: string; newPassword: string; confirmPassword: string }) {
    if (values.newPassword !== values.confirmPassword) {
      Toast.error('两次密码输入不一致');
      return;
    }
    setPwdLoading(true);
    const res = await request.put('/api/auth/password', {
      oldPassword: values.oldPassword,
      newPassword: values.newPassword,
    });
    setPwdLoading(false);
    if (res.code === 0) {
      Toast.success('密码修改成功，请重新登录');
    }
  }

  return (
    <div className="page-container">
      <div className="profile-layout">
        {/* 左侧：头像卡片 */}
        <Card className="profile-avatar-card">
          <div className="profile-avatar-section">
            <Upload
              className="avatar-upload"
              showUploadList={false}
              accept="image/*"
              limit={1}
              customRequest={({ file, onSuccess, onError }) => {
                setAvatarLoading(true);
                const formData = new FormData();
                formData.append('file', file.fileInstance as File);
                request.post<{ url: string }>('/api/files/upload', formData)
                  .then(async (res) => {
                    if (res.code === 0 && res.data?.url) {
                      const profileRes = await request.put<Omit<User, 'password'>>('/api/auth/profile', { avatar: res.data.url });
                      if (profileRes.code === 0) {
                        onUserUpdate(profileRes.data);
                        Toast.success('头像已更新');
                        onSuccess?.(res);
                      } else {
                        Toast.error(profileRes.message ?? '头像更新失败');
                        onError?.({ status: profileRes.code }, new Event('error'));
                      }
                    } else {
                      Toast.error(res.message ?? '上传失败');
                      onError?.({ status: res.code }, new Event('error'));
                    }
                  })
                  .catch(() => {
                    Toast.error('上传失败，请重试');
                    onError?.({ status: 500 }, new Event('error'));
                  })
                  .finally(() => setAvatarLoading(false));
              }}
            >
              <div className="avatar-upload-trigger">
                {avatarLoading ? (
                  <div className="avatar-loading-wrapper" style={{ width: 80, height: 80 }}>
                    <Spin />
                  </div>
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
              </div>
            </Upload>
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
              <Text type="tertiary" size="small">
                注册时间：{formatDateTime(user.createdAt)}
              </Text>
            </div>
          </div>
        </Card>

        {/* 右侧：表单 */}
        <Card className="profile-form-card">
          <Tabs type="line" onChange={handleTabChange}>
            <TabPane tab="基本信息" itemKey="profile">
              <div className="profile-tab-content">
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
                    <Button htmlType="submit" type="primary" loading={profileLoading}>
                      保存修改
                    </Button>
                  </Form.Slot>
                </Form>
              </div>
            </TabPane>

            <TabPane tab="修改密码" itemKey="password">
              <div className="profile-tab-content">
                <Form onSubmit={handleChangePassword} labelPosition="left" labelWidth={80}>
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
                      ...(passwordPolicy?.minLength
                        ? [{ min: passwordPolicy.minLength, message: `密码至少${passwordPolicy.minLength}个字符` }]
                        : []),
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
                    <Button htmlType="submit" type="primary" loading={pwdLoading}>
                      修改密码
                    </Button>
                  </Form.Slot>
                </Form>
              </div>
            </TabPane>

            <TabPane tab="登录记录" itemKey="login-logs">
              <div className="profile-tab-content">
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
                    {
                      title: '登录时间',
                      dataIndex: 'createdAt',
                      render: (v: string) => formatDateTime(v),
                      width: 180,
                    },
                    { title: 'IP', dataIndex: 'ip', width: 140 },
                    { title: '浏览器', dataIndex: 'browser' },
                    { title: '操作系统', dataIndex: 'os' },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 80,
                      render: (v: string) => (
                        <Tag color={v === 'success' ? 'green' : 'red'} size="small">
                          {v === 'success' ? '成功' : '失败'}
                        </Tag>
                      ),
                    },
                  ]}
                />
              </div>
            </TabPane>

            <TabPane tab="操作记录" itemKey="operation-logs">
              <div className="profile-tab-content">
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
                    {
                      title: '操作时间',
                      dataIndex: 'createdAt',
                      render: (v: string) => formatDateTime(v),
                      width: 180,
                    },
                    { title: '操作模块', dataIndex: 'module', width: 120 },
                    { title: '操作描述', dataIndex: 'description' },
                    { title: '请求方法', dataIndex: 'method', width: 90 },
                  ]}
                />
              </div>
            </TabPane>

            <TabPane tab="账号绑定" itemKey="oauth-accounts">
              <div className="profile-tab-content">
                {oauthLoading ? (
                  <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(['github', 'dingtalk', 'wechat_work'] as OAuthProviderType[]).map((provider) => {
                      const info = PROVIDER_INFO[provider];
                      const bound = oauthAccounts.find((a) => a.provider === provider);
                      return (
                        <div
                          key={provider}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 16px',
                            borderRadius: 8,
                            border: '1px solid var(--semi-color-border)',
                          }}
                        >
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
                            <Popconfirm title={`确定要解绑 ${info.label} 账号吗？`} onConfirm={() => handleOAuthUnbind(provider)}>
                              <Button theme="borderless" type="danger" size="small">解绑</Button>
                            </Popconfirm>
                          ) : (
                            <Button theme="borderless" size="small" onClick={() => handleOAuthBind(provider)}>绑定</Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </TabPane>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
