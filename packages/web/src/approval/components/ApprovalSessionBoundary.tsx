import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banner, Button, Form, Spin, Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { authContract } from '@zenith/shared/identity';
import { api } from '@/lib/contract-query';
import { approvalRequest } from '../lib/approval-request';
import { clearApprovalSession } from '../lib/session';

export default function ApprovalSessionBoundary({ children }: { children: ReactNode }) {
  const me = useQuery({ queryKey: ['approval', 'me'], queryFn: () => api(authContract.me, { client: approvalRequest, silent: true }), retry: false });
  const form = useRef<FormApi | null>(null);
  const [saving, setSaving] = useState(false);
  const changePassword = async () => {
    try {
      const values = await form.current?.validate() as { oldPassword: string; newPassword: string; confirm: string };
      if (values.newPassword !== values.confirm) { Toast.warning('两次输入的新密码不一致'); return; }
      setSaving(true);
      await api(authContract.changePassword, { body: { oldPassword: values.oldPassword, newPassword: values.newPassword } }, { client: approvalRequest });
      Toast.success('密码已修改，请重新登录'); clearApprovalSession();
    } catch { /* validation/request owns errors */ } finally { setSaving(false); }
  };
  if (me.isPending) return <div className="ap-empty"><Spin /></div>;
  if (!me.data) return <div className="ap-empty"><Banner type="danger" description="无法确认当前会话，请重试或重新登录" /><Button onClick={() => void me.refetch()}>重试</Button><Button onClick={clearApprovalSession}>重新登录</Button></div>;
  if (me.data.requirePasswordChange) return <div className="ap-login"><h2>请修改登录密码</h2><Form getFormApi={api => { form.current = api; }}>
    <Form.Input field="oldPassword" mode="password" label="原密码" rules={[{ required: true }]} />
    <Form.Input field="newPassword" mode="password" label="新密码" rules={[{ required: true }, { min: 6 }]} />
    <Form.Input field="confirm" mode="password" label="确认新密码" rules={[{ required: true }]} />
  </Form><Button block theme="solid" loading={saving} onClick={() => void changePassword()}>修改密码</Button><Button block onClick={clearApprovalSession}>退出登录</Button></div>;
  return children;
}
