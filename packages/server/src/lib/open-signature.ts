/**
 * 开放平台 HMAC-SHA256 请求签名工具（纯函数，无 DB 依赖）。
 *
 * 待签名字符串（stringToSign）按以下顺序换行拼接：
 *   METHOD\n PATH\n CANONICAL_QUERY\n TIMESTAMP\n NONCE\n SHA256_HEX(BODY)
 * 签名 = hex( HMAC-SHA256(stringToSign, appSecret) )
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

/** 规整 query string：按 key（再按 value）排序后以 k=v&k=v 拼接 */
export function canonicalizeQuery(query?: string | null): string {
  if (!query) return '';
  const qs = query.startsWith('?') ? query.slice(1) : query;
  if (!qs) return '';
  const pairs = qs
    .split('&')
    .filter(Boolean)
    .map((p) => {
      const idx = p.indexOf('=');
      const k = idx >= 0 ? p.slice(0, idx) : p;
      const v = idx >= 0 ? p.slice(idx + 1) : '';
      return [k, v] as const;
    });
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

export interface SignatureParts {
  method: string;
  path: string;
  query?: string | null;
  timestamp: string;
  nonce: string;
  body?: string | null;
}

export function buildStringToSign(parts: SignatureParts): string {
  const bodyHash = createHash('sha256').update(parts.body ?? '').digest('hex');
  return [
    parts.method.toUpperCase(),
    parts.path,
    canonicalizeQuery(parts.query),
    parts.timestamp,
    parts.nonce,
    bodyHash,
  ].join('\n');
}

export function computeSignature(secret: string, stringToSign: string): string {
  return createHmac('sha256', secret).update(stringToSign).digest('hex');
}

export function signRequest(secret: string, parts: SignatureParts): { signature: string; stringToSign: string } {
  const stringToSign = buildStringToSign(parts);
  return { signature: computeSignature(secret, stringToSign), stringToSign };
}

/** 常量时间字符串比较，避免计时攻击 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
