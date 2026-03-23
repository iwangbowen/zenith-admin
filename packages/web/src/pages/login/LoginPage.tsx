import { useState } from 'react';
import { Form, Button, Toast, Typography, Tabs, TabPane } from '@douyinfe/semi-ui';
import { User, Lock, Mail, AtSign } from 'lucide-react';
import type { RegisterInput } from '@zenith/shared';
import './LoginPage.css';

const { Title, Text } = Typography;

interface LoginPageProps {
  onLogin: (username: string, password: string) => Promise<{ code: number; message: string }>;
  onRegister: (data: { username: string; nickname: string; email: string; password: string }) => Promise<{ code: number; message: string }>;
}

export default function LoginPage({ onLogin, onRegister }: LoginPageProps) {
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('login');

  const handleLogin = async (values: Record<string, string>) => {
    setLoading(true);
    try {
      const res = await onLogin(values.username, values.password);
      if (res.code !== 0) {
        Toast.error(res.message);
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
