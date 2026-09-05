import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Form, Button, Toast, Typography, Tabs, TabPane, Divider, Spin } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { User, Lock, Mail, AtSign, Building2, ShieldCheck, BriefcaseBusiness, Check, ChevronRight } from 'lucide-react';
import dayjs from 'dayjs';
import { MAX_STORED_ACCOUNTS, REFRESH_TOKEN_KEY, TOKEN_KEY } from '@zenith/shared/core';
import { OAUTH_PROVIDER_LABELS, enterpriseAuthContract, oauthContract } from '@zenith/shared/identity';
import type { RegisterInput, OAuthProviderType, LoginResult, LoginResponse, MfaLoginChallenge, TenantIdentityProviderSummary } from '@zenith/shared/identity';
import { api } from '@/lib/contract-query';
import { ApiError } from '@/lib/query';
import { AUTH_INVALIDATED_REASON_KEY } from '@/utils/http-client';
import { config } from '@/config';
import { markPostLoginHome } from '@/lib/post-login';
import { readMfaHandoff } from '@/lib/mfa-handoff';
import { rememberOAuthPending } from '@/lib/oauth-pending';
import { useAuth, type LoginOptions } from '@/hooks/useAuth';
import { UserAvatar } from '@/components/UserAvatar';
import AppLogo from '@/components/AppLogo';
import AppModal from '@/components/AppModal';
import { OAuthProviderIcon } from '@/components/OAuthProviderIcon';
import ForgotPasswordModal from './ForgotPasswordModal';
import { useEnterpriseProviders, useOAuthProviders, usePublicCaptcha } from '@/hooks/queries/auth-public';
import { usePublicSettings } from '@/hooks/queries/settings';
import { useDebouncedValue } from '@tanstack/react-pacer';
import './LoginPage.css';

const { Title, Text } = Typography;

interface LoginPageProps {
  onLogin: (username: string, password: string, captchaId?: string, captchaCode?: string, tenantCode?: string, options?: LoginOptions) => Promise<{ code: number; message: string; retryAfterSeconds?: number; data: LoginResult }>;
  onVerifyMfa: (challengeId: string, code: string, rememberDevice: boolean, options?: LoginOptions) => Promise<{ code: number; message: string; retryAfterSeconds?: number; data: LoginResponse }>;
  onRegister: (data: { username: string; nickname: string; email: string; password: string }, options?: LoginOptions) => Promise<{ code: number; message: string; retryAfterSeconds?: number }>;
}

function isMfaChallenge(data: LoginResult): data is MfaLoginChallenge {
  return 'mfaRequired' in data && data.mfaRequired;
}

export default function LoginPage({ onLogin, onVerifyMfa, onRegister }: Readonly<LoginPageProps>) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  // 企业 SSO 回调页命中 MFA 时经 location.state 交接挑战，复用本页验证表单
  const mfaHandoff = readMfaHandoff(location.state);
  const redirectTo = mfaHandoff?.redirectTo || params.get('redirect') || '/';
  // 添加账号模式：保留当前登录，成功后停靠原账号并整页切换为新账号
  const addAccountMode = params.get('add_account') === '1';
  const prefillUsername = params.get('username') ?? '';
  const loginOptions: LoginOptions | undefined = addAccountMode ? { addAccount: true } : undefined;
  const { status: authStatus, parkedAccounts, canAddAccount, switchAccount } = useAuth();
  const [resumingId, setResumingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('login');
  const [retrySeconds, setRetrySeconds] = useState(0);

  // 登录成功后的统一跳转：落地首页时打标记，供 HomeEntry 按偏好 homePath 二次跳转
  const navigateAfterLogin = (target: string) => {
    if (target === '/') markPostLoginHome();
    navigate(target, { replace: true });
  };

  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = setInterval(() => {
      setRetrySeconds((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [retrySeconds]);

  // 被动下线（过期/他端注销/管理员强退）落地登录页时说明原因，避免被当成系统故障
  useEffect(() => {
    try {
      const reason = sessionStorage.getItem(AUTH_INVALIDATED_REASON_KEY);
      if (reason) {
        sessionStorage.removeItem(AUTH_INVALIDATED_REASON_KEY);
        Toast.warning({ content: reason, duration: 6 });
      }
    } catch {
      // sessionStorage 不可用时跳过
    }
  }, []);
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

  const captchaQuery = usePublicCaptcha();
  const [forgotPasswordVisible, setForgotPasswordVisible] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<MfaLoginChallenge | null>(mfaHandoff?.mfaChallenge ?? null);
  const [tenantCode, setTenantCode] = useState('');
  const [debouncedTenantCode] = useDebouncedValue(tenantCode, { wait: 250 });
  const [directoryProvider, setDirectoryProvider] = useState<TenantIdentityProviderSummary | null>(null);
  const [directoryLoginLoading, setDirectoryLoginLoading] = useState(false);
  const directoryFormApi = useRef<FormApi | null>(null);

  const enterpriseProvidersQuery = useEnterpriseProviders(debouncedTenantCode);
  // 匿名设置投影（注册 / 找回密码开关）：多租户下随租户编码解析租户级值
  const publicSettingsQuery = usePublicSettings(debouncedTenantCode);
  const oauthProvidersQuery = useOAuthProviders();
  const captchaEnabled = captchaQuery.data?.enabled ?? false;
  const captchaId = captchaQuery.data?.captchaId ?? '';
  const captchaSvg = captchaQuery.data?.svg ?? '';
  const allowRegistration = publicSettingsQuery.data?.auth.allowRegistration ?? false;
  const forgotPasswordEnabled = publicSettingsQuery.data?.auth.forgotPasswordEnabled ?? false;
  const enterpriseProviders = enterpriseProvidersQuery.data?.providers ?? [];
  // 加载中 / 后端不可达 / 未启用任何提供方 → 空数组 → 不渲染「其他方式登录」
  const oauthProviders = oauthProvidersQuery.data ?? [];
  const fetchCaptcha = () => { void captchaQuery.refetch(); };

  const handleLogin = async (values: Record<string, string>) => {
    if (retrySeconds > 0) return;
    setLoading(true);
    try {
      const res = await onLogin(values.username, values.password, captchaId, values.captchaCode, values.tenantCode, loginOptions);
      if (res.code === 0) {
        if (isMfaChallenge(res.data)) {
          setMfaChallenge(res.data);
          return;
        }
        if (addAccountMode) return; // 添加账号成功后由 AuthProvider 整页重载接管
        navigateAfterLogin(redirectTo);
        return;
      }
      if (res.code === 429 && res.retryAfterSeconds) {
        setRetrySeconds(res.retryAfterSeconds);
      }
      Toast.error(res.message);
      if (captchaEnabled) fetchCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerify = async (values: Record<string, string | boolean>) => {
    if (!mfaChallenge || retrySeconds > 0) return;
    setLoading(true);
    try {
      const res = await onVerifyMfa(mfaChallenge.challengeId, String(values.code ?? ''), Boolean(values.rememberDevice), loginOptions);
      if (res.code === 0) {
        if (addAccountMode) return;
        navigateAfterLogin(redirectTo);
        return;
      }
      Toast.error(res.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: RegisterInput) => {
    if (retrySeconds > 0) return;
    setLoading(true);
    try {
      const res = await onRegister(values, loginOptions);
      if (res.code === 0) {
        if (addAccountMode) return;
        navigateAfterLogin(redirectTo);
        return;
      }
      if (res.code === 429 && res.retryAfterSeconds) {
        setRetrySeconds(res.retryAfterSeconds);
      }
      Toast.error(res.message);
    } finally {
      setLoading(false);
    }
  };

  /** 登录页快捷入口：一键回到某个仍在登录状态的停靠账号 */
  const handleResumeAccount = async (userId: number) => {
    if (resumingId !== null) return;
    setResumingId(userId);
    try {
      const result = await switchAccount(userId);
      if (result.ok) return; // 成功后整页重载
      Toast.warning(result.message || '该账号登录状态已失效，请重新登录');
    } finally {
      setResumingId(null);
    }
  };

  const renderLoginForm = () => (
    <Form onSubmit={handleLogin} initValues={prefillUsername ? { username: prefillUsername } : undefined} style={{ marginTop: 12 }}>
      {config.multiTenantMode && (
        <Form.Input
          field="tenantCode"
          label="租户编码"
          placeholder="留空则登录平台管理员"
          prefix={<Building2 />}
          size="large"
          onChange={setTenantCode}
        />
      )}
      <Form.Input
        field="username"
        noLabel
        placeholder="请输入用户名/手机号"
        prefix={<User />}
        rules={[{ required: true, message: '请输入用户名/手机号' }]}
        size="large"
      />
      <Form.Input
        field="password"
        noLabel
        type="password"
        placeholder="请输入密码"
        prefix={<Lock />}
        rules={[{ required: true, message: '请输入密码' }]}
        size="large"
      />
      {captchaEnabled && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <Form.Input
              field="captchaCode"
              noLabel
              placeholder="请输入验证码"
              rules={[{ required: true, message: '请输入验证码' }]}
              size="large"
            />
          </div>
          <button
            type="button"
            style={{
              cursor: 'pointer',
              marginTop: 28,
              flexShrink: 0,
              borderRadius: 'var(--semi-border-radius-small)',
              overflow: 'hidden',
              border: '1px solid var(--semi-color-border)',
              padding: 0,
              background: 'transparent',
              lineHeight: 0,
            }}
            title="点击刷新验证码"
            onClick={fetchCaptcha}
          >
            <div dangerouslySetInnerHTML={{ __html: captchaSvg }} />
          </button>
        </div>
      )}
      <Button
        htmlType="submit"
        type="primary"
        theme="solid"
        loading={loading}
        disabled={retrySeconds > 0 || (addAccountMode && !canAddAccount)}
        block
        size="large"
        style={{ marginTop: 8, borderRadius: 'var(--semi-border-radius-medium)', height: 42 }}
      >
        {retrySeconds > 0 ? `${retrySeconds}s 后可重试` : '登录'}
      </Button>
      {forgotPasswordEnabled && (
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <Button
            type="tertiary"
            theme="borderless"
            size="small"
            onClick={() => setForgotPasswordVisible(true)}
          >
            忘记密码？
          </Button>
        </div>
      )}
    </Form>
  );

  const renderMfaForm = () => (
    <Form onSubmit={handleMfaVerify} initValues={{ rememberDevice: true }} style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--semi-border-radius-medium)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--semi-color-primary)',
          background: 'var(--semi-color-primary-light-default)',
        }}>
          <ShieldCheck size={18} />
        </div>
        <div>
          <Text strong>需要二次验证</Text>
          <Text type="tertiary" size="small" style={{ display: 'block' }}>
            {mfaChallenge?.reason || '请输入身份验证器中的 6 位动态码'}
          </Text>
        </div>
      </div>
      <Form.PinCode
        field="code"
        noLabel
        count={6}
        rules={[{ required: true, message: '请输入动态验证码' }]}
        size="large"
      />
      <Form.Checkbox field="rememberDevice" noLabel>
        信任此设备，减少二次验证
      </Form.Checkbox>
      <Button
        htmlType="submit"
        type="primary"
        theme="solid"
        loading={loading}
        block
        size="large"
        style={{ marginTop: 8, borderRadius: 'var(--semi-border-radius-medium)', height: 42 }}
      >
        验证并登录
      </Button>
      <Button
        type="tertiary"
        theme="borderless"
        block
        style={{ marginTop: 8 }}
        onClick={() => {
          setMfaChallenge(null);
          if (captchaEnabled) fetchCaptcha();
        }}
      >
        返回账号密码登录
      </Button>
    </Form>
  );

  const renderRegisterForm = () => (
    <Form onSubmit={handleRegister} style={{ marginTop: 12 }}>
      <Form.Input
        field="username"
        noLabel
        placeholder="用户名（3~32 个字符）"
        prefix={<User />}
        rules={[{ required: true, message: '请输入用户名' }]}
        size="large"
      />
      <Form.Input
        field="nickname"
        noLabel
        placeholder="昵称"
        prefix={<AtSign />}
        rules={[{ required: true, message: '请输入昵称' }]}
        size="large"
      />
      <Form.Input
        field="email"
        noLabel
        placeholder="邮箱"
        prefix={<Mail />}
        rules={[{ required: true, type: 'string', message: '请输入邮箱' }]}
        size="large"
      />
      <Form.Input
        field="password"
        noLabel
        type="password"
        placeholder="密码（至少6个字符）"
        prefix={<Lock />}
        rules={[{ required: true, message: '请输入密码' }]}
        size="large"
      />
      <Button
        htmlType="submit"
        type="primary"
        theme="solid"
        loading={loading}
        disabled={retrySeconds > 0}
        block
        size="large"
        style={{ marginTop: 8, borderRadius: 'var(--semi-border-radius-medium)', height: 42 }}
      >
        {retrySeconds > 0 ? `${retrySeconds}s 后可重试` : '注册'}
      </Button>
    </Form>
  );

  let formSubtitle = '请输入您的账号信息以登录工作台';

  const handleOAuthLogin = async (provider: OAuthProviderType) => {
    try {
      const { authUrl, state } = await api(oauthContract.authUrl, { params: { provider } }, { silent: true });
      // 暂存 state：回调页据此校验本次往返是由当前浏览器发起的（防登录 CSRF）
      rememberOAuthPending({ state, provider, intent: 'login', redirectTo });
      globalThis.location.href = authUrl;
    } catch (err) {
      Toast.warning((err instanceof ApiError && err.message) || '该登录方式暂不可用，请联系管理员配置');
    }
  };

  const handleEnterpriseLogin = async (provider: TenantIdentityProviderSummary) => {
    if (provider.type === 'ldap' || provider.type === 'ad') {
      setDirectoryProvider(provider);
      return;
    }
    try {
      const { authUrl } = await api(enterpriseAuthContract.authUrl, { params: { id: provider.id }, query: { redirect: redirectTo } }, { silent: true });
      globalThis.location.href = authUrl;
    } catch (err) {
      Toast.warning((err instanceof ApiError && err.message) || '该企业登录方式暂不可用，请联系管理员配置');
    }
  };

  const handleDirectoryLogin = async (values: Record<string, string>) => {
    if (!directoryProvider) return;
    setDirectoryLoginLoading(true);
    try {
      const { loginResult, redirectTo: nextRedirect } = await api(enterpriseAuthContract.ldapLogin, {
        body: {
          providerId: directoryProvider.id,
          username: values.username,
          password: values.password,
          redirectTo,
        },
      }, { silent: true });
      // 企业 SSO 与密码登录共用 MFA 策略：命中挑战时切到同一套验证表单
      if (isMfaChallenge(loginResult)) {
        setMfaChallenge(loginResult);
        setDirectoryProvider(null);
        directoryFormApi.current = null;
        return;
      }
      localStorage.setItem(TOKEN_KEY, loginResult.token.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, loginResult.token.refreshToken);
      setDirectoryProvider(null);
      navigateAfterLogin(nextRedirect || redirectTo);
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '登录失败');
    } finally {
      setDirectoryLoginLoading(false);
    }
  };

  const closeDirectoryLogin = () => {
    setDirectoryProvider(null);
    directoryFormApi.current = null;
  };

  const handleDirectoryLoginOk = async () => {
    if (!directoryFormApi.current) return;
    let values: Record<string, string>;
    try {
      values = await directoryFormApi.current.validate() as Record<string, string>;
    } catch {
      return;
    }
    await handleDirectoryLogin(values);
  };

  if (mfaChallenge) {
    formSubtitle = '请完成多因素认证以进入工作台';
  } else if (addAccountMode) {
    formSubtitle = canAddAccount
      ? '登录另一个账号，成功后可在右上角账号菜单中随时切换'
      : `最多同时保持 ${MAX_STORED_ACCOUNTS} 个账号登录，请先在账号切换器中退出一个账号`;
  } else if (isDemoMode) {
    formSubtitle = '当前为演示模式，仅开放预置账号登录，页面数据为模拟环境。';
  } else if (tab !== 'login') {
    formSubtitle = '注册新账号加入我们';
  }

  return (
    <div className="login-page">
      <div className="login-bg" aria-hidden="true">
        <div className="login-wash login-wash-a" />
        <div className="login-wash login-wash-b" />
      </div>
      <header className="login-topbar">
        <AppLogo size={34} />
        <span className="login-brand-name">{config.appTitle}</span>
      </header>
      <main className="login-main">
        <section className="login-hero">
          <div className="login-eyebrow">企业级后台管理</div>
          <h1 className="login-headline">
            高效管理，
            <br />
            <span className="login-headline-highlight">赋能业务增长</span>
          </h1>
          <p className="login-desc">
            企业级后台管理系统，为团队提供高效、稳定、安全的一站式管理解决方案。
          </p>
          <div className="login-feature-list">
            {['精细化权限管理', '安全审计机制', '稳定可靠运行', '多租户支持'].map((feature) => (
              <div key={feature} className="login-feature-item">
                <span className="login-feature-check">
                  <Check size={12} strokeWidth={3} />
                </span>
                {feature}
              </div>
            ))}
          </div>
        </section>
        <div className="login-card">
          <div className="login-form-header">
            <Title heading={3} style={{ marginBottom: 8, fontWeight: 600 }}>
              {mfaChallenge ? '安全验证' : addAccountMode ? '添加账号' : (isDemoMode || tab === 'login' ? '欢迎回来' : '创建账号')}
            </Title>
            <Text type="tertiary" style={{ fontSize: 14, display: 'block', marginBottom: 24 }}>
              {formSubtitle}
            </Text>
          </div>
          {/* 快捷账号入口：仍在登录状态的停靠账号一键继续（对齐 GitHub 登录页账号选择） */}
          {!mfaChallenge && !addAccountMode && parkedAccounts.length > 0 && (
            <div className="login-accounts">
              {parkedAccounts.map((account) => (
                <button
                  key={account.userId}
                  type="button"
                  className="login-account-card"
                  disabled={resumingId !== null}
                  onClick={() => void handleResumeAccount(account.userId)}
                >
                  <UserAvatar name={account.nickname || account.username} avatar={account.avatar} semiSize="default" size={36} />
                  <span className="login-account-meta">
                    <span className="login-account-name">{account.nickname || account.username}</span>
                    <span className="login-account-sub">
                      {account.username}
                      {account.tenantName ? ` · ${account.tenantName}` : ''}
                    </span>
                  </span>
                  {resumingId === account.userId ? <Spin size="small" /> : <ChevronRight size={16} className="login-account-arrow" />}
                </button>
              ))}
              <Divider align="center">
                <span className="login-oauth-label">或使用其他账号登录</span>
              </Divider>
            </div>
          )}
          {mfaChallenge ? (
            <div style={{ marginBottom: 20 }}>
              {renderMfaForm()}
            </div>
          ) : isDemoMode || !allowRegistration ? (
            <div style={{ marginBottom: 20 }}>
              {renderLoginForm()}
            </div>
          ) : (
            <Tabs collapsible="auto" type="line" activeKey={tab} onChange={setTab} style={{ marginBottom: 20 }}>
              <TabPane tab="登录" itemKey="login">
                {renderLoginForm()}
              </TabPane>
              <TabPane tab="注册" itemKey="register">
                {renderRegisterForm()}
              </TabPane>
            </Tabs>
          )}
          {addAccountMode && authStatus === 'authenticated' && !mfaChallenge && (
            <Button theme="borderless" type="tertiary" block style={{ marginTop: -8, marginBottom: 12 }} onClick={() => navigate('/')}>
              取消添加，返回工作台
            </Button>
          )}
          {/* OAuth 第三方登录 */}
          {!mfaChallenge && enterpriseProviders.length > 0 && (
            <div className="login-enterprise">
              <Divider />
              <div className="login-enterprise-list">
                {enterpriseProviders.map((provider) => (
                  <Button
                    key={provider.id}
                    type="tertiary"
                    icon={<BriefcaseBusiness size={16} />}
                    block
                    onClick={() => handleEnterpriseLogin(provider)}
                  >
                    {provider.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {/* OAuth 第三方登录：只渲染后端已启用且配置完整的提供方 */}
          {!mfaChallenge && oauthProviders.length > 0 && (
            <div className="login-oauth">
              <Divider align="center">
                <span className="login-oauth-label">其他方式登录</span>
              </Divider>
              <div className="login-oauth-list">
                {oauthProviders.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    className="oauth-btn"
                    title={`${OAUTH_PROVIDER_LABELS[provider]} 登录`}
                    onClick={() => handleOAuthLogin(provider)}
                  >
                    <OAuthProviderIcon provider={provider} size={20} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {import.meta.env.VITE_DEMO_MODE === 'true' && (
            <div className="login-demo-tip">
              <div style={{ marginBottom: 4 }}>
                <strong>演示模式</strong>：当前站点使用模拟数据，仅开放预置账号体验主要流程，不提供注册入口。
              </div>
              <div>
                体验账号：<code>admin</code> / 密码：<code>123456</code>
              </div>
            </div>
          )}
        </div>
      </main>
      <footer className="login-footer">
        © {dayjs().year()} {config.appTitle} · 高效 · 稳定 · 安全
      </footer>
      <ForgotPasswordModal
        visible={forgotPasswordVisible}
        onClose={() => setForgotPasswordVisible(false)}
      />
      <AppModal
        title={directoryProvider ? `${directoryProvider.name} 登录` : '目录账号登录'}
        visible={!!directoryProvider}
        onCancel={closeDirectoryLogin}
        onOk={handleDirectoryLoginOk}
        okText="登录"
        cancelText="取消"
        okButtonProps={{ loading: directoryLoginLoading }}
        closeOnEsc
      >
        <Form
          key={directoryProvider?.id ?? 'directory-login'}
          getFormApi={(api) => { directoryFormApi.current = api; }}
          labelPosition="left"
          labelWidth={72}
        >
          <Form.Input
            field="username"
            label="账号"
            placeholder="目录账号 / 邮箱"
            prefix={<User />}
            rules={[{ required: true, message: '请输入目录账号' }]}
            size="large"
          />
          <Form.Input
            field="password"
            label="密码"
            type="password"
            placeholder="目录密码"
            prefix={<Lock />}
            rules={[{ required: true, message: '请输入目录密码' }]}
            size="large"
          />
        </Form>
      </AppModal>
    </div>
  );
}
