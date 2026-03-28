import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Form, Button, Toast, Typography, Spin } from '@douyinfe/semi-ui';
import { Lock, CheckCircle } from 'lucide-react';
import { request } from '@/utils/request';

const { Title, Text } = Typography;

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [success, setSuccess] = useState(false);

  // 验证 token 是否合法（提前提示，防止无效链接浪费用户时间）
  useEffect(() => {
    if (!token) {
      setValidating(false);
      setTokenValid(false);
      return;
    }
    // 通过提交时后端验证即可；这里只做 token 存在性判断
    setValidating(false);
    setTokenValid(true);
  }, [token]);

  const handleSubmit = async (values: { newPassword: string; confirmPassword: string }) => {
    if (values.newPassword !== values.confirmPassword) {
      Toast.error('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      const res = await request.post<null>('/api/auth/reset-password', { token, newPassword: values.newPassword }, { silent: true });
      if (res.code === 0) {
        setSuccess(true);
      } else {
        Toast.error(res.message || '重置失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  if (validating) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  const renderBody = () => {
    if (success) {
      return (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <CheckCircle size={48} style={{ color: 'var(--semi-color-success)', marginBottom: 16 }} />
          <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>密码重置成功</p>
          <p style={{ color: 'var(--semi-color-text-2)', fontSize: 13, marginBottom: 20 }}>
            请使用新密码登录
          </p>
          <Button type="primary" theme="solid" block size="large" onClick={() => navigate('/login', { replace: true })}>
            立即登录
          </Button>
        </div>
      );
    }
    if (tokenValid === false) {
      return (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <p style={{ color: 'var(--semi-color-danger)', marginBottom: 20 }}>
            重置链接无效或已过期，请重新申请。
          </p>
          <Button type="primary" theme="solid" block size="large" onClick={() => navigate('/login', { replace: true })}>
            返回登录
          </Button>
        </div>
      );
    }
    return (
      <Form<{ newPassword: string; confirmPassword: string }> onSubmit={handleSubmit}>
        <Form.Input
          field="newPassword"
          label="新密码"
          type="password"
          placeholder="至少 6 个字符"
          prefix={<Lock size={14} />}
          size="large"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '密码至少 6 个字符' },
          ]}
        />
        <Form.Input
          field="confirmPassword"
          label="确认新密码"
          type="password"
          placeholder="再次输入新密码"
          prefix={<Lock size={14} />}
          size="large"
          rules={[{ required: true, message: '请再次输入新密码' }]}
        />
        <Button
          htmlType="submit"
          type="primary"
          theme="solid"
          block
          size="large"
          loading={loading}
          style={{ marginTop: 8 }}
        >
          确认重置
        </Button>
      </Form>
    );
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--semi-color-bg-0)',
    }}>
      <div style={{
        width: 400, padding: '40px 36px',
        background: 'var(--semi-color-bg-2)',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            marginBottom: 20, cursor: 'pointer',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'var(--semi-color-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 18,
            }}>Z</div>
            <span style={{ fontWeight: 700, fontSize: 16 }}>Zenith Admin</span>
          </div>
          <Title heading={3} style={{ marginBottom: 6 }}>重置密码</Title>
          <Text type="tertiary" style={{ fontSize: 13 }}>
            请设置您的新密码
          </Text>
        </div>

        {renderBody()}
      </div>
    </div>
  );
}
