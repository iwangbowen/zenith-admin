import { afterEach, describe, expect, it } from 'vitest';
import type { CmsWidget, CmsWidgetPreview, CmsWidgetSlot, CmsWidgetSourceReference } from '@zenith/shared/cms';
import type { AsyncTask } from '@zenith/shared/tasks';
import { mockCmsWidgetRefs, mockCmsWidgets } from '@/mocks/data/cms';
import { cmsWidgetsHandlers } from '@/mocks/handlers/cms-widgets';

const widgetSnapshot = structuredClone(mockCmsWidgets);
const refSnapshot = structuredClone(mockCmsWidgetRefs);

afterEach(() => {
  mockCmsWidgets.splice(0, mockCmsWidgets.length, ...structuredClone(widgetSnapshot));
  mockCmsWidgetRefs.splice(0, mockCmsWidgetRefs.length, ...structuredClone(refSnapshot));
});

async function call<T>(method: string, path: string, body?: unknown) {
  for (const handler of cmsWidgetsHandlers) {
    const request = new Request(`${window.location.origin}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await (handler as unknown as {
      run(args: unknown): Promise<{ response?: Response } | null>;
    }).run({ request, requestId: `cms-widget-${Math.random()}` });
    if (result?.response) {
      return {
        status: result.response.status,
        body: await result.response.json() as { code: number; message: string; data: T },
      };
    }
  }
  throw new Error(`No handler matched ${method} ${path}`);
}

describe('CMS widget MSW handlers', () => {
  it('exposes registered slots and preserves a binding when an incompatible renderer is rejected', async () => {
    const slots = await call<CmsWidgetSlot[]>('GET', '/api/cms/widgets/slots?siteId=1');
    expect(slots.body.data.map((slot) => slot.key)).toEqual(['home.main', 'home.sidebar', 'detail.related', 'footer']);
    const saved = await call<CmsWidgetSlot[]>('PUT', '/api/cms/widgets/slots/home.main', { siteId: 1, widgetId: 1, rendererKey: 'list-grid' });
    expect(saved.status).toBe(200);
    const binding = saved.body.data.find((slot) => slot.key === 'home.main')!.binding;
    const invalid = await call('PUT', '/api/cms/widgets/slots/home.main', { siteId: 1, widgetId: 1, rendererKey: 'list-sidebar' });
    expect(invalid.status).toBe(400);
    const after = await call<CmsWidgetSlot[]>('GET', '/api/cms/widgets/slots?siteId=1');
    expect(after.body.data.find((slot) => slot.key === 'home.main')!.binding).toEqual(binding);
  });
  it('enforces optimistic revision and immutable code', async () => {
    const created = await call<CmsWidget>('POST', '/api/cms/widgets', {
      siteId: 1,
      name: '测试部件',
      code: 'test-widget',
      type: 'manual-list',
      defaultRendererKey: 'list-sidebar',
      draftData: { items: [] },
    });
    const immutable = await call<CmsWidget>('PUT', `/api/cms/widgets/${created.body.data.id}`, {
      expectedRevision: 1,
      code: 'changed-code',
    });
    expect(immutable.status).toBe(400);

    const updated = await call<CmsWidget>('PUT', `/api/cms/widgets/${created.body.data.id}`, {
      expectedRevision: 1,
      name: '测试部件 v2',
    });
    expect(updated.body.data).toMatchObject({
      code: 'test-widget',
      draftRevision: 2,
    });

    const metadataUpdated = await call<CmsWidget>('PUT', `/api/cms/widgets/${created.body.data.id}`, {
      expectedRevision: 2,
      defaultRendererKey: 'list-grid',
    });
    expect(metadataUpdated.body.data.draftRevision).toBe(3);

    const stale = await call<CmsWidget>('PUT', `/api/cms/widgets/${created.body.data.id}`, {
      expectedRevision: 2,
      name: '过期修改',
    });
    expect(stale.status).toBe(409);
  });

  it('returns source diagnostics and a complete theme preview document', async () => {
    const refs = await call<CmsWidgetSourceReference[]>(
      'GET',
      '/api/cms/widgets/source-refs?sourceType=content&sourceId=1',
    );
    expect(refs.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ widgetId: 1, sourceType: 'content', sourceId: 1 }),
    ]));

    const preview = await call<CmsWidgetPreview>('GET', '/api/cms/widgets/1/preview');
    expect(preview.body.data.documentHtml).toContain('<!doctype html>');
    expect(preview.body.data.documentHtml).toContain('<header>');
  });

  it('classifies referenced deletes as skipped in batch outcomes', async () => {
    const result = await call<AsyncTask>('POST', '/api/cms/widgets/batch', {
      ids: [1],
      action: 'delete',
    });
    expect(result.body.data.payload.outcome).toEqual({
      processed: 1,
      succeeded: 0,
      failed: 0,
      skipped: 1,
    });
  });
});
