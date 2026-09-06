import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MEMBER_NAV_ITEMS, getSelectedMemberNavKey, MemberNavIcon } from './member-nav';

describe('member nav model', () => {
  it('resolves active route keys', () => {
    expect(getSelectedMemberNavKey('/wallet')).toBe('/wallet');
    expect(getSelectedMemberNavKey('/wallet/detail')).toBe('/wallet');
    expect(getSelectedMemberNavKey('/profile/password')).toBe('/profile/password');
    expect(getSelectedMemberNavKey('/profile/security')).toBe('/profile/edit');
    expect(getSelectedMemberNavKey('/unknown')).toBe('/home');
  });

  it('renders unread badge capped at 99+', () => {
    const messages = MEMBER_NAV_ITEMS.find((item) => item.key === '/messages')!;
    const { container } = render(<MemberNavIcon item={messages} unread={120} size={20} />);
    expect(container.textContent).toContain('99+');
  });
});
