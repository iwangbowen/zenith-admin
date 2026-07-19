import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Form, Button, Toast, Typography, Tabs, TabPane, Divider } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { User, Lock, Mail, AtSign, Building2, ShieldCheck, BriefcaseBusiness, Check } from 'lucide-react';
import { Icon } from '@iconify/react';
import dayjs from 'dayjs';
import { REFRESH_TOKEN_KEY, TOKEN_KEY, type RegisterInput, type OAuthProviderType, type LoginResult, type LoginResponse, type TenantIdentityProviderSummary } from '@zenith/shared';
import { request } from '@/utils/request';
import { config } from '@/config';
import { markPostLoginHome } from '@/lib/post-login';
import AppLogo from '@/components/AppLogo';
import AppModal from '@/components/AppModal';
import ForgotPasswordModal from './ForgotPasswordModal';
import { useEnterpriseProviders, usePublicCaptcha, usePublicSystemConfig } from '@/hooks/queries/auth-public';
import './LoginPage.css';

const { Title, Text } = Typography;

interface LoginPageProps {
  onLogin: (username: string, password: string, captchaId?: string, captchaCode?: string, tenantCode?: string) => Promise<{ code: number; message: string; retryAfterSeconds?: number; data: LoginResult }>;
  onVerifyMfa: (challengeId: string, code: string, rememberDevice: boolean) => Promise<{ code: number; message: string; retryAfterSeconds?: number; data: LoginResponse }>;
  onRegister: (data: { username: string; nickname: string; email: string; password: string }) => Promise<{ code: number; message: string; retryAfterSeconds?: number }>;
}

function isMfaChallenge(data: LoginResult): data is Extract<LoginResult, { mfaRequired: true }> {
  return 'mfaRequired' in data && data.mfaRequired;
}

export default function LoginPage({ onLogin, onVerifyMfa, onRegister }: Readonly<LoginPageProps>) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const redirectTo = params.get('redirect') || '/';
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
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

  const captchaQuery = usePublicCaptcha();
  const allowRegistrationQuery = usePublicSystemConfig('allow_registration');
  const forgotPasswordQuery = usePublicSystemConfig('forgot_password_enabled');
  const [forgotPasswordVisible, setForgotPasswordVisible] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<Extract<LoginResult, { mfaRequired: true }> | null>(null);
  const [tenantCode, setTenantCode] = useState('');
  const [debouncedTenantCode, setDebouncedTenantCode] = useState('');
  const [directoryProvider, setDirectoryProvider] = useState<TenantIdentityProviderSummary | null>(null);
  const [directoryLoginLoading, setDirectoryLoginLoading] = useState(false);
  const directoryFormApi = useRef<FormApi | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTenantCode(tenantCode);
    }, 250);
    return () => clearTimeout(timer);
  }, [tenantCode]);
  const enterpriseProvidersQuery = useEnterpriseProviders(debouncedTenantCode);
  const captchaEnabled = captchaQuery.data?.enabled ?? false;
  const captchaId = captchaQuery.data?.captchaId ?? '';
  const captchaSvg = captchaQuery.data?.svg ?? '';
  const allowRegistration = allowRegistrationQuery.data?.configValue === 'true';
  const forgotPasswordEnabled = forgotPasswordQuery.data?.configValue === 'true';
  const enterpriseProviders = enterpriseProvidersQuery.data?.providers ?? [];
  const fetchCaptcha = () => { void captchaQuery.refetch(); };

  const handleLogin = async (values: Record<string, string>) => {
    if (retrySeconds > 0) return;
    setLoading(true);
    try {
      const res = await onLogin(values.username, values.password, captchaId, values.captchaCode, values.tenantCode);
      if (res.code === 0) {
        if (isMfaChallenge(res.data)) {
          setMfaChallenge(res.data);
          return;
        }
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
      const res = await onVerifyMfa(mfaChallenge.challengeId, String(values.code ?? ''), Boolean(values.rememberDevice));
      if (res.code === 0) {
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
      const res = await onRegister(values);
      if (res.code === 0) {
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

  const renderLoginForm = () => (
    <Form onSubmit={handleLogin} style={{ marginTop: 12 }}>
      {config.multiTenantMode && (
        <Form.Input
          field="tenantCode"
          label="租户编码"
          placeholder="留空则登录平台管理员"
          prefix={<Building2 />}
          size="large"
          onChange={(value) => setTenantCode(value)}
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
        disabled={retrySeconds > 0}
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
      <Form.Input
        field="code"
        noLabel
        placeholder="6 位动态验证码"
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
    const res = await request.get<{ authUrl: string; state: string }>(`/api/auth/oauth/${provider}`, { silent: true });
    if (res.code === 0 && res.data?.authUrl) {
      globalThis.location.href = res.data.authUrl;
    } else {
      Toast.warning(res.message || '该登录方式暂不可用，请联系管理员配置');
    }
  };

  const handleEnterpriseLogin = async (provider: TenantIdentityProviderSummary) => {
    if (provider.type === 'ldap' || provider.type === 'ad') {
      setDirectoryProvider(provider);
      return;
    }
    const res = await request.get<{ authUrl: string; state: string | null }>(
      `/api/auth/enterprise/${provider.id}?redirect=${encodeURIComponent(redirectTo)}`,
      { silent: true },
    );
    if (res.code === 0 && res.data?.authUrl) {
      globalThis.location.href = res.data.authUrl;
    } else {
      Toast.warning(res.message || '该企业登录方式暂不可用，请联系管理员配置');
    }
  };

  const handleDirectoryLogin = async (values: Record<string, string>) => {
    if (!directoryProvider) return;
    setDirectoryLoginLoading(true);
    try {
      const res = await request.post<{ loginResult: LoginResponse; redirectTo?: string | null }>('/api/auth/enterprise/ldap/login', {
        providerId: directoryProvider.id,
        username: values.username,
        password: values.password,
        redirectTo,
      }, { silent: true });
      if (res.code === 0) {
        localStorage.setItem(TOKEN_KEY, res.data.loginResult.token.accessToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, res.data.loginResult.token.refreshToken);
        setDirectoryProvider(null);
        navigateAfterLogin(res.data.redirectTo || redirectTo);
        return;
      }
      Toast.error(res.message);
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
              {mfaChallenge ? '安全验证' : (isDemoMode || tab === 'login' ? '欢迎回来' : '创建账号')}
            </Title>
            <Text type="tertiary" style={{ fontSize: 14, display: 'block', marginBottom: 24 }}>
              {formSubtitle}
            </Text>
          </div>
          {mfaChallenge ? (
            <div style={{ marginBottom: 20 }}>
              {renderMfaForm()}
            </div>
          ) : isDemoMode || !allowRegistration ? (
            <div style={{ marginBottom: 20 }}>
              {renderLoginForm()}
            </div>
          ) : (
            <Tabs type="line" activeKey={tab} onChange={setTab} style={{ marginBottom: 20 }}>
              <TabPane tab="登录" itemKey="login">
                {renderLoginForm()}
              </TabPane>
              <TabPane tab="注册" itemKey="register">
                {renderRegisterForm()}
              </TabPane>
            </Tabs>
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
          {!mfaChallenge && <div className="login-oauth">
            <Divider align="center">
              <span className="login-oauth-label">其他方式登录</span>
            </Divider>
            <div className="login-oauth-list">
              <button
                type="button"
                className="oauth-btn"
                title="GitHub 登录"
                onClick={() => handleOAuthLogin('github')}
              >
                <Icon icon="simple-icons:github" width="20" height="20" />
              </button>
              <button
                type="button"
                className="oauth-btn"
                title="钉钉登录"
                onClick={() => handleOAuthLogin('dingtalk')}
              >
                <Icon icon="ant-design:dingtalk-outlined" width="22" height="22" />
              </button>
              <button
                type="button"
                className="oauth-btn"
                title="企业微信登录"
                onClick={() => handleOAuthLogin('wechat_work')}
              >
                <Icon icon="ant-design:wechat-work-filled" width="22" height="22" />
              </button>
            </div>
          </div>}
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
