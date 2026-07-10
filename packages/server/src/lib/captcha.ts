import svgCaptcha from 'svg-captcha';
import crypto from 'node:crypto';

interface CaptchaEntry {
  text: string;
  expireAt: number;
}

const store = new Map<string, CaptchaEntry>();

const CAPTCHA_EXPIRE_MS = 5 * 60 * 1000; // 5 minutes

/** 验证码复杂度：low（干扰少、易识别）/ medium（默认）/ high（干扰强、防机器识别） */
export type CaptchaComplexity = 'low' | 'medium' | 'high';

const COMPLEXITY_PRESETS: Record<CaptchaComplexity, { mathMin: number; mathMax: number; mathOperator: string; noise: number }> = {
  low:    { mathMin: 1, mathMax: 9,  mathOperator: '+',  noise: 1 },
  medium: { mathMin: 1, mathMax: 20, mathOperator: '+-', noise: 3 },
  high:   { mathMin: 1, mathMax: 30, mathOperator: '+-', noise: 7 },
};

/** Normalize an arbitrary config value into a valid complexity level (fallback: medium) */
export function resolveCaptchaComplexity(value?: string): CaptchaComplexity {
  return value === 'low' || value === 'high' ? value : 'medium';
}

/** Clean up expired captchas */
export function cleanExpiredCaptchas(): number {
  const now = Date.now();
  let count = 0;
  for (const [id, entry] of store) {
    if (entry.expireAt < now) {
      store.delete(id);
      count++;
    }
  }
  return count;
}

/** Generate a math captcha and return id + SVG */
export function generateCaptcha(complexity: CaptchaComplexity = 'medium'): { captchaId: string; captchaImage: string } {
  const preset = COMPLEXITY_PRESETS[complexity];
  const captcha = svgCaptcha.createMathExpr({
    ...preset,
    color: true,
    background: '#f0f0f0',
    width: 120,
    height: 40,
  });

  const captchaId = crypto.randomUUID();
  store.set(captchaId, {
    text: captcha.text,
    expireAt: Date.now() + CAPTCHA_EXPIRE_MS,
  });

  return { captchaId, captchaImage: captcha.data };
}

/** Verify captcha — one-time use, removes entry after verification */
export function verifyCaptcha(captchaId: string, code: string): boolean {
  const entry = store.get(captchaId);
  if (!entry) return false;

  store.delete(captchaId);

  if (entry.expireAt < Date.now()) return false;

  return entry.text.toLowerCase() === code.toLowerCase();
}

/** Get current store size (for monitoring) */
export function getCaptchaStoreSize(): number {
  return store.size;
}
