import { Input } from '@douyinfe/semi-ui';
import type { LoginCaptchaChallenge } from '@zenith/shared/identity';

interface CaptchaChallengeFieldProps {
  challenge: LoginCaptchaChallenge;
  value: string;
  onChange: (value: string) => void;
  onEnterPress?: () => void;
}

/**
 * 登录失败防护命中后的验证码输入（会员端登录表单共用）。
 * 图片由服务端随挑战下发，一次性使用；答错重新提交即可拿到新图（不会锁定账号）。
 */
export function CaptchaChallengeField({ challenge, value, onChange, onEnterPress }: Readonly<CaptchaChallengeFieldProps>) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
      <Input
        size="large"
        placeholder="请输入验证码"
        value={value}
        onChange={onChange}
        onEnterPress={onEnterPress}
        autoComplete="one-time-code"
      />
      <div
        title="验证码错误时重新提交会刷新"
        style={{
          flexShrink: 0,
          lineHeight: 0,
          border: '1px solid var(--semi-color-border)',
          borderRadius: 'var(--semi-border-radius-small)',
          overflow: 'hidden',
        }}
        dangerouslySetInnerHTML={{ __html: challenge.svg }}
      />
    </div>
  );
}
