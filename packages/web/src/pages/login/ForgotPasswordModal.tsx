import { useState } from 'react';
import { Modal, Form, Button, Toast } from '@douyinfe/semi-ui';
import { Mail } from 'lucide-react';
import { request } from '@/utils/request';

interface ForgotPasswordModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function ForgotPasswordModal({ visible, onClose }: Readonly<ForgotPasswordModalProps>) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (values: { email: string }) => {
    setLoading(true);
    try {
      const res = await request.post<null>('/api/auth/forgot-password', { email: values.email }, { silent: true });
      if (res.code === 0) {
        setSent(true);
      } else {
        Toast.error(res.message || '发送失败，请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSent(false);
    onClose();
  };

  return (
    <Modal
      title="找回密码"
      visible={visible}
      onCancel={handleClose}
      footer={null}
      width={400}
    >
      {sent ? (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Mail size={48} style={{ color: 'var(--semi-color-primary)', marginBottom: 16 }} />
          <p style={{ fontSize: 15, marginBottom: 8, fontWeight: 500 }}>重置链接已发送</p>
          <p style={{ color: 'var(--semi-color-text-2)', fontSize: 13 }}>
            如邮箱已注册，重置链接已发送至您的邮箱，请在 30 分钟内完成重置。
          </p>
          <Button type="primary" style={{ marginTop: 20 }} onClick={handleClose}>
            我知道了
          </Button>
        </div>
      ) : (
        <Form<{ email: string }> onSubmit={handleSubmit}>
          <p style={{ color: 'var(--semi-color-text-2)', fontSize: 13, marginBottom: 16 }}>
            请输入注册时使用的邮箱地址，我们将向该邮箱发送密码重置链接。
          </p>
          <Form.Input
            field="email"
            label="邮箱地址"
            placeholder="请输入邮箱"
            prefix={<Mail size={14} />}
            size="large"
            rules={[
              { required: true, message: '请输入邮箱地址' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
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
            发送重置链接
          </Button>
        </Form>
      )}
    </Modal>
  );
}
