import { describe, expect, it } from 'vitest';
import { getSelectedMemberNavKey } from './member-nav';

describe('member nav model', () => {
  it('resolves active route keys', () => {
    expect(getSelectedMemberNavKey('/wallet')).toBe('/wallet');
    expect(getSelectedMemberNavKey('/wallet/detail')).toBe('/wallet');
    expect(getSelectedMemberNavKey('/profile/password')).toBe('/profile/password');
    expect(getSelectedMemberNavKey('/profile/security')).toBe('/profile/edit');
    expect(getSelectedMemberNavKey('/unknown')).toBe('/home');
  });
});
