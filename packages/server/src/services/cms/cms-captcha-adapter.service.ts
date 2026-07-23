import { HTTPException } from 'hono/http-exception';
import { httpPost } from '../../lib/http-client';
import { verifyCmsCaptcha } from './cms-captcha.service';

export const TURNSTILE_VERIFY_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type CmsResolvedCaptchaProvider = 'none' | 'math' | 'turnstile';

export async function verifyCmsCaptchaAdapter(input: {
  provider: CmsResolvedCaptchaProvider;
  captchaId?: string;
  captchaAnswer?: string;
  turnstileToken?: string;
  turnstileSecret?: string | null;
  ip: string;
}): Promise<boolean> {
  if (input.provider === 'none') return true;
  if (input.provider === 'math') {
    return verifyCmsCaptcha(input.captchaId, input.captchaAnswer);
  }
  if (!input.turnstileSecret?.trim()) {
    throw new HTTPException(500, { message: 'Turnstile 服务端密钥未配置' });
  }
  if (!input.turnstileToken?.trim()) return false;
  const body = new URLSearchParams({
    secret: input.turnstileSecret,
    response: input.turnstileToken,
    remoteip: input.ip,
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
}
