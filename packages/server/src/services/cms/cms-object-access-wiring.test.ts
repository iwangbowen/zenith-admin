import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(name: string): Promise<string> {
  return readFile(new URL(`./${name}`, import.meta.url), 'utf8');
}

describe('CMS object-level access wiring', () => {
  it('gates content detail by both site and channel ACL', async () => {
    const text = await source('cms-contents.service.ts');
    expect(text).toMatch(/getCmsContent[\s\S]*?assertSiteAccess\(current\.siteId\)[\s\S]*?assertChannelAccess\(current\.channelId\)/);
  });

  it('gates versions, operation logs, preview links and edit locks before access', async () => {
    const [versions, logs, preview, locks] = await Promise.all([
      source('cms-versions.service.ts'),
      source('cms-content-op-logs.service.ts'),
      source('cms-preview.service.ts'),
      source('cms-edit-lock.service.ts'),
    ]);
    for (const text of [versions, logs, preview, locks]) {
      expect(text).toContain('assertSiteAccess');
      expect(text).toContain('assertChannelAccess');
    }
  });

  it('validates every channel involved in merge and batch operations', async () => {
    const text = await source('cms-channels.service.ts');
    expect(text).toContain('assertChannelsAccess([...uniqueSources, targetId])');
    expect(text).toContain('assertCompleteCmsBatch');
    expect(text).toMatch(/nextParentId !== 0[\s\S]*?assertChannelAccess\(nextParentId\)/);
  });

  it('does not expose channel-owned collection rules through a site-only list', async () => {
    const text = await source('cms-collect.service.ts');
    expect(text).toMatch(
      /listCollectRules[\s\S]*?getAccessibleChannelIds\(\)[\s\S]*?inArray\(cmsCollectRules\.channelId, accessibleChannelIds\)/,
    );
  });

  it('keeps public rendering explicitly separate from admin ACL filtering', async () => {
    const text = await source('cms-render.service.ts');
    expect(text).toContain("listCmsChannelTree({ siteId: site.id, status: 'enabled' }, { skipAccessCheck: true })");
    expect(text).toContain('searchCmsContents({ siteId: site.id, keyword, page, pageSize, skipAccessCheck: true })');
  });

  it('builds global Host/code/default lookups in a deterministic order', async () => {
    const text = await source('cms-sites.service.ts');
    expect(text).toContain('.orderBy(asc(cmsSites.sort), asc(cmsSites.id))');
    expect(text).toContain('if (!byCode.has(row.code)) byCode.set(row.code, row)');
    expect(text).toContain('if (row.isDefault && !defaultSite) defaultSite = row');
  });

  it('enforces scheduled publication permission in both content write paths', async () => {
    const text = await source('cms-contents.service.ts');
    const calls = text.match(/requireCmsScheduledAtMutationPermission\(/g) ?? [];
    expect(calls).toHaveLength(2);
    expect(text).toContain('current: null');
    expect(text).toContain('current: current.scheduledAt');
  });
});
