import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { cmsWidgetDataSchema, updateCmsWidgetSchema } from '@zenith/shared/cms';
import { getThemeWidgetSlots, listThemeWidgetRenderers } from '../../cms/themes/registry';
import { stripCmsPreviewScripts } from './cms-preview';

async function source(name: string): Promise<string> {
  return readFile(new URL(`./${name}`, import.meta.url), 'utf8');
}

describe('CMS page widgets', () => {
  it('validates manual and live-source items while rejecting ambiguous input', () => {
    expect(cmsWidgetDataSchema.parse({
      items: [
        { id: 'manual', sourceType: 'manual', title: '手工条目' },
        { id: 'content', sourceType: 'content', sourceId: 1 },
        { id: 'channel', sourceType: 'channel', sourceId: 2 },
      ],
    }).items).toHaveLength(3);

    expect(() => cmsWidgetDataSchema.parse({
      items: [{ id: 'manual', sourceType: 'manual' }],
    })).toThrow(/标题不能为空/);
    expect(() => cmsWidgetDataSchema.parse({
      items: [{ id: 'content', sourceType: 'content' }],
    })).toThrow(/来源 ID/);
    expect(() => cmsWidgetDataSchema.parse({
      items: [
        { id: 'same', sourceType: 'manual', title: 'A' },
        { id: 'same', sourceType: 'manual', title: 'B' },
      ],
    })).toThrow(/不能重复/);
  });

  it('declares theme-specific placements and restricts the main region to visual renderers', () => {
    for (const theme of ['default', 'docs']) {
      expect(getThemeWidgetSlots(theme)).toEqual(expect.arrayContaining([expect.objectContaining({
        key: 'home.sidebar',
        allowedTypes: ['manual-list'],
      })]));
      expect(listThemeWidgetRenderers(theme, 'manual-list').map((item) => item.key)).toEqual([
        'list-sidebar',
        'list-grid',
        'list-carousel',
      ]);
    }
    expect(getThemeWidgetSlots('default').map((slot) => slot.key)).toEqual(['home.main', 'home.sidebar', 'detail.related', 'footer']);
    expect(getThemeWidgetSlots('default')[0].rendererKeys).toEqual(['list-grid', 'list-carousel']);
    expect(getThemeWidgetSlots('docs').map((slot) => slot.key)).toEqual(['home.sidebar']);
  });

  it('requires optimistic revision and rejects immutable code in updates', () => {
    expect(updateCmsWidgetSchema.safeParse({ name: '新名称' }).success).toBe(false);
    expect(updateCmsWidgetSchema.safeParse({
      expectedRevision: 2,
      name: '新名称',
      code: 'must-not-change',
    }).success).toBe(false);
  });

  it('removes executable scripts from full theme previews', () => {
    expect(stripCmsPreviewScripts('<html><script>sendBeacon()</script><main>preview</main></html>'))
      .toBe('<html><main>preview</main></html>');
  });

  it('keeps page refs, source guards, transfer and tasks wired together', async () => {
    const [pages, contents, channels, transfer, tasks] = await Promise.all([
      source('cms-pages.service.ts'),
      source('cms-contents-write.service.ts'),
      source('cms-channels.service.ts'),
      source('cms-site-transfer.service.ts'),
      source('cms-widget-tasks.ts'),
    ]);
    expect(pages).toContain('syncCmsPageWidgetRefs');
    expect(pages).toContain('deleteCmsPageWidgetRefs');
    expect(contents).toContain("assertCmsWidgetSourcesMutable('content'");
    // Working-copy edits cannot rebuild live widgets; the release builds all dependent pages.
    expect(contents).toContain('createCmsContentRelease(');
    const releases = await source('cms-releases.service.ts');
    expect(releases).toContain('buildCmsReleaseCandidate(release, deployment, ctx, guard)');
    const candidateBuilder = await source('cms-release-build.service.ts');
    expect(candidateBuilder).toContain('assertCmsReleaseDependencies(tx, release.siteId)');
    expect(candidateBuilder).toContain('buildSiteStatic(release.siteId,');
    expect(channels).toContain("assertCmsWidgetSourcesMutable('channel'");
    expect(channels).toContain("assertCmsWidgetSourcesMutable('channel', [id], tx)");
    expect(channels).toContain('submitCmsWidgetChannelRefreshSideEffect([id])');
    expect(transfer).toContain('widgetIdMap');
    expect(transfer).toContain('remapImportedWidgetBlocks');
    expect(transfer).toContain('skippedWidgetSlots');
    expect(tasks).toContain('debounceBySite: true');
    expect(tasks).toContain("status: isBusinessBlock ? 'skipped' : 'failed'");
  });
});
