import svgCaptcha from 'svg-captcha';
import crypto from 'node:crypto';
import redis from './redis';
import { config } from '../config';

/**
 * 登录图形验证码。
 *
 * 存放在 Redis（而非进程内 Map）：api 角色可多节点部署，取验证码与提交登录很可能是
 * 不同节点，进程内存储会让校验随机失败；Redis TTL 顺带免去清理任务。
 */

const CAPTCHA_PREFIX = `${config.redis.keyPrefix}captcha:`;

/** 验证码有效期（秒） */
const CAPTCHA_TTL_SECONDS = 5 * 60;

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

/** Generate a math captcha, store its answer in Redis and return id + SVG */
export async function generateCaptcha(complexity: CaptchaComplexity = 'medium'): Promise<{ captchaId: string; captchaImage: string }> {
  const preset = COMPLEXITY_PRESETS[complexity];
  const captcha = svgCaptcha.createMathExpr({
    ...preset,
    color: true,
    background: '#f0f0f0',
    width: 120,
    height: 40,
  });

  const captchaId = crypto.randomUUID();
  await redis.setex(`${CAPTCHA_PREFIX}${captchaId}`, CAPTCHA_TTL_SECONDS, captcha.text);

  return { captchaId, captchaImage: captcha.data };
}

/** Verify captcha — one-time use (GETDEL), 任意节点可校验；Redis 故障按校验失败处理 */
export async function verifyCaptcha(captchaId: string, code: string): Promise<boolean> {
  if (!captchaId || !code) return false;
  const expected = await redis.getdel(`${CAPTCHA_PREFIX}${captchaId}`).catch(() => null);
  if (!expected) return false;
  return expected.toLowerCase() === code.trim().toLowerCase();
}

/**
 * 兼容既有定时任务（`cleanExpiredCaptchas`）：验证码改由 Redis TTL 自动过期，不再需要清理，
 * 但保留导出与 handler 注册，避免已初始化的环境里 cron 任务找不到处理器。
 */
export async function cleanExpiredCaptchas(): Promise<number> {
  return 0;
}
