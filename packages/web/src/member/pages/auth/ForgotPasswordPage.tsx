import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Toast } from '@douyinfe/semi-ui';
import { Crown } from 'lucide-react';
import { useSmsCode } from '../../hooks/useSmsCode';
import { useResetMemberPassword } from '../../hooks/queries';

const PHONE_REGEX = /^1[3-9]\d{9}$/;

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { counting, send } = useSmsCode('reset');
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const resetPasswordMutation = useResetMemberPassword();

  const handleReset = async () => {
    if (!PHONE_REGEX.test(phone)) {
      Toast.warning('请输入正确的手机号');
      return;
    }
    if (smsCode.length !== 6) {
      Toast.warning('请输入 6 位验证码');
      return;
    }
    if (newPassword.length < 6) {
      Toast.warning('新密码至少 6 位');
      return;
    }
    try {
      await resetPasswordMutation.mutateAsync({ phone, smsCode, newPassword });
      Toast.success('密码已重置，请重新登录');
      navigate('/login', { replace: true });
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '重置失败');
    }
  };

  return (
    <div className="mc-auth-wrap">
      <div className="mc-auth-card">
        <div className="mc-auth-logo">
          <Crown size={28} />
        </div>
        <div className="mc-auth-title">重置密码</div>
        <div className="mc-auth-sub">通过手机验证码重置登录密码</div>

        <Input
          size="large"
          placeholder="手机号"
          value={phone}
          onChange={setPhone}
          style={{ marginBottom: 12 }}
        />
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Input
            size="large"
            placeholder="6 位验证码"
            value={smsCode}
            onChange={setSmsCode}
            style={{ flex: 1 }}
          />
          <Button size="large" disabled={counting > 0} onClick={() => send(phone)}>
            {counting > 0 ? `${counting}s` : '获取验证码'}
          </Button>
        </div>
        <Input
          size="large"
          mode="password"
          placeholder="新密码（至少 6 位）"
          value={newPassword}
          onChange={setNewPassword}
          onEnterPress={handleReset}
          style={{ marginBottom: 20 }}
        />

        <Button
          size="large"
          theme="solid"
          block
          loading={resetPasswordMutation.isPending}
          onClick={handleReset}
          style={{ background: 'var(--m-primary)' }}
        >
          重置密码
        </Button>

        <div className="mc-auth-footer">
          想起密码了？
          <button type="button" className="mc-auth-link" onClick={() => navigate('/login')}>
            返回登录
          </button>
        </div>
      </div>
    </div>
  );
}
