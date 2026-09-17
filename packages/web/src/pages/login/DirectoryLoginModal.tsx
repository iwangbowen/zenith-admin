import { useState, type SubmitEvent } from 'react';
import { User, Lock } from 'lucide-react';
import type { TenantIdentityProviderSummary } from '@zenith/shared/identity';
import AppModal from '@/components/AppModal';
import { ModalFooter } from '@/components/ModalFooter';
import { useLoginForm, type FieldRules } from './login-form';
import { LoginField, LoginFormError } from './LoginField';

export interface DirectoryLoginValues extends Record<string, string> {
  username: string;
  password: string;
}

interface DirectoryLoginModalProps {
  provider: TenantIdentityProviderSummary | null;
  loading: boolean;
  onCancel: () => void;
  /** 返回错误文案时行内展示在表单里；成功返回 null */
  onSubmit: (values: DirectoryLoginValues) => Promise<string | null>;
}

const INITIAL: DirectoryLoginValues = { username: '', password: '' };
const RULES: FieldRules<DirectoryLoginValues> = {
  username: [{ required: true, message: '请输入目录账号' }],
  password: [{ required: true, message: '请输入目录密码' }],
};

/** LDAP / AD 目录账号登录弹窗：用户点击企业登录入口后才加载（Modal 不进登录页关键路径） */
export default function DirectoryLoginModal({ provider, loading, onCancel, onSubmit }: Readonly<DirectoryLoginModalProps>) {
  return (
    <AppModal
      title={provider ? `${provider.name} 登录` : '目录账号登录'}
      visible={!!provider}
      onCancel={onCancel}
      footer={null}
      closeOnEsc
      width={420}
    >
      {/* 按提供方重置表单：切换提供方不残留上一家的账号密码 */}
      <DirectoryLoginForm key={provider?.id ?? 'none'} loading={loading} onCancel={onCancel} onSubmit={onSubmit} />
    </AppModal>
  );
}

function DirectoryLoginForm({ loading, onCancel, onSubmit }: Readonly<Omit<DirectoryLoginModalProps, 'provider'>>) {
  const form = useLoginForm<DirectoryLoginValues>(INITIAL, RULES);
  const [submitting, setSubmitting] = useState(false);
  const busy = loading || submitting;

  const submit = async () => {
    const values = form.validate();
    if (!values || busy) return;
    setSubmitting(true);
    try {
      const message = await onSubmit(values);
      if (message) form.setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    void submit();
  };

  return (
    <form className="login-form" onSubmit={handleSubmit} noValidate>
      <LoginField
        {...form.field('username')}
        id="directory-login-username"
        label="账号"
        labelPosition="left"
        placeholder="目录账号 / 邮箱"
        prefix={<User />}
        size="large"
        autoComplete="username"
        autoFocus
      />
      <LoginField
        {...form.field('password')}
        id="directory-login-password"
        label="密码"
        labelPosition="left"
        mode="password"
        placeholder="目录密码"
        prefix={<Lock />}
        size="large"
        autoComplete="current-password"
      />
      <LoginFormError message={form.formError} />
      <ModalFooter onCancel={onCancel} onOk={submit} okText="登录" loading={busy} />
    </form>
  );
}
