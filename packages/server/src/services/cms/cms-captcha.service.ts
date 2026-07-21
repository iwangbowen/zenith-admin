import { randomInt, randomUUID } from 'node:crypto';
import { config } from '../../config';
import redis from '../../lib/redis';
import type { CmsSiteRow } from '../../db/schema';

/**
 * CMS 前台图形验证码（P3）：算术题 SVG，答案存 Redis 一次性校验。
 * 站点 settings.captchaEnabled 开启后，评论 / 自定义表单提交必须携带有效验证码。
 */

const CAPTCHA_PREFIX = `${config.redis.keyPrefix}cms:captcha:`;
const CAPTCHA_TTL_SECONDS = 5 * 60;

export interface CmsCaptchaChallenge {
  id: string;
  /** 内联 SVG（前台直接插入 DOM） */
  svg: string;
}

function noiseLines(width: number, height: number, count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x1 = randomInt(0, width);
    const y1 = randomInt(0, height);
    const x2 = randomInt(0, width);
    const y2 = randomInt(0, height);
    out += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#9aa4b2" stroke-opacity="0.45" stroke-width="1"/>`;
  }
  return out;
}

function buildSvg(text: string): string {
  const width = 120;
  const height = 40;
  let glyphs = '';
  const startX = 14;
  const step = (width - startX * 2) / (text.length - 1 || 1);
  for (let i = 0; i < text.length; i++) {
    const x = startX + step * i;
    const y = 26 + randomInt(-4, 5);
    const rotate = randomInt(-18, 19);
    glyphs += `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#334155" text-anchor="middle">${text[i]}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f1f5f9" rx="4"/>${noiseLines(width, height, 5)}${glyphs}</svg>`;
}

/** 生成算术验证码（a+b / a-b，答案 0-18），答案入 Redis */
export async function generateCmsCaptcha(): Promise<CmsCaptchaChallenge> {
  const a = randomInt(1, 10);
  const b = randomInt(1, 10);
  const plus = randomInt(0, 2) === 0;
  const [x, y] = !plus && b > a ? [b, a] : [a, b];
  const answer = plus ? x + y : x - y;
  const id = randomUUID();
  await redis.setex(`${CAPTCHA_PREFIX}${id}`, CAPTCHA_TTL_SECONDS, String(answer));
  return { id, svg: buildSvg(`${x} ${plus ? '+' : '-'} ${y} = ?`) };
}

/** 一次性校验（GETDEL：无论对错都作废，防爆破重放） */
export async function verifyCmsCaptcha(id: string | undefined, answer: string | undefined): Promise<boolean> {
  if (!id || !answer || id.length > 64) return false;
  const expected = await redis.getdel(`${CAPTCHA_PREFIX}${id}`).catch(() => null);
  if (!expected) return false;
  return expected === answer.trim();
}

/** 站点是否启用前台验证码 */
export function isCaptchaEnabled(site: CmsSiteRow): boolean {
  return (site.settings as Record<string, unknown> | null)?.captchaEnabled === true;
}
