import { describe, expect, it } from 'vitest';
import { evaluateIpAccess, inspectIpList, ipRangesOverlap, isIpOrCidr, matchesIpRange, normalizeIpOrCidr } from './ip-access-policy';
import { ipAccessSettingsSchema } from './modules/ip-access';

describe('IP access policy', () => {
  it('reports original line numbers and canonical duplicates', () => {
    expect(inspectIpList('2001:DB8::1\n\n::: \n2001:db8::1')).toEqual({ entries: ['2001:db8::1'], duplicates: 1, invalid: [{ line: 3, value: ':::' }] });
  });
  it.each([':::', 'abcd:ef', '2001:db8:1', '127.1', '0x7f000001', '010.0.0.1', 'fe80::1%eth0', '1.2.3.4/33', '::/129', '::/01', '::ffff:192.0.2.0/95'])('rejects ambiguous or invalid %s', (value) => expect(isIpOrCidr(value)).toBe(false));
  it('canonicalizes IPv6, host bits and mapped addresses', () => {
    expect(normalizeIpOrCidr('2001:0DB8:0:0::1')).toBe('2001:db8::1');
    expect(normalizeIpOrCidr('192.0.2.129/24')).toBe('192.0.2.0/24');
    expect(normalizeIpOrCidr('::ffff:192.0.2.129/120')).toBe('192.0.2.0/24');
    expect(matchesIpRange('::ffff:192.0.2.1', '::ffff:192.0.2.0/120')).toBe(true);
    expect(matchesIpRange('192.0.3.1', '192.0.2.0/24')).toBe(false);
    expect(matchesIpRange('::1', '0.0.0.0/0')).toBe(false);
  });
  it('has deterministic deny precedence and denies an empty enabled whitelist', () => {
    const policy = { whitelistEnabled: true, whitelist: ['192.0.2.0/24'], blacklistEnabled: true, blacklist: ['192.0.2.1'] };
    expect(evaluateIpAccess(policy, '192.0.2.1')).toMatchObject({ allowed: false, reason: 'blacklist', matchedEntry: '192.0.2.1' });
    expect(evaluateIpAccess(policy, '192.0.2.2').allowed).toBe(true);
    expect(evaluateIpAccess({ ...policy, whitelist: [] }, '192.0.2.2').allowed).toBe(false);
    expect(evaluateIpAccess(policy, 'invalid').allowed).toBe(false);
    expect(ipAccessSettingsSchema.safeParse({ whitelistEnabled: true }).success).toBe(false);
  });
  it('detects overlap across normalized CIDRs', () => {
    expect(ipRangesOverlap('10.1.0.0/16', '10.0.0.0/8')).toBe(true);
    expect(ipRangesOverlap('10.1.0.0/16', '10.2.0.0/16')).toBe(false);
  });
});
