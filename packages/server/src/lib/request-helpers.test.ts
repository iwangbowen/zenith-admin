/**
 * 请求辅助函数单测（客户端 IP 提取与 UA 解析，审计/限流/访问控制共用）。
 *
 * 覆盖：x-forwarded-for 优先并取第一跳、x-real-ip 回退、
 * UA 解析浏览器/系统、无法识别时返回 Unknown。
 * （无反代头时的 getConnInfo TCP 回退依赖真实 socket，不在单测范围。）
 */
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { REPORTED_CLIENT_LABEL_MAX_LENGTH } from '@zenith/shared/core';
import { getClientInfo, getClientIp, parseUserAgent, resolveReportedClient } from './request-helpers';
import { config } from '../config';

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
  const originalTrustedProxies = [...config.trustedProxyCidrs];

  beforeEach(() => {
    config.trustedProxyCidrs.splice(0, config.trustedProxyCidrs.length, '127.0.0.1/32', '10.0.0.0/8');
  });

  afterEach(() => {
    config.trustedProxyCidrs.splice(0, config.trustedProxyCidrs.length, ...originalTrustedProxies);
  });

  it('x-forwarded-for 取第一跳（客户端真实 IP）并去除空白', async () => {
    expect(await ipFor({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1, 10.0.0.2' })).toBe('203.0.113.7');
  });

  it('无 x-forwarded-for 时回退 x-real-ip', async () => {
    expect(await ipFor({ 'x-real-ip': '198.51.100.3' })).toBe('198.51.100.3');
  });

  it('x-forwarded-for 优先于 x-real-ip', async () => {
    expect(await ipFor({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.3' })).toBe('203.0.113.7');
  });

  it('非受信代理不接受客户端伪造的转发头', async () => {
    config.trustedProxyCidrs.splice(0, config.trustedProxyCidrs.length);
    expect(await ipFor({ 'x-forwarded-for': '203.0.113.7' })).toBe('127.0.0.1');
  });

  it('从右向左跳过受信代理，拒绝最左侧伪造值', async () => {
    config.trustedProxyCidrs.splice(0, config.trustedProxyCidrs.length, '127.0.0.1/32');
    expect(await ipFor({ 'x-forwarded-for': '203.0.113.7, 198.51.100.9' })).toBe('198.51.100.9');
  });
});

describe('getClientInfo', () => {
  const originalTrustedProxies = [...config.trustedProxyCidrs];

  afterEach(() => {
    config.trustedProxyCidrs.splice(0, config.trustedProxyCidrs.length, ...originalTrustedProxies);
  });

  async function infoFor(headers: Record<string, string>): Promise<{ ip: string; ua: string }> {
    let info = { ip: '', ua: '' };
    const app = new Hono();
    app.get('/probe', (c) => {
      info = getClientInfo(c);
      return c.json({});
    });
    await app.request('/probe', { headers });
    return info;
  }

  it('非受信代理下不接受伪造的 x-forwarded-for / x-real-ip（登录日志 IP 不可伪造）', async () => {
    config.trustedProxyCidrs.splice(0, config.trustedProxyCidrs.length);
    const { ip } = await infoFor({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.3' });
    expect(ip).toBe('127.0.0.1');
  });

  it('受信代理链下取客户端真实 IP，并返回 user-agent', async () => {
    config.trustedProxyCidrs.splice(0, config.trustedProxyCidrs.length, '127.0.0.1/32');
    const { ip, ua } = await infoFor({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'curl/8.4.0' });
    expect(ip).toBe('203.0.113.7');
    expect(ua).toBe('curl/8.4.0');
  });

  it('IP 截断到 64 字符以内（防日志表 varchar(64) 溢出）', async () => {
    config.trustedProxyCidrs.splice(0, config.trustedProxyCidrs.length, '127.0.0.1/32');
    const { ip } = await infoFor({ 'x-forwarded-for': 'a'.repeat(200) });
    expect(ip.length).toBeLessThanOrEqual(64);
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

  it('Win11 的 UA 冻结为 NT 10.0：无 hints 时只能判 Windows 10', () => {
    const { os } = parseUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );
    expect(os).toBe('Windows 10');
  });

  it('Win11 + Sec-CH-UA-Platform-Version ≥ 13 → Windows 11（头值带引号）', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    expect(parseUserAgent(ua, '"15.0.0"').os).toBe('Windows 11');
    expect(parseUserAgent(ua, '"13.0.0"').os).toBe('Windows 11');
    expect(parseUserAgent(ua, '"10.0.0"').os).toBe('Windows 10');
    expect(parseUserAgent(ua, null).os).toBe('Windows 10');
    expect(parseUserAgent(ua, 'not-a-version').os).toBe('Windows 10');
  });

  it('hints 只修正冻结的 Win10：macOS 等不受影响', () => {
    const { os } = parseUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '"15.0.0"',
    );
    expect(os).not.toBe('Windows 11');
  });
});

describe('resolveReportedClient', () => {
  const CHROME_WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  it('都不自报 → 全部 UA 解析', () => {
    const { browser, os } = resolveReportedClient({}, CHROME_WIN_UA);
    expect(browser).toContain('Chrome');
    expect(os).toBe('Windows 10');
  });

  it('只报 os → browser 仍从 UA 解析（不能置 Unknown）', () => {
    const { browser, os } = resolveReportedClient({ os: 'Windows 11' }, CHROME_WIN_UA);
    expect(browser).toContain('Chrome');
    expect(os).toBe('Windows 11');
  });

  it('只报 browser → os 仍从 UA 解析', () => {
    const { browser, os } = resolveReportedClient({ browser: 'MyBrowser' }, CHROME_WIN_UA);
    expect(browser).toBe('MyBrowser');
    expect(os).toBe('Windows 10');
  });

  it('都报 → 直接采用，不解析 UA', () => {
    const { browser, os } = resolveReportedClient({ browser: 'X', os: 'Y' }, 'garbage');
    expect(browser).toBe('X');
    expect(os).toBe('Y');
  });

  it('超长自报值截断到列宽（登录体有契约把关，X-Zenith-Os 头没有）', () => {
    const long = 'W'.repeat(5000);
    // 自报头与登录体最终都汇到这里，构造超长值不能把会话事实撑坏
    const { browser, os } = resolveReportedClient({ browser: long, os: long }, CHROME_WIN_UA);
    expect(browser).toBe('W'.repeat(REPORTED_CLIENT_LABEL_MAX_LENGTH));
    expect(os).toHaveLength(REPORTED_CLIENT_LABEL_MAX_LENGTH);
  });

  it('自报值去两端空白；空串 / 纯空白视为未自报并回退 UA 解析', () => {
    expect(resolveReportedClient({ os: '  Windows 11  ' }, CHROME_WIN_UA).os).toBe('Windows 11');
    const { browser, os } = resolveReportedClient({ browser: '   ', os: '' }, CHROME_WIN_UA);
    expect(browser).toContain('Chrome');
    expect(os).toBe('Windows 10');
  });

  it('截断上限与日志列宽（varchar 64）绑定，不各自漂移', () => {
    expect(REPORTED_CLIENT_LABEL_MAX_LENGTH).toBe(64);
  });
});
