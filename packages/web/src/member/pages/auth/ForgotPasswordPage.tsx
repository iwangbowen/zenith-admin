import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Toast } from '@douyinfe/semi-ui';
import { useSmsCode } from '../../hooks/useSmsCode';
import { useResetMemberPassword } from '../../hooks/queries';
import { MemberAuthCard, SmsCodeField } from '../../components/MemberAuthCard';

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
      await resetPasswordMutation.mutateAsync({ body: { phone, smsCode, newPassword } });
      Toast.success('密码已重置，请重新登录');
      navigate('/login', { replace: true });
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : '重置失败');
    }
  };

  return (
    <MemberAuthCard
      title="重置密码"
      subtitle="通过手机验证码重置登录密码"
      footer={(
        <>
          想起密码了？
          <button type="button" className="mc-auth-link" onClick={() => navigate('/login')}>
            返回登录
          </button>
        </>
      )}
    >
        <SmsCodeField
          phone={phone}
          smsCode={smsCode}
          onPhoneChange={setPhone}
          onSmsCodeChange={setSmsCode}
          counting={counting}
          onSend={() => send(phone)}
        />
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
    </MemberAuthCard>
  );
}
