import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { ipAccessSettingsSchema } from '@zenith/shared/settings';
vi.mock('../request-helpers', () => ({ getClientIp: () => '192.0.2.10' }));
import { assertIpAccessChange } from './ip-access-guard';

describe('IP policy write safety', () => {
  it('rejects activation outside a verifiable request', () => {
    expect(() => assertIpAccessChange(ipAccessSettingsSchema.parse({ blacklistEnabled: true }))).toThrow(/来源 IP/);
  });
  it.each([
    [{ whitelistEnabled: true, whitelist: ['192.0.2.0/24'] }, 200],
    [{ whitelistEnabled: true, whitelist: ['198.51.100.0/24'] }, 400],
    [{ blacklistEnabled: true, blacklist: ['192.0.2.10'] }, 400],
    [{ whitelistEnabled: true, whitelist: ['192.0.2.0/24'], blacklistEnabled: true, blacklist: ['192.0.2.10'] }, 400],
  ] as const)('protects the current observed source %j', async (input, status) => {
    const app = new Hono();
    app.use('*', contextStorage());
    app.post('/', (c) => { assertIpAccessChange(ipAccessSettingsSchema.parse(input)); return c.text('ok'); });
    expect((await app.request('/', { method: 'POST' })).status).toBe(status);
  });
  it('allows emergency disabling without request context', () => {
    expect(() => assertIpAccessChange(ipAccessSettingsSchema.parse({}))).not.toThrow();
  });
});
