import { describe, expect, it } from 'vitest';
import { cmsPreviewPathSchema, renderCmsWorkbenchPreviewSchema } from './workbench-validation';
import { cmsReleaseFieldDiffs } from './release-review';

describe('CMS publication workbench', () => {
  it('accepts site paths and rejects cross-site, executable and traversing targets', () => {
    for (const path of ['/', '/news/', '/search?q=文化', '/@content/23']) expect(cmsPreviewPathSchema.safeParse(path).success).toBe(true);
    for (const path of ['//example.com', 'https://example.com', '/__cms/other/', '/x/../y', '/%2e%2e/x', '/x%2fy', '/\\evil', 'javascript:alert(1)']) expect(cmsPreviewPathSchema.safeParse(path).success).toBe(false);
  });
  it('requires a concrete working selection or candidate release', () => {
    expect(renderCmsWorkbenchPreviewSchema.safeParse({ siteId: 1, mode: 'working' }).success).toBe(false);
    expect(renderCmsWorkbenchPreviewSchema.safeParse({ siteId: 1, mode: 'working', contentIds: [2], pageIds: [3] }).success).toBe(true);
    expect(renderCmsWorkbenchPreviewSchema.safeParse({ siteId: 1, mode: 'candidate' }).success).toBe(false);
    expect(renderCmsWorkbenchPreviewSchema.safeParse({ siteId: 1, mode: 'online' }).success).toBe(true);
  });
  it('ignores audit changes and object key ordering, preserving ordered block changes and deletion', () => {
    const before = { title: 'old', settings: { a: 1, b: 2 }, blocks: ['hero', 'list'], updated_at: 'yesterday', view_count: 1 };
    const after = { title: 'new', settings: { b: 2, a: 1 }, blocks: ['list', 'hero'], updated_at: 'today', view_count: 200 };
    expect(cmsReleaseFieldDiffs(before, after).map((field) => field.path)).toEqual(['blocks', 'title']);
    expect(cmsReleaseFieldDiffs({ title: 'old' }, null)).toEqual([{ path: 'title', before: 'old', after: null }]);
  });
});
