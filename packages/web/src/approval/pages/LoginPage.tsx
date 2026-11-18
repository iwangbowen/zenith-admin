import { FormPasswordInput } from '@/components/PasswordInput';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Banner, Button, Form, Input, Toast, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { TOKEN_KEY } from '@zenith/shared/core';
import { authContract, type LoginResult } from '@zenith/shared/identity';
import { api } from '@/lib/contract-query';
import { ApiError } from '@/lib/query';
import { getPreciseOs } from '@/utils/client-os';
import { approvalRequest } from '../lib/approval-request';
import { activateApprovalSession, approvalReturnTo } from '../lib/session';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = approvalReturnTo((location.state as { returnTo?: string } | null)?.returnTo);
  const [submitting, setSubmitting] = useState(false);
  const formApi = useRef<FormApi | null>(null);
  const [challenge, setChallenge] = useState<Exclude<LoginResult, { token: unknown }> | null>(null);
  const [code, setCode] = useState('');
  const accept = (result: LoginResult) => {
    if ('token' in result) { activateApprovalSession(result.token); navigate(returnTo, { replace: true }); }
    else { setChallenge(result); setCode(''); }
  };

  // 已登录（admin 同域 token 存在）时直接进列表
  useEffect(() => {
    if (localStorage.getItem(TOKEN_KEY)) navigate(returnTo, { replace: true });
  }, [navigate, returnTo]);

  const submit = async () => {
    if (!formApi.current || submitting) return;
    let values: { username: string; password: string };
    try {
      values = await formApi.current.validate() as { username: string; password: string };
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      // 精确 OS 自报（Win11 等 UA 冻结的系统）；拿不到时服务端回退 UA 解析
      const options = { client: approvalRequest, skipAuth: true, silent: true };
      if (challenge && 'mfaRequired' in challenge) accept(await api(authContract.mfaVerify, { body: { challengeId: challenge.challengeId, code, rememberDevice: false } }, options));
      else if (challenge && 'sessionConflict' in challenge) accept(await api(authContract.resolveSessionConflict, { body: { ticket: challenge.ticket } }, options));
      else accept(await api(authContract.login, { body: { ...values, os: await getPreciseOs(), ...(challenge && 'captchaRequired' in challenge ? { captchaId: challenge.captchaId, captchaCode: code } : {}) } }, options));
    } catch (err) {
      Toast.error((err instanceof ApiError && err.message) || '登录失败');
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
      <Form getFormApi={(api) => { formApi.current = api; }} onSubmit={() => void submit()}>
        <Form.Input
          field="username"
          noLabel
          size="large"
          placeholder="用户名/手机号"
          rules={[{ required: true, message: '请输入用户名/手机号' }]}
        />
        <FormPasswordInput
          field="password"
          noLabel
          size="large"
          placeholder="密码"
          rules={[{ required: true, message: '请输入密码' }]}
        />
        {challenge && 'captchaRequired' in challenge && <><Banner type="warning" description={challenge.message} /><img alt="登录验证码" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(challenge.svg)}`} /><Input value={code} onChange={setCode} placeholder="请输入图片验证码" /></>}
        {challenge && 'mfaRequired' in challenge && <><Banner type="info" description={challenge.reason || '请输入多因素认证码'} /><Input value={code} onChange={setCode} placeholder="认证码 / 恢复码" /></>}
        {challenge && 'sessionConflict' in challenge && <Banner type="warning" description={`当前已有 ${challenge.sessions.length} 个在线会话。确认后将下线其它设备并登录。`} />}
        <Button
          theme="solid"
          type="primary"
          size="large"
          block
          loading={submitting}
          style={{ marginTop: 12, height: 44 }}
          onClick={() => void submit()}
        >
          {challenge && 'sessionConflict' in challenge ? '下线其它设备并登录' : challenge && 'mfaRequired' in challenge ? '验证并登录' : '登录'}
        </Button>
      </Form>
      <Typography.Text type="tertiary" size="small" style={{ textAlign: 'center', marginTop: 16 }}>
        与后台管理系统共用账号；已在本浏览器登录后台时无需重复登录
      </Typography.Text>
    </div>
  );
}
