import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsFormRow, CmsSiteRow } from '../../db/schema';

vi.mock('../../lib/http-client', () => ({ httpPost: vi.fn() }));
vi.mock('./cms-captcha.service', () => ({
  isCaptchaEnabled: vi.fn(() => false),
  verifyCmsCaptcha: vi.fn(async () => true),
}));

import { httpPost } from '../../lib/http-client';
import { isCaptchaEnabled } from './cms-captcha.service';
import {
  resolveCmsFormCaptcha, TURNSTILE_VERIFY_ENDPOINT, verifyCmsFormCaptcha,
} from './cms-form-captcha.service';

function form(overrides: Partial<CmsFormRow> = {}): CmsFormRow {
  return {
    captchaProvider: 'none',
    turnstileSiteKey: null,
    turnstileSecret: null,
    ...overrides,
  } as CmsFormRow;
}

const site = { settings: {} } as CmsSiteRow;

describe('CMS form captcha adapters', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves none/math independently while retaining inherit compatibility', () => {
    expect(resolveCmsFormCaptcha(form({ captchaProvider: 'none' }), site).provider).toBe('none');
    vi.mocked(isCaptchaEnabled).mockReturnValue(true);
    expect(resolveCmsFormCaptcha(form({ captchaProvider: 'inherit' }), site).provider).toBe('math');
  });

  it('verifies Turnstile only through the fixed official endpoint and safe http-client options', async () => {
    vi.mocked(httpPost).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Awaited<ReturnType<typeof httpPost>>);
    await expect(verifyCmsFormCaptcha({
      form: form({
        captchaProvider: 'turnstile',
        turnstileSiteKey: 'site-key',
        turnstileSecret: 'secret-key',
      }),
      site,
      raw: { 'cf-turnstile-response': 'verified-token' },
      ip: '203.0.113.10',
    })).resolves.toBeUndefined();
    expect(httpPost).toHaveBeenCalledWith(
      TURNSTILE_VERIFY_ENDPOINT,
      expect.any(URLSearchParams),
      expect.objectContaining({
        timeout: 5000,
        ssrfProtection: true,
        redirect: 'error',
      }),
    );
  });
});
