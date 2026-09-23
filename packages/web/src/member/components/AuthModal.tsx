import { PasswordInput } from '@/components/PasswordInput';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Input, Button, PinCode, Toast } from '@douyinfe/semi-ui';
import { Crown } from 'lucide-react';
import type { LoginCaptchaChallenge } from '@zenith/shared/identity';
import { useMemberAuth } from '../hooks/useMemberAuth';
import { useSmsCode } from '../hooks/useSmsCode';
import { CaptchaChallengeField } from './CaptchaChallengeField';

const PHONE_REGEX = /^1[3-9]\d{9}$/;

interface AuthModalProps {
  visible: boolean;
  onClose: () => void;
  defaultTab?: 'login' | 'register';
}

export function AuthModal({ visible, onClose, defaultTab = 'login' }: Readonly<AuthModalProps>) {
  const navigate = useNavigate();
  const { login, register } = useMemberAuth();
  const [mode, setMode] = useState<'login' | 'register'>(defaultTab);
  const [loginType, setLoginType] = useState<'password' | 'sms'>('password');
  const loginSms = useSmsCode('login');
  const registerSms = useSmsCode('register');
  const [loading, setLoading] = useState(false);

  // Form state
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [loginSmsCode, setLoginSmsCode] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regCode, setRegCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [regPassword, setRegPassword] = useState('');
  // 登录失败防护命中后服务端下发的验证码挑战（不锁定账号，答对即可继续登录）
  const [captcha, setCaptcha] = useState<LoginCaptchaChallenge | null>(null);
  const [captchaCode, setCaptchaCode] = useState('');
  // 邀请码：支持从邀请链接 #/?invite=XXXX 预填
  const [inviteCode, setInviteCode] = useState(() => {
    const hashQuery = window.location.hash.split('?')[1];
    return new URLSearchParams(hashQuery ?? '').get('invite') ?? '';
  });

  useEffect(() => {
    if (visible) setMode(defaultTab);
  }, [visible, defaultTab]);

  const handleLogin = async () => {
    if (loginType === 'password') {
      if (!account || !password) { Toast.warning('请输入账号和密码'); return; }
      if (captcha && !captchaCode.trim()) { Toast.warning('请输入验证码'); return; }
    } else if (!PHONE_REGEX.test(loginPhone) || loginSmsCode.length !== 6) {
      Toast.warning('请输入手机号和 6 位验证码'); return;
    }
    setLoading(true);
    const res = await login(
      loginType === 'password'
        ? { loginType: 'password', account, password, ...(captcha ? { captchaId: captcha.captchaId, captchaCode } : {}) }
        : { loginType: 'sms', phone: loginPhone, smsCode: loginSmsCode },
    );
    setLoading(false);
    if (res.code === 0) {
      if ('captchaRequired' in res.data) {
        setCaptcha(res.data);
        setCaptchaCode('');
        Toast.warning(res.data.message);
        return;
      }
      Toast.success('登录成功');
      onClose();
    } else {
      Toast.error(res.message || '登录失败');
    }
  };

  const handleRegister = async () => {
    if (!PHONE_REGEX.test(regPhone)) { Toast.warning('请输入正确的手机号'); return; }
    if (regCode.length !== 6) { Toast.warning('请输入 6 位验证码'); return; }
    if (regPassword && regPassword.length < 6) { Toast.warning('密码至少 6 位'); return; }
    setLoading(true);
    const res = await register({
      phone: regPhone,
      smsCode: regCode,
      nickname: nickname || undefined,
      password: regPassword || undefined,
      inviteCode: inviteCode.trim() || undefined,
    });
    setLoading(false);
    if (res.code === 0) {
      Toast.success('注册成功');
      onClose();
    } else {
      Toast.error(res.message || '注册失败');
    }
  };

  return (
    <Modal
      visible={visible}
      onCancel={onClose}
      footer={null}
      closeOnEsc
      title={null}
      width={440}
      centered
    >
      <div style={{ padding: '8px 0 4px' }}>
        <div className="mc-auth-logo" style={{ margin: '0 auto 12px' }}>
          <Crown size={26} />
        </div>

        {/* Login / Register mode tabs */}
        <div className="mc-auth-tabs" style={{ justifyContent: 'center', marginBottom: 24 }}>
          <button type="button" className={`mc-auth-tab${mode === 'login' ? ' active' : ''}`} onClick={() => setMode('login')}>
            登录
          </button>
          <button type="button" className={`mc-auth-tab${mode === 'register' ? ' active' : ''}`} onClick={() => setMode('register')}>
            注册
          </button>
        </div>

        {mode === 'login' ? (
          <div>
            <div className="mc-auth-tabs" style={{ marginBottom: 16 }}>
              <button type="button" className={`mc-auth-tab${loginType === 'password' ? ' active' : ''}`} style={{ fontSize: 14 }} onClick={() => setLoginType('password')}>
                密码登录
              </button>
              <button type="button" className={`mc-auth-tab${loginType === 'sms' ? ' active' : ''}`} style={{ fontSize: 14 }} onClick={() => setLoginType('sms')}>
                验证码登录
              </button>
            </div>

            {loginType === 'password' ? (
              <>
                <Input size="large" placeholder="手机号 / 邮箱 / 用户名" value={account} onChange={setAccount} style={{ marginBottom: 12 }} />
                <PasswordInput size="large" placeholder="登录密码" value={password} onChange={setPassword} onEnterPress={handleLogin} />
                {captcha && (
                  <CaptchaChallengeField challenge={captcha} value={captchaCode} onChange={setCaptchaCode} onEnterPress={handleLogin} />
                )}
              </>
            ) : (
              <>
                <Input size="large" placeholder="手机号" value={loginPhone} onChange={setLoginPhone} style={{ marginBottom: 12 }} />
                <div onKeyDown={(e) => { if (e.key === 'Enter') void handleLogin(); }}>
                  <PinCode count={6} value={loginSmsCode} onChange={setLoginSmsCode} />
                  <div style={{ textAlign: 'right', marginTop: 8 }}>
                    <Button theme="borderless" size="small" disabled={loginSms.counting > 0} onClick={() => loginSms.send(loginPhone)}>
                      {loginSms.counting > 0 ? `${loginSms.counting}s` : '获取验证码'}
                    </Button>
                  </div>
                </div>
              </>
            )}

            <div style={{ textAlign: 'right', margin: '10px 0 20px' }}>
              <button type="button" className="mc-auth-link" onClick={() => { onClose(); navigate('/forgot-password'); }}>
                忘记密码？
              </button>
            </div>
            <Button size="large" theme="solid" block loading={loading} onClick={handleLogin} style={{ background: 'var(--m-primary)' }}>
              登录
            </Button>
          </div>
        ) : (
          <div>
            <Input size="large" placeholder="手机号" value={regPhone} onChange={setRegPhone} style={{ marginBottom: 12 }} />
            <div style={{ marginBottom: 12 }}>
              <PinCode count={6} value={regCode} onChange={setRegCode} />
              <div style={{ textAlign: 'right', marginTop: 8 }}>
                <Button theme="borderless" size="small" disabled={registerSms.counting > 0} onClick={() => registerSms.send(regPhone)}>
                  {registerSms.counting > 0 ? `${registerSms.counting}s` : '获取验证码'}
                </Button>
              </div>
            </div>
            <Input size="large" placeholder="昵称（选填）" value={nickname} onChange={setNickname} style={{ marginBottom: 12 }} />
            <PasswordInput size="large" placeholder="设置密码（选填，至少 6 位）" value={regPassword} onChange={setRegPassword} style={{ marginBottom: 12 }} />
            <Input size="large" placeholder="邀请码（选填）" value={inviteCode} onChange={setInviteCode} onEnterPress={handleRegister} style={{ marginBottom: 20 }} />
            <Button size="large" theme="solid" block loading={loading} onClick={handleRegister} style={{ background: 'var(--m-primary)' }}>
              注册并登录
            </Button>
          </div>
        )}

        <div className="mc-auth-footer">
          {mode === 'login' ? (
            <>还没有账户？<button type="button" className="mc-auth-link" onClick={() => setMode('register')}>立即注册</button></>
          ) : (
            <>已有账户？<button type="button" className="mc-auth-link" onClick={() => setMode('login')}>返回登录</button></>
          )}
        </div>
      </div>
    </Modal>
  );
}
