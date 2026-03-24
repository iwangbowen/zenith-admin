import svgCaptcha from 'svg-captcha';
import crypto from 'node:crypto';

interface CaptchaEntry {
  text: string;
  expireAt: number;
}

const store = new Map<string, CaptchaEntry>();

const CAPTCHA_EXPIRE_MS = 5 * 60 * 1000; // 5 minutes

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
export function generateCaptcha(): { captchaId: string; captchaImage: string } {
  const captcha = svgCaptcha.createMathExpr({
    mathMin: 1,
    mathMax: 20,
    mathOperator: '+-',
    noise: 3,
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
