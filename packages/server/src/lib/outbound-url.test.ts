import { describe, expect, it } from 'vitest';
import {
  assertSafeOutboundHost,
  assertSafeOutboundUrl,
  createSafeOutboundLookup,
  isBlockedOutboundIp,
} from './outbound-url';

describe('report outbound URL safety', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '::1',
    'fd00::1',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b::a00:1',
  ])(
    'blocks private or local IP %s',
    (ip) => expect(isBlockedOutboundIp(ip)).toBe(true),
  );

  it('rejects localhost and private literals', async () => {
    await expect(assertSafeOutboundUrl('http://127.0.0.1/admin', [])).rejects.toThrow();
    await expect(assertSafeOutboundHost('169.254.169.254', [])).rejects.toThrow();
  });

  it('supports an explicit private-network allowlist', async () => {
    await expect(assertSafeOutboundHost('10.1.2.3', ['10.0.0.0/8'])).resolves.toBeUndefined();
    await expect(assertSafeOutboundUrl('http://localhost:8080', ['localhost'])).resolves.toBeInstanceOf(URL);
  });

  it('enforces the policy in the socket lookup callback', async () => {
    const safeLookup = createSafeOutboundLookup([]);
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      safeLookup('127.0.0.1', { family: 4 }, (err) => resolve(err));
    });
    expect(error).toBeTruthy();
  });
});
