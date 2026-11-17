import { createHmac, timingSafeEqual } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';

function parseSignature(raw: string | undefined): { ts: string; v1: string } | null {
  if (!raw) return null;
  const parts = raw.split(',').map((p) => p.trim());
  let ts = '';
  let v1 = '';
  for (const p of parts) {
    if (p.startsWith('t=')) ts = p.slice(2);
    else if (p.startsWith('v1=')) v1 = p.slice(3);
  }
  if (!ts || !v1) return null;
  return { ts, v1 };
}

function verifyHmac(secret: string, ts: string, body: string, expected: string): boolean {
  const actual = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  if (actual.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * 只接受精确原始字节的 HMAC。
 * 原始体缺失或与签名不一致时必须失败关闭，不能回退到 JSON.stringify 的规范化结果。
 */
export function assertWorkflowCallbackSignature(input: {
  secret: string | undefined;
  signatureHeader: string | undefined;
  rawBody: string | undefined;
  missingSecretMessage: string;
}): void {
  if (!input.secret) throw new HTTPException(500, { message: input.missingSecretMessage });
  const sig = parseSignature(input.signatureHeader);
  if (!sig) throw new HTTPException(401, { message: '缺少签名头 X-Zenith-Signature' });
  if (input.rawBody === undefined) throw new HTTPException(401, { message: '缺少原始请求体，无法验签' });
  const tsNum = Number.parseInt(sig.ts, 10);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
    throw new HTTPException(401, { message: '签名时间戳过期' });
  }
  if (!verifyHmac(input.secret, sig.ts, input.rawBody, sig.v1)) {
    throw new HTTPException(401, { message: '签名校验失败' });
  }
}
