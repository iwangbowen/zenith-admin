import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@zenith/shared';
import { approvalRequest } from '../lib/approval-request';

interface LoginResult {
  token?: { accessToken: string; refreshToken: string };
  requirePasswordChange?: boolean;
  mfaRequired?: boolean;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  let formApi: FormApi | null = null;

  const submit = async () => {
    if (!formApi || submitting) return;
    try {
      const values = await formApi.validate() as { username: string; password: string };
      setSubmitting(true);
      const res = await approvalRequest.post<LoginResult>('/api/auth/login', values, { skipAuth: true, silent: true });
      if (res.code !== 0) {
        Toast.error(res.message || '登录失败');
        return;
      }
      const token = res.data?.token;
      if (!token?.accessToken) {
        // MFA / 强制改密等增强流程不在轻页覆盖范围
        Toast.info('该账号需要在桌面端完成登录（MFA 或修改密码）');
        return;
      }
      localStorage.setItem(TOKEN_KEY, token.accessToken);
      if (token.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, token.refreshToken);
      navigate('/', { replace: true });
    } catch {
      /* 校验失败 */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ap-login">
      <div className="ap-login__brand">
        <Typography.Title heading={3} style={{ margin: 0 }}>移动审批</Typography.Title>
        <Typography.Text type="tertiary">Zenith Admin · 随时随地处理审批</Typography.Text>
      </div>
      <Form getFormApi={(api) => { formApi = api; }} onSubmit={() => void submit()}>
        <Form.Input
          field="username"
          noLabel
          size="large"
          placeholder="用户名"
          rules={[{ required: true, message: '请输入用户名' }]}
        />
        <Form.Input
          field="password"
          noLabel
          size="large"
          mode="password"
          placeholder="密码"
          rules={[{ required: true, message: '请输入密码' }]}
        />
        <Button
          theme="solid"
          type="primary"
          size="large"
          block
          loading={submitting}
          style={{ marginTop: 12, height: 44 }}
          onClick={() => void submit()}
        >
          登录
        </Button>
      </Form>
      <Typography.Text type="tertiary" size="small" style={{ textAlign: 'center', marginTop: 16 }}>
        与后台管理系统共用账号；已在本浏览器登录后台时无需重复登录
      </Typography.Text>
    </div>
  );
}
