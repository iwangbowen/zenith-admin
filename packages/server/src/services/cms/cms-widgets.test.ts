import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { cmsWidgetDataSchema, updateCmsWidgetSchema } from '@zenith/shared/cms';
import type { CmsResolvedWidget } from '@zenith/shared/cms';
import { renderBlocksHtml } from '../../cms/themes/blocks';
import { getThemeWidgetSlots, listThemeWidgetRenderers } from '../../cms/themes/registry';
import { renderCmsWidgetHtml } from '../../cms/themes/widgets';
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

  it('renders all registered templates with React escaping', () => {
    const base: Omit<CmsResolvedWidget, 'rendererKey'> = {
      id: 1,
      name: '推荐 <script>',
      type: 'manual-list',
      items: [{
        id: 'one',
        sourceType: 'manual',
        sourceId: null,
        title: '<img src=x onerror=alert(1)>',
        summary: '安全摘要',
        url: '/safe',
        image: null,
        displayDate: null,
      }],
    };
    for (const rendererKey of ['list-sidebar', 'list-grid', 'list-carousel'] as const) {
      const html = renderCmsWidgetHtml({ ...base, rendererKey });
      expect(html).toContain('cms-widget');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img src=x onerror');
      expect(html).toContain('&lt;img');
    }
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

  it('injects widget styles only once for multiple blocks on the same page', () => {
    const widget: CmsResolvedWidget = {
      id: 1,
      name: '推荐',
      type: 'manual-list',
      rendererKey: 'list-sidebar',
      items: [],
    };
    const html = renderBlocksHtml({
      blocks: [
        { id: 'one', type: 'widget-ref', props: { widgetId: 1 } },
        { id: 'two', type: 'widget-ref', props: { widgetId: 1 } },
      ],
      contentListData: new Map(),
      widgetData: new Map([['one', widget], ['two', widget]]),
      themeCode: 'default',
    });

    expect(html.match(/<style>/g)).toHaveLength(1);
  });

  it('removes executable scripts from full theme previews', () => {
    expect(stripCmsPreviewScripts('<html><script>sendBeacon()</script><main>preview</main></html>'))
      .toBe('<html><main>preview</main></html>');
  });

  it('keeps page refs, source guards, transfer and rendering wired end to end', async () => {
    const [pages, contents, channels, transfer, render, tasks] = await Promise.all([
      source('cms-pages.service.ts'),
      source('cms-contents-write.service.ts'),
      source('cms-channels.service.ts'),
      source('cms-site-transfer.service.ts'),
      source('cms-render.service.ts'),
      source('cms-widget-tasks.ts'),
    ]);
    expect(pages).toContain('syncCmsPageWidgetRefs');
    expect(pages).toContain('deleteCmsPageWidgetRefs');
    expect(contents).toContain("assertCmsWidgetSourcesMutable('content'");
    // Working-copy edits cannot rebuild live widgets; the release builds all dependent pages.
    expect(contents).toContain('createCmsContentRelease(');
    const releases = await source('cms-releases.service.ts');
    expect(releases).toContain('assertCmsReleaseDependencies(tx, release.siteId)');
    expect(releases).toContain('buildSiteStatic(release.siteId,');
    expect(channels).toContain("assertCmsWidgetSourcesMutable('channel'");
    expect(channels).toContain("assertCmsWidgetSourcesMutable('channel', [id], tx)");
    expect(channels).toContain('submitCmsWidgetChannelRefreshSideEffect([id])');
    expect(transfer).toContain('widgetIdMap');
    expect(transfer).toContain('remapImportedWidgetBlocks');
    expect(transfer).toContain('skippedWidgetSlots');
    expect(render).toContain('resolveCmsWidgetPlacements');
    expect(render).toContain('resolveCmsThemeSlotsForRender(site.id, site.theme, baseUrl)');
    expect(render).toContain("base.themeSlots?.['home.sidebar']");
    expect(render).toContain('renderCmsWidgetThemePreview');
    expect(tasks).toContain('debounceBySite: true');
    expect(tasks).toContain("status: isBusinessBlock ? 'skipped' : 'failed'");
  });
});
