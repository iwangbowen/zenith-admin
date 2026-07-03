import { useRef, useState } from 'react';
import { Form, Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import AppModal from '@/components/AppModal';
import { Mail } from 'lucide-react';
import { useForgotPassword } from '@/hooks/queries/auth-public';

interface ForgotPasswordModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function ForgotPasswordModal({ visible, onClose }: Readonly<ForgotPasswordModalProps>) {
  const [sent, setSent] = useState(false);
  const formApi = useRef<FormApi | null>(null);
  const forgotPasswordMutation = useForgotPassword();
  const loading = forgotPasswordMutation.isPending;

  const handleSubmit = async (values: { email: string }) => {
    try {
      await forgotPasswordMutation.mutateAsync({ email: values.email });
      setSent(true);
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '发送失败，请稍后重试');
    }
  };

  const handleClose = () => {
    setSent(false);
    formApi.current = null;
    onClose();
  };

  const handleOk = async () => {
    if (sent) {
      handleClose();
      return;
    }
    if (!formApi.current) return;
    let values: { email: string };
    try {
      values = await formApi.current.validate() as { email: string };
    } catch {
      throw new Error('validation');
    }
    await handleSubmit(values);
  };

  return (
    <AppModal
      title="找回密码"
      visible={visible}
      onCancel={handleClose}
      onOk={handleOk}
      okText={sent ? '我知道了' : '发送重置链接'}
      cancelText="取消"
      hasCancel={!sent}
      okButtonProps={{ loading }}
      width={400}
    >
      {sent ? (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Mail size={48} style={{ color: 'var(--semi-color-primary)', marginBottom: 16 }} />
          <p style={{ fontSize: 15, marginBottom: 8, fontWeight: 500 }}>重置链接已发送</p>
          <p style={{ color: 'var(--semi-color-text-2)', fontSize: 13 }}>
            如邮箱已注册，重置链接已发送至您的邮箱，请在 30 分钟内完成重置。
          </p>
        </div>
      ) : (
        <Form<{ email: string }>
          key={visible ? 'forgot-password-open' : 'forgot-password-closed'}
          getFormApi={(api) => { formApi.current = api; }}
          labelPosition="left"
          labelWidth={72}
        >
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
        </Form>
      )}
    </AppModal>
  );
}
