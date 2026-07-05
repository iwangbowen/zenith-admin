/**
 * 请求辅助函数单测（客户端 IP 提取与 UA 解析，审计/限流/访问控制共用）。
 *
 * 覆盖：x-forwarded-for 优先并取第一跳、x-real-ip 回退、
 * UA 解析浏览器/系统、无法识别时返回 Unknown。
 * （无反代头时的 getConnInfo TCP 回退依赖真实 socket，不在单测范围。）
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { getClientIp, parseUserAgent } from './request-helpers';

async function ipFor(headers: Record<string, string>): Promise<string> {
  let ip = '';
  const app = new Hono();
  app.get('/probe', (c) => {
    ip = getClientIp(c);
    return c.json({});
  });
  await app.request('/probe', { headers });
  return ip;
}

describe('getClientIp', () => {
  it('x-forwarded-for 取第一跳（客户端真实 IP）并去除空白', async () => {
    expect(await ipFor({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1, 10.0.0.2' })).toBe('203.0.113.7');
  });

  it('无 x-forwarded-for 时回退 x-real-ip', async () => {
    expect(await ipFor({ 'x-real-ip': '198.51.100.3' })).toBe('198.51.100.3');
  });

  it('x-forwarded-for 优先于 x-real-ip', async () => {
    expect(await ipFor({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.3' })).toBe('203.0.113.7');
  });
});

describe('parseUserAgent', () => {
  it('解析常见 Chrome/Windows UA', () => {
    const { browser, os } = parseUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    expect(browser).toContain('Chrome');
    expect(os).toContain('Windows');
  });

  it('解析 iPhone Safari UA', () => {
    const { browser, os } = parseUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );
    expect(browser).toContain('Safari');
    expect(os).toContain('iOS');
  });

  it('无法识别的 UA → Unknown（供 guard 落库时置 null）', () => {
    expect(parseUserAgent('')).toEqual({ browser: 'Unknown', os: 'Unknown' });
    expect(parseUserAgent('curl/8.4.0').os).toBe('Unknown');
  });
});
