/**
 * 无状态 HMAC 签名令牌的统一编解码。
 *
 * 线格式由 `version` / `purpose` 二选一决定，与既有令牌逐字节兼容：
 * - 带版本段（广告事件 / 渲染凭证）：`<version>.<base64url(JSON)>.<sig>`，签名输入 `<version>.<data>`；
 * - 无版本段（邮件退订）：`<base64url(JSON)>.<sig>`，签名输入 `<purpose>:<data>`。
 * `sig = base64url(HMAC-SHA256(jwtSecret, 签名输入))`。
 *
 * `decode` 只负责结构、签名与 JSON 解析，任何失败返回 null；载荷字段合法性与过期由调用方按各自规则判定。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

export function hmacSha256(input: string, encoding: 'base64url' | 'hex' = 'base64url', secret: string = config.jwtSecret): string {
  return createHmac('sha256', secret).update(input).digest(encoding);
}

/** 常量时间比较两个字符串（长度不同直接判否，避免 timingSafeEqual 抛错） */
export function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SignedTokenCodec<T> {
  encode(payload: T): string;
  /** 结构错误 / 签名不符 / JSON 解析失败 → null */
  decode(token: string): T | null;
}

export type SignedTokenCodecOptions =
  | { version: string; purpose?: undefined; secret?: string }
  | { purpose: string; version?: undefined; secret?: string };

export function createSignedTokenCodec<T>(options: SignedTokenCodecOptions): SignedTokenCodec<T> {
  const { version, purpose, secret = config.jwtSecret } = options;
  const signingPrefix = version !== undefined ? `${version}.` : `${purpose}:`;
  const sign = (data: string) => hmacSha256(`${signingPrefix}${data}`, 'base64url', secret);

  function split(token: string): { data: string; signature: string } | null {
    if (version !== undefined) {
      const [tokenVersion, data, signature, ...extra] = token.split('.');
      if (tokenVersion !== version || !data || !signature || extra.length > 0) return null;
      return { data, signature };
    }
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    return { data: token.slice(0, dot), signature: token.slice(dot + 1) };
  }

  return {
    encode(payload) {
      const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signature = sign(data);
      return version !== undefined ? `${version}.${data}.${signature}` : `${data}.${signature}`;
    },
    decode(token) {
      const parts = split(token);
      if (!parts || !constantTimeEqual(parts.signature, sign(parts.data))) return null;
      try {
        return JSON.parse(Buffer.from(parts.data, 'base64url').toString('utf8')) as T;
      } catch {
        return null;
      }
    },
  };
}
