import type { CmsFormRow, CmsSiteRow } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { httpPost } from '../../lib/http-client';
import { isCaptchaEnabled, verifyCmsCaptcha } from './cms-captcha.service';

const TURNSTILE_VERIFY_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type CmsResolvedCaptchaProvider = 'none' | 'math' | 'turnstile';

export interface CmsFormCaptchaRenderConfig {
  provider: CmsResolvedCaptchaProvider;
  siteKey: string | null;
}

export interface CmsFormCaptchaAdapter {
  provider: CmsResolvedCaptchaProvider;
  verify(input: {
    form: CmsFormRow;
    raw: Record<string, unknown>;
    ip: string;
  }): Promise<boolean>;
}

const noneAdapter: CmsFormCaptchaAdapter = {
  provider: 'none',
  verify: async () => true,
};

const mathAdapter: CmsFormCaptchaAdapter = {
  provider: 'math',
  verify: async ({ raw }) => verifyCmsCaptcha(
    typeof raw.captchaId === 'string' ? raw.captchaId : undefined,
    typeof raw.captchaAnswer === 'string' ? raw.captchaAnswer : undefined,
  ),
};

const turnstileAdapter: CmsFormCaptchaAdapter = {
  provider: 'turnstile',
  verify: async ({ form, raw, ip }) => {
    if (!form.turnstileSecret) throw new HTTPException(500, { message: 'Turnstile 服务端密钥未配置' });
    const token = typeof raw['cf-turnstile-response'] === 'string'
      ? raw['cf-turnstile-response']
      : (typeof raw.turnstileToken === 'string' ? raw.turnstileToken : '');
    if (!token) return false;
    const body = new URLSearchParams({
      secret: form.turnstileSecret,
      response: token,
      remoteip: ip,
    });
    const response = await httpPost(TURNSTILE_VERIFY_ENDPOINT, body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 5000,
      ssrfProtection: true,
      redirect: 'error',
    });
    if (!response.ok) return false;
    const result = await response.json().catch(() => null) as { success?: boolean } | null;
    return result?.success === true;
  },
};

const adapters: Record<CmsResolvedCaptchaProvider, CmsFormCaptchaAdapter> = {
  none: noneAdapter,
  math: mathAdapter,
  turnstile: turnstileAdapter,
};

export function resolveCmsFormCaptcha(form: CmsFormRow, site: CmsSiteRow): CmsFormCaptchaRenderConfig {
  const provider: CmsResolvedCaptchaProvider = form.captchaProvider === 'inherit'
    ? (isCaptchaEnabled(site) ? 'math' : 'none')
    : form.captchaProvider;
  return {
    provider,
    siteKey: provider === 'turnstile' ? (form.turnstileSiteKey ?? null) : null,
  };
}

export async function verifyCmsFormCaptcha(input: {
  form: CmsFormRow;
  site: CmsSiteRow;
  raw: Record<string, unknown>;
  ip: string;
}): Promise<void> {
  const config = resolveCmsFormCaptcha(input.form, input.site);
  const passed = await adapters[config.provider].verify({
    form: input.form,
    raw: input.raw,
    ip: input.ip,
  });
  if (!passed) throw new HTTPException(400, { message: '验证码验证失败，请重试' });
}

export { TURNSTILE_VERIFY_ENDPOINT };
