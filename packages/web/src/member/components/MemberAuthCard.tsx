import type { ReactNode } from 'react';
import { Button, Input, PinCode } from '@douyinfe/semi-ui';
import { Crown } from 'lucide-react';

export function MemberAuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="mc-auth-wrap">
      <div className="mc-auth-card">
        <div className="mc-auth-logo">
          <Crown size={28} />
        </div>
        <div className="mc-auth-title">{title}</div>
        <div className="mc-auth-sub">{subtitle}</div>
        {children}
        <div className="mc-auth-footer">{footer}</div>
      </div>
    </div>
  );
}

export function SmsCodeField({
  phone,
  smsCode,
  onPhoneChange,
  onSmsCodeChange,
  counting,
  onSend,
}: {
  phone: string;
  smsCode: string;
  onPhoneChange: (value: string) => void;
  onSmsCodeChange: (value: string) => void;
  counting: number;
  onSend: () => void;
}) {
  return (
    <>
      <Input
        size="large"
        placeholder="手机号"
        value={phone}
        onChange={onPhoneChange}
        style={{ marginBottom: 12 }}
      />
      <div style={{ marginBottom: 12 }}>
        <PinCode
          count={6}
          value={smsCode}
          onChange={onSmsCodeChange}
        />
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <Button theme="borderless" size="small" disabled={counting > 0} onClick={onSend}>
            {counting > 0 ? `${counting}s` : '获取验证码'}
          </Button>
        </div>
      </div>
    </>
  );
}
