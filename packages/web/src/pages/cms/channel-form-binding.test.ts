import { describe, expect, it } from 'vitest';
import { channelBoundFormCode, channelSettingsWithForm } from './channel-form-binding';

describe('栏目自定义表单绑定', () => {
  it('reads and persists formCode while preserving other channel settings', () => {
    const settings = { formCode: 'contact', banner: '/banner.png', options: { inherit: true } };
    expect(channelBoundFormCode({ settings })).toBe('contact');
    expect(channelSettingsWithForm(settings, 'page', 'signup')).toEqual({ formCode: 'signup', banner: '/banner.png', options: { inherit: true } });
  });
  it('clears the binding on explicit clear or a change away from a single page', () => {
    const settings = { formCode: 'contact', allowComment: false };
    expect(channelSettingsWithForm(settings, 'page', undefined)).toEqual({ allowComment: false });
    expect(channelSettingsWithForm(settings, 'list', 'contact')).toEqual({ allowComment: false });
    expect(channelSettingsWithForm(settings, 'link', 'contact')).toEqual({ allowComment: false });
    expect(channelBoundFormCode(null)).toBeUndefined();
  });
});
