import type { CmsFormRow, CmsSiteRow } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { isCaptchaEnabled } from './cms-captcha.service';
import {
  TURNSTILE_VERIFY_ENDPOINT,
  type CmsResolvedCaptchaProvider,
  verifyCmsCaptchaAdapter,
} from './cms-captcha-adapter.service';

export interface CmsFormCaptchaRenderConfig {
  provider: CmsResolvedCaptchaProvider;
  siteKey: string | null;
}

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
  const passed = await verifyCmsCaptchaAdapter({
    provider: config.provider,
    captchaId: typeof input.raw.captchaId === 'string' ? input.raw.captchaId : undefined,
    captchaAnswer: typeof input.raw.captchaAnswer === 'string' ? input.raw.captchaAnswer : undefined,
    turnstileToken: typeof input.raw['cf-turnstile-response'] === 'string'
      ? input.raw['cf-turnstile-response']
      : (typeof input.raw.turnstileToken === 'string' ? input.raw.turnstileToken : undefined),
    turnstileSecret: input.form.turnstileSecret,
    ip: input.ip,
  });
  if (!passed) throw new HTTPException(400, { message: '验证码验证失败，请重试' });
}

export { TURNSTILE_VERIFY_ENDPOINT };
