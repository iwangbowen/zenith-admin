import { lazy, Suspense, useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button, Checkbox, Divider, PinCode, Spin, Toast, Typography } from '@douyinfe/semi-ui';
import { User, Lock, Mail, AtSign, Building2, ShieldCheck, ShieldAlert, BriefcaseBusiness, Check, ChevronRight } from 'lucide-react';
import dayjs from 'dayjs';
import { MAX_STORED_ACCOUNTS, REFRESH_TOKEN_KEY, TOKEN_KEY } from '@zenith/shared/core';
import { OAUTH_PROVIDER_LABELS, enterpriseAuthContract, oauthContract } from '@zenith/shared/identity';
import type { RegisterInput, OAuthProviderType, LoginResult, LoginResponse, MfaLoginChallenge, SessionConflict, TenantIdentityProviderSummary } from '@zenith/shared/identity';
import { api } from '@/lib/contract-query';
import { ApiError } from '@/lib/query';
import { takeAuthInvalidatedReason, type AuthInvalidatedReason } from '@/utils/http-client';
import { config } from '@/config';
import { markPostLoginHome } from '@/lib/post-login';
import { readMfaHandoff } from '@/lib/mfa-handoff';
import { rememberOAuthPending } from '@/lib/oauth-pending';
import { useAuth, type LoginOptions } from '@/hooks/useAuth';
import { UserAvatar } from '@/components/UserAvatar';
import AppLogo from '@/components/AppLogo';
import { OAuthProviderIcon } from '@/components/OAuthProviderIcon';
import { useEnterpriseProviders, useOAuthProviders, usePublicCaptcha } from '@/hooks/queries/auth-public';
import { usePublicSettings } from '@/hooks/queries/settings';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { useLoginForm, type FieldRules } from './login-form';
import { LoginField, LoginFormError } from './LoginField';
import type { DirectoryLoginValues } from './DirectoryLoginModal';
import './LoginPage.css';

// 登录页静态打包在关键路径里（见 App.tsx），因此这里只能用轻量控件：
// Semi Form / Tabs / Modal 都不进本文件的静态闭包，弹窗按需加载。
const ForgotPasswordModal = lazy(() => import('./ForgotPasswordModal'));
const DirectoryLoginModal = lazy(() => import('./DirectoryLoginModal'));
const SessionConflictModal = lazy(() => import('./SessionConflictModal'));

const { Title, Text } = Typography;

interface LoginPageProps {
  onLogin: (username: string, password: string, captchaId?: string, captchaCode?: string, tenantCode?: string, options?: LoginOptions) => Promise<{ code: number; message: string; retryAfterSeconds?: number; data: LoginResult }>;
  onVerifyMfa: (challengeId: string, code: string, rememberDevice: boolean, options?: LoginOptions) => Promise<{ code: number; message: string; retryAfterSeconds?: number; data: LoginResponse }>;
  onRegister: (data: { username: string; nickname: string; email: string; password: string }, options?: LoginOptions) => Promise<{ code: number; message: string; retryAfterSeconds?: number }>;
}

interface LoginFormValues extends Record<string, string> {
  tenantCode: string;
  username: string;
  password: string;
  captchaCode: string;
}

interface RegisterFormValues extends Record<string, string> {
  username: string;
  nickname: string;
  email: string;
  password: string;
}

const REGISTER_RULES: FieldRules<RegisterFormValues> = {
  username: [{ required: true, message: '请输入用户名' }],
  nickname: [{ required: true, message: '请输入昵称' }],
  email: [{ required: true, message: '请输入邮箱' }],
  password: [{ required: true, message: '请输入密码' }],
};

const EMPTY_REGISTER: RegisterFormValues = { username: '', nickname: '', email: '', password: '' };

/** 被动下线横幅标题：按机读原因取文案，其余统一为强制下线 */
const INVALIDATED_TITLES: Record<string, string> = {
  'concurrent-login': '已在其他设备登录',
  'password-changed': '密码已修改',
};

const PRIMARY_BUTTON_STYLE = { marginTop: 8, borderRadius: 'var(--semi-border-radius-medium)', height: 42 } as const;

function isMfaChallenge(data: LoginResult): data is MfaLoginChallenge {
  return 'mfaRequired' in data && data.mfaRequired;
}

function isSessionConflict(data: LoginResult): data is SessionConflict {
  return 'sessionConflict' in data && data.sessionConflict;
}

export default function LoginPage({ onLogin, onVerifyMfa, onRegister }: Readonly<LoginPageProps>) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  // 企业 SSO / 第三方 OAuth 回调页命中 MFA 或会话冲突时经 location.state 交接，复用本页验证表单 / 确认弹层
  const mfaHandoff = readMfaHandoff(location.state);
  const redirectTo = mfaHandoff?.redirectTo || params.get('redirect') || '/';
  // 添加账号模式：保留当前登录，成功后停靠原账号并整页切换为新账号
  const addAccountMode = params.get('add_account') === '1';
  const prefillUsername = params.get('username') ?? '';
  const loginOptions: LoginOptions | undefined = addAccountMode ? { addAccount: true } : undefined;
  const { status: authStatus, parkedAccounts, canAddAccount, switchAccount, resolveSessionConflict } = useAuth();
  const [resumingId, setResumingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'login' | 'register'>('login');
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
  // 弹窗首次打开才挂载：Modal 与弹窗表单不进登录页首屏
  const [forgotPasswordVisible, setForgotPasswordVisible] = useState(false);
  const [forgotPasswordMounted, setForgotPasswordMounted] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<MfaLoginChallenge | null>(mfaHandoff?.mfaChallenge ?? null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | undefined>();
  const [rememberDevice, setRememberDevice] = useState(true);
  // 会话并发拒绝模式：凭据已通过但名额已满 → 弹层确认后凭票据兑换；弹层组件按需加载
  const [sessionConflict, setSessionConflict] = useState<SessionConflict | null>(mfaHandoff?.sessionConflict ?? null);
  const [conflictResolving, setConflictResolving] = useState(false);
  const [directoryProvider, setDirectoryProvider] = useState<TenantIdentityProviderSummary | null>(null);
  const [directoryMounted, setDirectoryMounted] = useState(false);
  const [directoryLoginLoading, setDirectoryLoginLoading] = useState(false);

  const captchaEnabled = captchaQuery.data?.enabled ?? false;
  const captchaId = captchaQuery.data?.captchaId ?? '';
  const captchaSvg = captchaQuery.data?.svg ?? '';
  const fetchCaptcha = () => { void captchaQuery.refetch(); };

  const loginRules = useMemo<FieldRules<LoginFormValues>>(() => ({
    username: [{ required: true, message: '请输入用户名/手机号' }],
    password: [{ required: true, message: '请输入密码' }],
    captchaCode: captchaEnabled ? [{ required: true, message: '请输入验证码' }] : [],
  }), [captchaEnabled]);
  const loginInitial = useMemo<LoginFormValues>(
    () => ({ tenantCode: '', username: prefillUsername, password: '', captchaCode: '' }),
    [prefillUsername],
  );
  const loginForm = useLoginForm<LoginFormValues>(loginInitial, loginRules);
  const registerForm = useLoginForm<RegisterFormValues>(EMPTY_REGISTER, REGISTER_RULES);

  // 被动下线（过期/他端注销/管理员强退/被挤下线）落地登录页时说明原因，避免被当成系统故障：
  // 带机读原因的（被挤下线 / 改密 / 强退）用常驻横幅并预填账号，其余保留轻提示。sessionStorage 标记读一次即清，用 ref 防重入
  const [invalidated, setInvalidated] = useState<AuthInvalidatedReason | null>(null);
  const invalidatedTakenRef = useRef(false);
  const setLoginValue = loginForm.setValue;
  useEffect(() => {
    if (invalidatedTakenRef.current) return;
    invalidatedTakenRef.current = true;
    const detail = takeAuthInvalidatedReason();
    if (!detail) return;
    if (detail.reason && detail.reason !== 'rotated' && detail.reason !== 'logout') {
      setInvalidated(detail);
      if (detail.username && !prefillUsername) setLoginValue('username', detail.username);
    } else {
      Toast.warning({ content: detail.message, duration: 6 });
    }
  }, [setLoginValue, prefillUsername]);

  const [debouncedTenantCode] = useDebouncedValue(loginForm.values.tenantCode, { wait: 250 });
  const enterpriseProvidersQuery = useEnterpriseProviders(debouncedTenantCode);
  // 匿名设置投影（注册 / 找回密码开关）：多租户下随租户编码解析租户级值
  const publicSettingsQuery = usePublicSettings(debouncedTenantCode);
  const oauthProvidersQuery = useOAuthProviders();
  const allowRegistration = publicSettingsQuery.data?.auth.allowRegistration ?? false;
  const forgotPasswordEnabled = publicSettingsQuery.data?.auth.forgotPasswordEnabled ?? false;
  const enterpriseProviders = enterpriseProvidersQuery.data?.providers ?? [];
  // 加载中 / 后端不可达 / 未启用任何提供方 → 空数组 → 不渲染「其他方式登录」
  const oauthProviders = oauthProvidersQuery.data ?? [];

  const handleLogin = async (values: LoginFormValues) => {
    if (retrySeconds > 0) return;
    setLoading(true);
    try {
      const res = await onLogin(
        values.username,
        values.password,
        captchaId,
        captchaEnabled ? values.captchaCode : undefined,
        config.multiTenantMode && values.tenantCode ? values.tenantCode : undefined,
        loginOptions,
      );
      if (res.code === 0) {
        if (handleLoginResult(res.data)) return;
        navigateAfterLogin(redirectTo);
        return;
      }
      if (res.code === 429 && res.retryAfterSeconds) {
        setRetrySeconds(res.retryAfterSeconds);
      }
      // 登录失败原因行内展示在字段下方（不再顶部 Toast），用户再次输入即清除
      loginForm.setFormError(res.message);
      if (captchaEnabled) fetchCaptcha();
    } finally {
      setLoading(false);
    }
  };

  /**
   * 登录结果的非终态分支：MFA 挑战转入验证表单，会话冲突弹出确认层，添加账号成功交给 AuthProvider 整页重载。
   * 返回 true 表示已接管、调用方不必再跳转。
   */
  const handleLoginResult = (data: LoginResult): boolean => {
    if (isMfaChallenge(data)) {
      setMfaChallenge(data);
      return true;
    }
    if (isSessionConflict(data)) {
      setSessionConflict(data);
      return true;
    }
    return addAccountMode;
  };

  const handleResolveConflict = async () => {
    if (!sessionConflict || conflictResolving) return;
    setConflictResolving(true);
    try {
      const res = await resolveSessionConflict(sessionConflict.ticket, loginOptions);
      if (res.code === 0) {
        setSessionConflict(null);
        if (handleLoginResult(res.data)) return;
        navigateAfterLogin(redirectTo);
        return;
      }
      // 票据过期 / 已被消费：关闭弹层回到表单重新登录，原因行内展示在表单里
      loginForm.setFormError(res.message);
      setSessionConflict(null);
    } finally {
      setConflictResolving(false);
    }
  };

  const handleLoginSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const values = loginForm.validate();
    if (values) void handleLogin(values);
  };

  const handleMfaVerify = async () => {
    if (!mfaChallenge || retrySeconds > 0) return;
    if (!mfaCode.trim()) {
      setMfaError('请输入动态验证码');
      return;
    }
    setLoading(true);
    try {
      const res = await onVerifyMfa(mfaChallenge.challengeId, mfaCode, rememberDevice, loginOptions);
      if (res.code === 0) {
        if (addAccountMode) return;
        navigateAfterLogin(redirectTo);
        return;
      }
      setMfaError(res.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    void handleMfaVerify();
  };

  const leaveMfa = () => {
    setMfaChallenge(null);
    setMfaCode('');
    setMfaError(undefined);
    if (captchaEnabled) fetchCaptcha();
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
      registerForm.setFormError(res.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const values = registerForm.validate();
    if (values) void handleRegister(values);
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

  const openForgotPassword = () => {
    setForgotPasswordMounted(true);
    setForgotPasswordVisible(true);
  };

  const renderLoginForm = () => (
    <form className="login-form" onSubmit={handleLoginSubmit} noValidate>
      {config.multiTenantMode && (
        <LoginField
          {...loginForm.field('tenantCode')}
          id="login-tenant-code"
          label="租户编码"
          placeholder="留空则登录平台管理员"
          prefix={<Building2 />}
          size="large"
          autoComplete="organization"
        />
      )}
      <LoginField
        {...loginForm.field('username')}
        id="login-username"
        placeholder="请输入用户名/手机号"
        prefix={<User />}
        size="large"
        autoComplete="username"
      />
      <LoginField
        {...loginForm.field('password')}
        id="login-password"
        mode="password"
        placeholder="请输入密码"
        prefix={<Lock />}
        size="large"
        autoComplete="current-password"
      />
      {captchaEnabled && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <LoginField
              {...loginForm.field('captchaCode')}
              id="login-captcha"
              placeholder="请输入验证码"
              size="large"
              autoComplete="one-time-code"
            />
          </div>
          <button
            type="button"
            style={{
              cursor: 'pointer',
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
      <LoginFormError message={loginForm.formError} />
      <Button
        htmlType="submit"
        type="primary"
        theme="solid"
        loading={loading}
        disabled={retrySeconds > 0 || (addAccountMode && !canAddAccount)}
        block
        size="large"
        style={PRIMARY_BUTTON_STYLE}
      >
        {retrySeconds > 0 ? `${retrySeconds}s 后可重试` : '登录'}
      </Button>
      {forgotPasswordEnabled && (
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <Button type="tertiary" theme="borderless" size="small" onClick={openForgotPassword}>
            忘记密码？
          </Button>
        </div>
      )}
    </form>
  );

  const renderRegisterForm = () => (
    <form className="login-form" onSubmit={handleRegisterSubmit} noValidate>
      <LoginField
        {...registerForm.field('username')}
        id="register-username"
        placeholder="用户名（3~32 个字符）"
        prefix={<User />}
        size="large"
        autoComplete="username"
      />
      <LoginField
        {...registerForm.field('nickname')}
        id="register-nickname"
        placeholder="昵称"
        prefix={<AtSign />}
        size="large"
        autoComplete="nickname"
      />
      <LoginField
        {...registerForm.field('email')}
        id="register-email"
        type="email"
        placeholder="邮箱"
        prefix={<Mail />}
        size="large"
        autoComplete="email"
      />
      <LoginField
        {...registerForm.field('password')}
        id="register-password"
        mode="password"
        placeholder="密码（至少6个字符）"
        prefix={<Lock />}
        size="large"
        autoComplete="new-password"
      />
      <LoginFormError message={registerForm.formError} />
      <Button
        htmlType="submit"
        type="primary"
        theme="solid"
        loading={loading}
        disabled={retrySeconds > 0}
        block
        size="large"
        style={PRIMARY_BUTTON_STYLE}
      >
        {retrySeconds > 0 ? `${retrySeconds}s 后可重试` : '注册'}
      </Button>
    </form>
  );

  const renderMfaForm = () => (
    <form className="login-form" onSubmit={handleMfaSubmit} noValidate>
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
      <div className="login-field">
        <div className="login-field-main">
          <PinCode
            count={6}
            size="large"
            value={mfaCode}
            autoFocus
            onChange={(value) => {
              setMfaCode(value);
              if (mfaError) setMfaError(undefined);
            }}
          />
          {mfaError ? <div className="login-field-error" role="alert">{mfaError}</div> : null}
        </div>
      </div>
      <div className="login-field">
        <Checkbox checked={rememberDevice} onChange={(e) => setRememberDevice(Boolean(e.target.checked))}>
          信任此设备，减少二次验证
        </Checkbox>
      </div>
      <Button
        htmlType="submit"
        type="primary"
        theme="solid"
        loading={loading}
        block
        size="large"
        style={PRIMARY_BUTTON_STYLE}
      >
        验证并登录
      </Button>
      <Button type="tertiary" theme="borderless" block style={{ marginTop: 8 }} onClick={leaveMfa}>
        返回账号密码登录
      </Button>
    </form>
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
      setDirectoryMounted(true);
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

  /** 返回错误文案由弹窗行内展示；成功返回 null */
  const handleDirectoryLogin = async (values: DirectoryLoginValues): Promise<string | null> => {
    if (!directoryProvider) return null;
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
      // 企业 SSO 与密码登录共用 MFA 策略与会话并发判定：命中挑战 / 冲突时切到同一套验证表单 / 确认弹层
      if (isMfaChallenge(loginResult) || isSessionConflict(loginResult)) {
        handleLoginResult(loginResult);
        setDirectoryProvider(null);
        return null;
      }
      localStorage.setItem(TOKEN_KEY, loginResult.token.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, loginResult.token.refreshToken);
      setDirectoryProvider(null);
      navigateAfterLogin(nextRedirect || redirectTo);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : '登录失败';
    } finally {
      setDirectoryLoginLoading(false);
    }
  };

  let formTitle = '欢迎回来';
  if (mfaChallenge) {
    formTitle = '安全验证';
    formSubtitle = '请完成多因素认证以进入工作台';
  } else if (addAccountMode) {
    formTitle = '添加账号';
    formSubtitle = canAddAccount
      ? '登录另一个账号，成功后可在右上角账号菜单中随时切换'
      : `最多同时保持 ${MAX_STORED_ACCOUNTS} 个账号登录，请先在账号切换器中退出一个账号`;
  } else if (isDemoMode) {
    formSubtitle = '当前为演示模式，仅开放预置账号登录，页面数据为模拟环境。';
  } else if (tab !== 'login') {
    formTitle = '创建账号';
    formSubtitle = '注册新账号加入我们';
  }

  const invalidatedTitle = INVALIDATED_TITLES[invalidated?.reason ?? ''] ?? '会话已被强制下线';

  /** 卡片主体：MFA 验证表单 / 仅登录（演示模式或未开放注册）/ 登录·注册切换 */
  const renderCardBody = () => {
    if (mfaChallenge) return <div style={{ marginBottom: 20 }}>{renderMfaForm()}</div>;
    if (isDemoMode || !allowRegistration) return <div style={{ marginBottom: 20 }}>{renderLoginForm()}</div>;
    return (
      <div style={{ marginBottom: 20 }}>
        <div className="login-tabs" role="tablist" aria-label="登录或注册">
          {([['login', '登录'], ['register', '注册']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`login-tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`login-panel-${key}`}
              className={`login-tab${tab === key ? ' login-tab-active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div id={`login-panel-${tab}`} role="tabpanel" aria-labelledby={`login-tab-${tab}`}>
          {tab === 'login' ? renderLoginForm() : renderRegisterForm()}
        </div>
      </div>
    );
  };

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
              {formTitle}
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
          {/* 被挤下线 / 改密 / 强退：常驻横幅说明原因，如非本人操作可直接找回密码 */}
          {invalidated && !mfaChallenge && (
            <div className={`login-alert${invalidated.reason === 'concurrent-login' ? ' login-alert-danger' : ''}`} role="alert">
              <ShieldAlert size={18} className="login-alert-icon" aria-hidden />
              <div className="login-alert-body">
                <div className="login-alert-title">
                  {invalidatedTitle}
                </div>
                <div className="login-alert-text">{invalidated.message}</div>
                {invalidated.reason === 'concurrent-login' && forgotPasswordEnabled && (
                  <button type="button" className="login-alert-link" onClick={openForgotPassword}>不是我本人操作，找回密码</button>
                )}
              </div>
              <button type="button" className="login-alert-close" aria-label="关闭提示" onClick={() => setInvalidated(null)}>×</button>
            </div>
          )}
          {renderCardBody()}
          {addAccountMode && authStatus === 'authenticated' && !mfaChallenge && (
            <Button theme="borderless" type="tertiary" block style={{ marginTop: -8, marginBottom: 12 }} onClick={() => navigate('/')}>
              取消添加，返回工作台
            </Button>
          )}
          {/* 企业身份源登录（LDAP / AD / 企业 SSO） */}
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
      {forgotPasswordMounted && (
        <Suspense fallback={null}>
          <ForgotPasswordModal
            visible={forgotPasswordVisible}
            onClose={() => setForgotPasswordVisible(false)}
          />
        </Suspense>
      )}
      {directoryMounted && (
        <Suspense fallback={null}>
          <DirectoryLoginModal
            provider={directoryProvider}
            loading={directoryLoginLoading}
            onCancel={() => setDirectoryProvider(null)}
            onSubmit={handleDirectoryLogin}
          />
        </Suspense>
      )}
      {sessionConflict && (
        <Suspense fallback={null}>
          <SessionConflictModal
            conflict={sessionConflict}
            loading={conflictResolving}
            onConfirm={() => void handleResolveConflict()}
            onCancel={() => setSessionConflict(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
