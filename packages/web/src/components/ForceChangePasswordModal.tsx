import { useRef, useState } from 'react';
import { Modal, Form, Notification } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { authContract, type User } from '@zenith/shared/identity';
import { api } from '@/lib/contract-query';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';
import ModalFooter from './ModalFooter';

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
  const [newPwdVal, setNewPwdVal] = useState('');
  const formApi = useRef<FormApi | null>(null);

  // We show the modal if requirePasswordChange is true.
  const visible = !!user.requirePasswordChange;

  const handleSubmit = async (values: FormValues) => {
    if (values.newPassword !== values.confirmPassword) {
      Notification.error({ title: '两次输入的密码不一致' });
      return;
    }
    setLoading(true);
    try {
      await api(authContract.changePassword, { body: { oldPassword: values.oldPassword, newPassword: values.newPassword } });
      Notification.success({ title: '密码修改成功，请重新登录' });
      setTimeout(() => {
        onLogout();
      }, 1500);
    } catch {
      // 失败提示由请求层统一弹出，弹窗保留供重试
    } finally {
      setLoading(false);
    }
  };

  const handleOk = async () => {
    if (!formApi.current) return;
    let values: FormValues;
    try {
      values = await formApi.current.validate() as FormValues;
    } catch {
      return;
    }
    await handleSubmit(values);
  };

  return (
    <Modal
      title="登录密码已过期，请修改密码"
      visible={visible}
      closeOnEsc={false}
      closable={false}
      maskClosable={false}
      hasCancel={false}
      footer={<ModalFooter onCancel={onLogout} onOk={handleOk} cancelText="退出登录" okText="确认修改" loading={loading} />}
    >
      <Form getFormApi={(api) => { formApi.current = api; }} labelPosition="left" labelWidth={80}>
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
          onChange={(v) => setNewPwdVal(String(v ?? ''))}
          helpText={<PasswordStrengthMeter password={newPwdVal} />}
        />
        <Form.Input
          field="confirmPassword"
          label="确认新密码"
          type="password"
          rules={[{ required: true, message: '请确认新密码' }]}
        />
      </Form>
    </Modal>
  );
}
