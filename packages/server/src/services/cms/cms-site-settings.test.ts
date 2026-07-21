import { describe, expect, it } from 'vitest';
import { CMS_SECRET_MASK } from '@zenith/shared';
import {
  mergeCmsSiteSettings, normalizeNewCmsSiteSettings, redactCmsSiteSettings,
} from './cms-site-settings';

describe('CMS site secret boundary', () => {
  const stored = {
    webhookUrl: 'https://hooks.example.com/cms',
    webhookSecret: 'webhook-real-secret',
    cdnPurgeToken: 'cdn-real-token',
    baiduPushToken: 'baidu-real-token',
    indexNowKey: 'indexnow-real-key',
    themeConfig: { apiKey: 'nested-secret', color: '#fff' },
  };

  it('never returns raw sensitive settings from response/export mapping', () => {
    const redacted = redactCmsSiteSettings(stored);
    expect(JSON.stringify(redacted)).not.toContain('real-');
    expect(redacted.webhookSecret).toBe(CMS_SECRET_MASK);
    expect((redacted.themeConfig as Record<string, unknown>).apiKey).toBe(CMS_SECRET_MASK);
  });

  it('retains stored secrets for blank or masked form values', () => {
    expect(mergeCmsSiteSettings(stored, {
      webhookSecret: '',
      cdnPurgeToken: CMS_SECRET_MASK,
      indexNowKey: CMS_SECRET_MASK,
    })).toMatchObject({
      webhookSecret: stored.webhookSecret,
      cdnPurgeToken: stored.cdnPurgeToken,
      indexNowKey: stored.indexNowKey,
    });
  });

  it('supports explicit null clearing and drops placeholders on create/import', () => {
    const cleared = mergeCmsSiteSettings(stored, {
      webhookSecret: null,
      cdnPurgeToken: null,
      baiduPushToken: null,
      indexNowKey: null,
    });
    expect(cleared).not.toHaveProperty('webhookSecret');
    expect(cleared).not.toHaveProperty('cdnPurgeToken');
    expect(cleared).not.toHaveProperty('baiduPushToken');
    expect(cleared).not.toHaveProperty('indexNowKey');
    expect(normalizeNewCmsSiteSettings({
      webhookSecret: CMS_SECRET_MASK,
      cdnPurgeToken: '',
      webhookUrl: stored.webhookUrl,
      themeConfig: { apiKey: CMS_SECRET_MASK, color: '#fff' },
    })).toEqual({
      webhookUrl: stored.webhookUrl,
      themeConfig: { color: '#fff' },
    });
  });
});
