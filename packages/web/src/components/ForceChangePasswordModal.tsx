import { useState } from 'react';
import { Modal, Form, Button, Notification } from '@douyinfe/semi-ui';
import type { User } from '@zenith/shared';
import { request } from '@/utils/request';

interface Props {
  readonly user: Pick<User, 'requirePasswordChange'>;
  readonly onLogout: () => void;
}

interface FormValues {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function ForceChangePasswordModal({ user, onLogout }: Props) {
  const [loading, setLoading] = useState(false);

  // We show the modal if requirePasswordChange is true.
  const visible = !!user.requirePasswordChange;

  const handleSubmit = async (values: FormValues) => {
    if (values.newPassword !== values.confirmPassword) {
      Notification.error({ title: '两次输入的密码不一致' });
      return;
    }
    setLoading(true);
    try {
      const res = await request.put('/api/auth/password', {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      if (res.code === 0) {
        Notification.success({ title: '密码修改成功，请重新登录' });
        setTimeout(() => {
          onLogout();
        }, 1500);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="登录密码已过期，请修改密码"
      visible={visible}
      closeOnEsc={false}
      closable={false}
      maskClosable={false}
      hasCancel={false}
      footer={null}
    >
      <Form onSubmit={handleSubmit} labelPosition="left" labelWidth={80}>
        <Form.Input
          field="oldPassword"
          label="原密码"
          type="password"
          rules={[{ required: true, message: '请输入原密码' }]}
        />
        <Form.Input
          field="newPassword"
          label="新密码"
          type="password"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '密码至少6个字符' },
          ]}
        />
        <Form.Input
          field="confirmPassword"
          label="确认新密码"
          type="password"
          rules={[{ required: true, message: '请确认新密码' }]}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          <Button onClick={onLogout} disabled={loading}>
            退出登录
          </Button>
          <Button type="primary" htmlType="submit" loading={loading}>
            确认修改
          </Button>
        </div>
      </Form>
    </Modal>
  );
}
