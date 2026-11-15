import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { safeRequestPath } from './safe-request-path';
describe('safe request path before routing', () => {
  it('redacts path credentials even if middleware rejects before handler', async () => {
    const app = new Hono();
    app.use('*', (c) => c.text(safeRequestPath(c)));
    app.get('/api/public/link/:token', (c) => c.text('secret'));
    expect(await (await app.request('/api/public/link/private-token')).text()).toBe('/api/public/link/{token}');
    expect(await (await app.request('/api/random/private-token')).text()).toBe('/api/[unmatched]');
  });
});
