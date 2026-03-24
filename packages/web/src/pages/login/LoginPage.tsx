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

export default function LoginPage({ onLogin, onRegister }: LoginPageProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('login');

  // Captcha state
  const [captchaEnabled, setCaptchaEnabled] = useState(false);
  const [captchaId, setCaptchaId] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');

  const fetchCaptcha = useCallback(async () => {
    try {
      const res = await request.get<{ captchaId: string; svg: string; enabled: boolean }>('/api/auth/captcha');
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
      if (res.code !== 0) {
        Toast.error(res.message);
        if (captchaEnabled) fetchCaptcha();
      } else {
        navigate('/', { replace: true });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: RegisterInput) => {
    setLoading(true);
    try {
      const res = await onRegister(values);
      if (res.code !== 0) {
        Toast.error(res.message);
      } else {
        navigate('/', { replace: true });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-left">
        <div className="login-brand">
          <div className="login-logo">Z</div>
          <Title heading={2} style={{ color: '#fff', marginBottom: 8 }}>
            Zenith Admin
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>
            现代化企业后台管理框架
          </Text>
        </div>
        <div className="login-left-decor" />
      </div>
      <div className="login-right">
        <div className="login-form-wrapper">
          <Title heading={3} style={{ marginBottom: 24, fontWeight: 600 }}>
            {tab === 'login' ? '欢迎回来' : '创建账号'}
          </Title>
          <Tabs type="line" activeKey={tab} onChange={setTab} style={{ marginBottom: 20 }}>
            <TabPane tab="登录" itemKey="login">
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
                    <div
                      style={{ cursor: 'pointer', marginTop: 28, flexShrink: 0, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--semi-color-border)' }}
                      title="点击刷新验证码"
                      onClick={fetchCaptcha}
                      dangerouslySetInnerHTML={{ __html: captchaSvg }}
                    />
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
            </TabPane>
            <TabPane tab="注册" itemKey="register">
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
            </TabPane>
          </Tabs>
          <Text
            type="tertiary"
            style={{ display: 'block', textAlign: 'center', marginTop: 20, fontSize: 12 }}
          >
            默认账号：admin / 123456
          </Text>
        </div>
      </div>
    </div>
  );
}
