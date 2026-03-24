import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Button, Toast, Typography, Tabs, TabPane } from '@douyinfe/semi-ui';
import { User, Lock, Mail, AtSign } from 'lucide-react';
import type { RegisterInput } from '@zenith/shared';
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
