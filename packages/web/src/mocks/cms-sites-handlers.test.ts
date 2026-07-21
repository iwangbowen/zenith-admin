import { afterEach, describe, expect, it } from 'vitest';
import { mockCmsSites } from '@/mocks/data/cms';
import { cmsHandlers, cmsP2Handlers } from '@/mocks/handlers/cms';

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

const initialSites = structuredClone(mockCmsSites);

afterEach(() => {
  mockCmsSites.splice(0, mockCmsSites.length, ...structuredClone(initialSites));
});

async function call<T>(method: string, path: string, body?: unknown) {
  for (const handler of [...cmsHandlers, ...cmsP2Handlers]) {
    const request = new Request(`${window.location.origin}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await (handler as unknown as {
      run: (args: unknown) => Promise<{ response?: Response } | null>;
    }).run({ request, requestId: `cms-sites-${Math.random()}` });
    if (result?.response) {
      return {
        status: result.response.status,
        body: await result.response.json() as ApiEnvelope<T>,
      };
    }
  }
  throw new Error(`no handler matched ${method} ${path}`);
}

describe('CMS site MSW handlers', () => {
  it('rejects a duplicate global site code on create with the real API error shape', async () => {
    const existing = mockCmsSites[0];
    const beforeCount = mockCmsSites.length;
    const response = await call('POST', '/api/cms/sites', {
      name: '重复站点',
      code: existing.code,
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: 400,
      message: '站点标识或域名已存在',
      data: null,
    });
    expect(mockCmsSites).toHaveLength(beforeCount);
  });

  it('allows an unchanged code but rejects another site code on update', async () => {
    const existing = mockCmsSites[0];
    const unchanged = await call('PUT', `/api/cms/sites/${existing.id}`, {
      code: existing.code,
      name: existing.name,
    });
    expect(unchanged.status).toBe(200);

    const code = `review-site-${Date.now()}`;
    const created = await call<{ id: number }>('POST', '/api/cms/sites', {
      name: '复审临时站点',
      code,
    });
    expect(created.status).toBe(200);
    const duplicate = await call('PUT', `/api/cms/sites/${created.body.data.id}`, {
      code: existing.code,
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body).toMatchObject({
      code: 400,
      message: '站点标识或域名已存在',
      data: null,
    });
    expect(mockCmsSites.find((site) => site.id === created.body.data.id)?.code).toBe(code);
  });

  it('documents the safe draft policy in the import response', async () => {
    const response = await call('POST', '/api/cms/sites/import', {
      version: 1,
      site: { name: '导入站点', code: 'import-review' },
      contents: [{ status: 'published', scheduledAt: '2026-08-01 10:00:00' }],
    });
    expect(response.status).toBe(200);
    expect(response.body.message).toContain('内容已统一转为草稿');
  });
});
