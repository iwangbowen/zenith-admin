/**
 * 工作流回调签名校验单测（Webhook 回调安全关键，HMAC-SHA256 + 时间戳防重放）。
 *
 * 覆盖：
 *  1. assertWorkflowCallbackSignature：缺密钥 500、缺/坏签名头 401、
 *     时间戳过期（±300s）401、签名不匹配 401、原始 body 验签通过、
 *     canonical body 兜底验签（校验器重排 JSON 键的场景）
 *  2. captureWorkflowCallbackRawBody + getWorkflowCallbackRawBody：
 *     捕获原始请求体（保留空格/键序），未捕获时回退 canonical JSON
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  assertWorkflowCallbackSignature,
  captureWorkflowCallbackRawBody,
  getWorkflowCallbackRawBody,
} from './workflow-callback-security';

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
      canonicalBody: body,
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
    expect(() => assertWith({ rawBody: '{"instanceId":2,"action":"approve"}', canonicalBody: '{"instanceId":2,"action":"approve"}' })).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });

  it('签名长度不匹配 → 401（不抛 timingSafeEqual 内部错误）', () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(() => assertWith({ signatureHeader: `t=${ts},v1=abc` })).toThrow(
      expect.objectContaining({ status: 401, message: '签名校验失败' }),
    );
  });

  it('原始 body 不匹配但 canonical body 验签通过（validator 消耗过 body 的兜底）', () => {
    const canonical = '{"a":1,"b":2}';
    const rawWithSpaces = '{ "a": 1, "b": 2 }';
    // 调用方用 canonical 签名（客户端发送紧凑 JSON，服务端拿到重排后的 canonical）
    expect(() =>
      assertWorkflowCallbackSignature({
        secret: SECRET,
        signatureHeader: signHeader(SECRET, canonical),
        rawBody: rawWithSpaces,
        canonicalBody: canonical,
        missingSecretMessage: 'x',
      }),
    ).not.toThrow();
  });
});

describe('captureWorkflowCallbackRawBody / getWorkflowCallbackRawBody', () => {
  it('中间件捕获原始请求体（保留空格与键序）', async () => {
    const raw = '{ "b": 2, "a": 1 }';
    let seen = '';
    const app = new Hono();
    app.post('/cb', captureWorkflowCallbackRawBody, async (c) => {
      const parsed = await c.req.json();
      seen = getWorkflowCallbackRawBody(c.req.raw, parsed);
      return c.json({ ok: true });
    });

    const res = await app.request('/cb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    });

    expect(res.status).toBe(200);
    expect(seen).toBe(raw); // 精确等于线上原文，而非 JSON.stringify 重排结果
  });

  it('未经过捕获中间件时回退 canonical JSON', () => {
    const req = new Request('http://localhost/cb', { method: 'POST' });
    expect(getWorkflowCallbackRawBody(req, { a: 1 })).toBe('{"a":1}');
  });
});
