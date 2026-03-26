import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Button, Toast, Typography, Tabs, TabPane } from '@douyinfe/semi-ui';
import { User, Lock, Mail, AtSign, Github } from 'lucide-react';
import type { RegisterInput, OAuthProviderType } from '@zenith/shared';
import { request } from '../../utils/request';
import './LoginPage.css';

const { Title, Text } = Typography;

interface LoginPageProps {
  onLogin: (username: string, password: string, captchaId?: string, captchaCode?: string) => Promise<{ code: number; message: string }>;
  onRegister: (data: { username: string; nickname: string; email: string; password: string }) => Promise<{ code: number; message: string }>;
}

export default function LoginPage({ onLogin, onRegister }: Readonly<LoginPageProps>) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('login');
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

  // Captcha state
  const [captchaEnabled, setCaptchaEnabled] = useState(false);
  const [captchaId, setCaptchaId] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');

  const fetchCaptcha = useCallback(async () => {
    try {
      const res = await request.get<{ captchaId: string; svg: string; enabled: boolean }>('/api/auth/captcha', { silent: true });
      if (res.code === 0) {
        setCaptchaEnabled(res.data.enabled);
        if (res.data.enabled) {
          setCaptchaId(res.data.captchaId);
          setCaptchaSvg(res.data.svg);
        }
      }
    } catch { /* captcha endpoint not available */ }
  }, []);

  useEffect(() => { fetchCaptcha(); }, [fetchCaptcha]);

  const handleLogin = async (values: Record<string, string>) => {
    setLoading(true);
    try {
      const res = await onLogin(values.username, values.password, captchaId, values.captchaCode);
      if (res.code === 0) {
        navigate('/', { replace: true });
        return;
      }

      Toast.error(res.message);
      if (captchaEnabled) fetchCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: RegisterInput) => {
    setLoading(true);
    try {
      const res = await onRegister(values);
      if (res.code === 0) {
        navigate('/', { replace: true });
        return;
      }

      Toast.error(res.message);
    } finally {
      setLoading(false);
    }
  };

  const renderLoginForm = () => (
    <Form onSubmit={handleLogin} style={{ marginTop: 12 }}>
      <Form.Input
        field="username"
        label="用户名"
        placeholder="请输入用户名"
        prefix={<User />}
        rules={[{ required: true, message: '请输入用户名' }]}
        size="large"
      />
      <Form.Input
        field="password"
        label="密码"
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
              label="验证码"
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
              borderRadius: 4,
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
        block
        size="large"
        style={{ marginTop: 8, borderRadius: 8, height: 42 }}
      >
        登录
      </Button>
    </Form>
  );

  const renderRegisterForm = () => (
    <Form onSubmit={handleRegister} style={{ marginTop: 12 }}>
      <Form.Input
        field="username"
        label="用户名"
        placeholder="3~32 个字符"
        prefix={<User />}
        rules={[{ required: true, message: '请输入用户名' }]}
        size="large"
      />
      <Form.Input
        field="nickname"
        label="昵称"
        placeholder="请输入昵称"
        prefix={<AtSign />}
        rules={[{ required: true, message: '请输入昵称' }]}
        size="large"
      />
      <Form.Input
        field="email"
        label="邮箱"
        placeholder="请输入邮箱"
        prefix={<Mail />}
        rules={[{ required: true, type: 'string', message: '请输入邮箱' }]}
        size="large"
      />
      <Form.Input
        field="password"
        label="密码"
        type="password"
        placeholder="至少6个字符"
        prefix={<Lock />}
        rules={[{ required: true, message: '请输入密码' }]}
        size="large"
      />
      <Button
        htmlType="submit"
        type="primary"
        theme="solid"
        loading={loading}
        block
        size="large"
        style={{ marginTop: 8, borderRadius: 8, height: 42 }}
      >
        注册
      </Button>
    </Form>
  );

  let formSubtitle = '请输入您的账号信息以登录工作台';

  const handleOAuthLogin = async (provider: OAuthProviderType) => {
    const res = await request.get<{ authUrl: string; state: string }>(`/api/auth/oauth/${provider}`);
    if (res.code === 0 && res.data?.authUrl) {
      globalThis.location.href = res.data.authUrl;
    }
    // 错误 toast 由 request 工具自动处理
  };

  if (isDemoMode) {
    formSubtitle = '当前为演示模式，仅开放预置账号登录，页面数据为模拟环境。';
  } else if (tab !== 'login') {
    formSubtitle = '注册新账号加入我们';
  }

  return (
    <div className="login-page">
      <div className="login-left">
        <div className="login-blob login-blob-1" />
        <div className="login-blob login-blob-2" />
        <div className="login-blob login-blob-3" />
        <div className="login-brand">
          <div className="login-logo-wrap">
            <div className="login-logo">Z</div>
            <span className="login-brand-name">Zenith Admin</span>
          </div>
          <h1 className="login-headline">
            高效管理，
            <br />
            <span className="login-headline-highlight">赋能业务增长</span>
          </h1>
          <p className="login-desc">
            企业级后台管理系统，为团队提供高效、
            <br />
            稳定、安全的管理解决方案。
          </p>
          <div className="login-badges">
            <span className="login-badge"><span className="login-badge-dot" />稳定运行</span>
            <span className="login-badge"><span className="login-badge-dot" />高效管理</span>
            <span className="login-badge"><span className="login-badge-dot" />安全防护</span>
          </div>
        </div>
      </div>
      <div className="login-right">
        <div className="login-form-wrapper">
          <div className="login-mobile-brand">
            <div className="login-logo">Z</div>
            <span className="login-brand-name">Zenith Admin</span>
          </div>
          <div className="login-form-header">
            <Title heading={3} style={{ marginBottom: 6, fontWeight: 700 }}>
              {isDemoMode || tab === 'login' ? '欢迎回来' : '创建账号'}
            </Title>
            <Text type="tertiary" style={{ fontSize: 14, display: 'block', marginBottom: 24 }}>
              {formSubtitle}
            </Text>
          </div>
          {isDemoMode ? (
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
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Text type="tertiary" size="small">其他方式登录</Text>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 10 }}>
              <button
                type="button"
                className="oauth-btn"
                title="GitHub 登录"
                onClick={() => handleOAuthLogin('github')}
              >
                <Github size={20} />
              </button>
              <button
                type="button"
                className="oauth-btn"
                title="钉钉登录"
                onClick={() => handleOAuthLogin('dingtalk')}
              >
                <svg viewBox="0 0 1024 1024" width="20" height="20" fill="currentColor"><path d="M512 0C229.2 0 0 229.2 0 512s229.2 512 512 512 512-229.2 512-512S794.8 0 512 0zm227 603.6c-6 10.2-29 31.6-72.8 66L642 690.8l13.6 59.4s1.2 5.2-2.4 7.2-7.6 0-7.6 0l-85.6-52.4c0 0-29.6 15.2-41.6 19.6-12 4.4-14.4-4.8-14-8.4l7.6-56.8-162.8-2s-6.8-0.8-8.4-6.4c-2-7.2 6.8-10.8 6.8-10.8l98-43.6-24.4-32.8s-4-6.8 0.8-9.6c4.8-2.8 9.6 1.6 9.6 1.6l114 67.2 96.4-60s28.4-18.4 42-31.2c13.6-12.8 12-22.4 12-22.4-4-36-125.2-52-204-72-78.8-20-180.8-60-162-148 0 0 8.8-50 80-98.4 0 0 47.2-46.8 52.4 15.2 0 0 4 38.8-6.4 50-10.4 11.2-48.4 40.4-48.4 40.4s-24.4 14.4-10.4 24c14 9.6 78 38 133.2 46.4 55.2 8.4 172.8 8 208 80.8 0 0 25.2 44.4 10.8 68.8z"/></svg>
              </button>
              <button
                type="button"
                className="oauth-btn"
                title="企业微信登录"
                onClick={() => handleOAuthLogin('wechat_work')}
              >
                <svg viewBox="0 0 1024 1024" width="20" height="20" fill="currentColor"><path d="M672 288c-105.6 0-198.4 52-256 131.2C358.4 340 265.6 288 160 288 71.6 288 0 359.6 0 448c0 52.4 25.2 100 64 129.6L42.4 648c-2 5.6 3.6 10.8 9.2 8.4l60-28.8C140.4 644 172 656 208 660l-2.4-12c0-119.2 96.8-216 216-216 5.6 0 11.2 0.4 16.8 0.8C465.6 345.6 560.4 288 672 288zm-160 144c-17.6 0-32-14.4-32-32s14.4-32 32-32 32 14.4 32 32-14.4 32-32 32zM352 400c0-17.6 14.4-32 32-32s32 14.4 32 32-14.4 32-32 32-32-14.4-32-32zm480 48c0 117.6-96.8 216-216 216-36 0-70-9.6-100-26l-60 28.8c-5.6 2.4-11.2-2.8-9.2-8.4l21.6-70.4c-38.8-30-64-77.6-64-129.6 0-117.6 96.8-216 216-216 98.4 0 181.2 66.4 206.8 156.8 3.2 16.4 4.8 32.8 4.8 48.8zm-272-40c-17.6 0-32-14.4-32-32s14.4-32 32-32 32 14.4 32 32-14.4 32-32 32zm160 0c-17.6 0-32-14.4-32-32s14.4-32 32-32 32 14.4 32 32-14.4 32-32 32z"/></svg>
              </button>
            </div>
          </div>
          {import.meta.env.VITE_DEMO_MODE === 'true' && (
            <div style={{
              marginTop: 20,
              padding: '10px 14px',
              borderRadius: 8,
              background: 'var(--semi-color-primary-light-default)',
              border: '1px solid var(--semi-color-primary-light-active)',
              fontSize: 13,
              textAlign: 'left',
              color: 'var(--semi-color-primary)',
            }}>
              <div style={{ marginBottom: 4 }}>
                <strong>演示模式</strong>：当前站点使用模拟数据，仅开放预置账号体验主要流程，不提供注册入口。
              </div>
              <div>
                体验账号：<code>admin</code> / 密码：<code>123456</code>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
