import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemberAuthCard, SmsCodeField } from './MemberAuthCard';

describe('MemberAuthCard', () => {
  it('renders title and footer', () => {
    render(<MemberAuthCard title="注册会员" subtitle="手机号快速注册" footer={<button type="button">返回登录</button>}><div>表单</div></MemberAuthCard>);

    expect(screen.getByText('注册会员')).toBeTruthy();
    expect(screen.getByText('手机号快速注册')).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回登录' })).toBeTruthy();
  });

  it('disables SMS send while counting', () => {
    render(<SmsCodeField phone="13800138000" smsCode="123456" onPhoneChange={vi.fn()} onSmsCodeChange={vi.fn()} counting={12} onSend={vi.fn()} />);

    expect(screen.getByRole('button', { name: '12s' })).toBeDisabled();
  });
});
