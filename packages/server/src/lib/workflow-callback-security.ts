import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

const rawBodyByRequest = new WeakMap<Request, string>();

export const captureWorkflowCallbackRawBody: MiddlewareHandler = async (c, next) => {
  let captured = false;
  try {
    const rawBody = await c.req.raw.clone().text();
    rawBodyByRequest.set(c.req.raw, rawBody);
    captured = true;
  } catch {
    // Some validators may have already consumed the body; callers still verify against canonical JSON.
  }
  try {
    await next();
  } finally {
    if (captured) rawBodyByRequest.delete(c.req.raw);
  }
};

export function getWorkflowCallbackRawBody(req: Request, fallbackBody: unknown): string {
  return rawBodyByRequest.get(req) ?? JSON.stringify(fallbackBody);
}

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

export function assertWorkflowCallbackSignature(input: {
  secret: string | undefined;
  signatureHeader: string | undefined;
  rawBody: string;
  canonicalBody: string;
  missingSecretMessage: string;
}): void {
  if (!input.secret) throw new HTTPException(500, { message: input.missingSecretMessage });
  const sig = parseSignature(input.signatureHeader);
  if (!sig) throw new HTTPException(401, { message: '缺少签名头 X-Zenith-Signature' });
  const tsNum = Number.parseInt(sig.ts, 10);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
    throw new HTTPException(401, { message: '签名时间戳过期' });
  }
  const valid = verifyHmac(input.secret, sig.ts, input.rawBody, sig.v1)
    || (input.rawBody !== input.canonicalBody && verifyHmac(input.secret, sig.ts, input.canonicalBody, sig.v1));
  if (!valid) throw new HTTPException(401, { message: '签名校验失败' });
}
