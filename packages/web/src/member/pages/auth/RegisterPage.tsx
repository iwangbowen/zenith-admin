import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Button, Toast } from '@douyinfe/semi-ui';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import { useSmsCode } from '../../hooks/useSmsCode';
import { MemberAuthCard, SmsCodeField } from '../../components/MemberAuthCard';

const PHONE_REGEX = /^1[3-9]\d{9}$/;

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useMemberAuth();
  const { counting, send } = useSmsCode('register');
  const [loading, setLoading] = useState(false);
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');

  const handleRegister = async () => {
    if (!PHONE_REGEX.test(phone)) {
      Toast.warning('请输入正确的手机号');
      return;
    }
    if (smsCode.length !== 6) {
      Toast.warning('请输入 6 位验证码');
      return;
    }
    if (password && password.length < 6) {
      Toast.warning('密码至少 6 位');
      return;
    }
    setLoading(true);
    const res = await register({
      phone,
      smsCode,
      nickname: nickname || undefined,
      password: password || undefined,
    });
    setLoading(false);
    if (res.code === 0) {
      Toast.success('注册成功');
      navigate('/home', { replace: true });
    } else {
      Toast.error(res.message || '注册失败');
    }
  };

  return (
    <MemberAuthCard
      title="注册会员"
      subtitle="手机号快速注册，即刻享受会员权益"
      footer={(
        <>
          已有账户？
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
          placeholder="昵称（选填）"
          value={nickname}
          onChange={setNickname}
          style={{ marginBottom: 12 }}
        />
        <Input
          size="large"
          mode="password"
          placeholder="设置登录密码（选填，至少 6 位）"
          value={password}
          onChange={setPassword}
          onEnterPress={handleRegister}
          style={{ marginBottom: 20 }}
        />

        <Button
          size="large"
          theme="solid"
          block
          loading={loading}
          onClick={handleRegister}
          style={{ background: 'var(--m-primary)' }}
        >
          注册并登录
        </Button>
    </MemberAuthCard>
  );
}
