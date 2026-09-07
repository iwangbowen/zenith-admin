import { describe, expect, it } from 'vitest';
import { ipInAllowlist, normalizeIp } from './ip-allowlist';

describe('ipInAllowlist', () => {
  it('空白名单不限制', () => {
    expect(ipInAllowlist('10.0.0.1', [])).toBe(true);
  });

  it('单地址与 CIDR 段（IPv4）', () => {
    expect(ipInAllowlist('192.168.1.20', ['192.168.1.20'])).toBe(true);
    expect(ipInAllowlist('192.168.1.21', ['192.168.1.20'])).toBe(false);
    expect(ipInAllowlist('10.1.2.3', ['10.1.0.0/16'])).toBe(true);
    expect(ipInAllowlist('10.2.0.1', ['10.1.0.0/16'])).toBe(false);
  });

  it('IPv6 与 IPv4 映射地址', () => {
    expect(ipInAllowlist('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(ipInAllowlist('2001:db9::1', ['2001:db8::/32'])).toBe(false);
    expect(ipInAllowlist('::ffff:10.1.2.3', ['10.1.0.0/16'])).toBe(true);
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
  });

  it('非法客户端 IP 或脏规则不放行', () => {
    expect(ipInAllowlist('', ['10.0.0.0/8'])).toBe(false);
    expect(ipInAllowlist('not-an-ip', ['10.0.0.0/8'])).toBe(false);
    expect(ipInAllowlist('10.0.0.1', ['garbage', '10.0.0.0/8'])).toBe(true);
  });
});
