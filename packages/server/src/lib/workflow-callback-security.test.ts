/**
 * 工作流回调签名校验单测（HMAC-SHA256 + 时间戳防重放）。
 *
 * 关键约束：只接受精确原始字节，原始体缺失或与签名不一致必须失败关闭；
 * 不允许回退到 JSON.stringify 的规范化结果。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { assertWorkflowCallbackSignature } from './workflow-callback-security';
import { captureRawBody, getRawBody } from './raw-body-cache';

const SECRET = 'callback-secret';

function signHeader(secret: string, body: string, tsSeconds = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${tsSeconds}.${body}`).digest('hex');
  return `t=${tsSeconds},v1=${v1}`;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('assertWorkflowCallbackSignature', () => {
  const body = '{"instanceId":1,"action":"approve"}';

  function assertWith(overrides: Partial<Parameters<typeof assertWorkflowCallbackSignature>[0]> = {}) {
    assertWorkflowCallbackSignature({
      secret: SECRET,
      signatureHeader: signHeader(SECRET, body),
      rawBody: body,
      missingSecretMessage: '未配置回调密钥',
      ...overrides,
    });
  }

  it('合法签名（原始 body）通过', () => {
    expect(() => assertWith()).not.toThrow();
  });

  it('未配置密钥 → 500 自定义提示', () => {
    try {
      assertWith({ secret: undefined });
      expect.unreachable();
    } catch (err) {
      expect((err as HTTPException).status).toBe(500);
      expect((err as HTTPException).message).toBe('未配置回调密钥');
    }
  });

  it('缺少签名头 → 401', () => {
    expect(() => assertWith({ signatureHeader: undefined })).toThrow(
      expect.objectContaining({ status: 401, message: '缺少签名头 X-Zenith-Signature' }),
    );
  });

  it.each(['garbage', 't=123', 'v1=abc', 't=,v1='])('格式非法的签名头 %j → 401', (bad) => {
    expect(() => assertWith({ signatureHeader: bad })).toThrow(expect.objectContaining({ status: 401 }));
  });

  it('原始体缺失 → 401，不回退 canonical JSON', () => {
    expect(() => assertWith({ rawBody: undefined })).toThrow(
      expect.objectContaining({ status: 401, message: '缺少原始请求体，无法验签' }),
    );
  });

  it('时间戳过期（301 秒前）→ 401 防重放', () => {
    const old = Math.floor(Date.now() / 1000) - 301;
    expect(() => assertWith({ signatureHeader: signHeader(SECRET, body, old) })).toThrow(
      expect.objectContaining({ status: 401, message: '签名时间戳过期' }),
    );
  });

  it('时间戳超前（301 秒后）→ 401', () => {
    const future = Math.floor(Date.now() / 1000) + 301;
    expect(() => assertWith({ signatureHeader: signHeader(SECRET, body, future) })).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });

  it('时间戳在窗口边缘（299 秒前）→ 通过', () => {
    const edge = Math.floor(Date.now() / 1000) - 299;
    expect(() => assertWith({ signatureHeader: signHeader(SECRET, body, edge) })).not.toThrow();
  });

  it('错误密钥签名 → 401 签名校验失败', () => {
    expect(() => assertWith({ signatureHeader: signHeader('wrong-secret', body) })).toThrow(
      expect.objectContaining({ status: 401, message: '签名校验失败' }),
    );
  });

  it('body 被篡改 → 401', () => {
    expect(() => assertWith({ rawBody: '{"instanceId":2,"action":"approve"}' })).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });

  it('签名按规范化 JSON 生成但原文不同 → 401', () => {
    const canonical = '{"a":1,"b":2}';
    const rawWithSpaces = '{ "a": 1, "b": 2 }';
    expect(() =>
      assertWorkflowCallbackSignature({
        secret: SECRET,
        signatureHeader: signHeader(SECRET, canonical),
        rawBody: rawWithSpaces,
        missingSecretMessage: 'x',
      }),
    ).toThrow(expect.objectContaining({ status: 401, message: '签名校验失败' }));
  });

  it('签名长度不匹配 → 401（不抛 timingSafeEqual 内部错误）', () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(() => assertWith({ signatureHeader: `t=${ts},v1=abc` })).toThrow(
      expect.objectContaining({ status: 401, message: '签名校验失败' }),
    );
  });
});

describe('captureRawBody / getRawBody', () => {
  it('在 JSON 解析前捕获精确原始体，并在响应后清理', async () => {
    const raw = '{ "b": 2, "a": 1 }';
    let seen = '';
    let capturedReq: Request | undefined;
    const app = new Hono();
    app.post('/cb', captureRawBody, async (c) => {
      await c.req.json();
      capturedReq = c.req.raw;
      seen = getRawBody(c.req.raw) ?? '';
      return c.json({ ok: true });
    });

    const res = await app.request('/cb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    });

    expect(res.status).toBe(200);
    expect(seen).toBe(raw);
    expect(capturedReq && getRawBody(capturedReq)).toBeUndefined();
  });

  it('未经过捕获中间件时返回 undefined，不做 canonical 回退', () => {
    const req = new Request('http://localhost/cb', { method: 'POST' });
    expect(getRawBody(req)).toBeUndefined();
  });
});
