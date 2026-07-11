
import { describe, it, expect } from 'vitest';
import { analyticsHandlers } from '@/mocks/handlers/analytics';
import { ANALYTICS_SITE_KEY_HEADER } from '@zenith/shared';

const ORIGIN = window.location.origin;
interface ApiEnvelope { code: number; message: string; data: any }
async function call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiEnvelope> {
  for (const h of analyticsHandlers) {
    const request = new Request(`${ORIGIN}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(headers ?? {}) },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const res = await (h as unknown as { run: (a: unknown) => Promise<{ response?: Response } | null> })
      .run({ request, requestId: `t-${Math.random()}` });
    if (res?.response) return res.response.json() as Promise<ApiEnvelope>;
  }
  throw new Error(`no handler matched ${method} ${path}`);
}

describe('analytics sites MSW handlers', () => {
  it('lists seeded default sites and resolves public config by header site key', async () => {
    const list = await call('GET', '/api/analytics/sites?page=1&pageSize=20');
    expect(list.code).toBe(0);
    expect(list.data.total).toBeGreaterThanOrEqual(2);
    expect(typeof list.data.list[0].todayUsage).toBe('number');
    const key = list.data.list[0].siteKey;
    const config = await call('GET', '/api/analytics/config', undefined, { [ANALYTICS_SITE_KEY_HEADER]: key });
    expect(config.data.siteId).toBe(list.data.list[0].id);
    expect(config.data.appId).toBe(list.data.list[0].appId);
  });

  it('creates, updates, regenerates key and deletes a site', async () => {
    const created = await call('POST', '/api/analytics/sites', { name: 'MSW站点', appId: 'msw', status: 'enabled', allowedOrigins: ['https://example.com'] });
    expect(created.code).toBe(0);
    const id = created.data.id;
    const updated = await call('PUT', `/api/analytics/sites/${id}`, { remark: 'updated' });
    expect(updated.data.remark).toBe('updated');
    const regenerated = await call('POST', `/api/analytics/sites/${id}/regenerate-key`);
    expect(regenerated.data.siteKey).not.toBe(created.data.siteKey);
    const deleted = await call('DELETE', `/api/analytics/sites/${id}`);
    expect(deleted.code).toBe(0);
  });
});
