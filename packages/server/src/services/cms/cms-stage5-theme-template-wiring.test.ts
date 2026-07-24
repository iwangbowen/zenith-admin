import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('CMS Stage 5 theme/template inheritance wiring', () => {
  it('shares one template scope resolver across runtime catalog and DSL selection', async () => {
    const source = await readFile(new URL('./cms-template-resolution.service.ts', import.meta.url), 'utf8');
    expect(source.match(/buildCmsTemplateScopeChain/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("source: template.siteId == null ? 'global'");
    expect(source).toContain("template.siteId === siteId ? 'own' : 'inherited'");
    expect(source).toContain('row ??= await findForScope(null)');
  });

  it('uses effective settings and the same catalog in health checks', async () => {
    const source = await readFile(new URL('./cms-template-refs.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('resolveEffectiveCmsSiteRow(siteId)');
    expect(source).toContain('resolveAvailableCmsTemplateNames(siteId, themeCode, { executor })');
  });

  it('propagates parent lifecycle changes to inheriting descendants with revision fences', async () => {
    const theme = await readFile(new URL('./cms-theme-lifecycle.service.ts', import.meta.url), 'utf8');
    const template = await readFile(new URL('./cms-template-lifecycle.service.ts', import.meta.url), 'utf8');
    const fence = await readFile(new URL('./cms-site-publish-lock.service.ts', import.meta.url), 'utf8');
    expect(theme).toContain("listCmsInheritanceAffectedSiteIds(siteId, 'theme'");
    expect(theme).toContain('insertAffectedThemeTasks');
    expect(theme).toContain('themeRevision: sql');
    expect(template).toContain('listCmsTemplateAffectedSiteIds');
    expect(template).toContain('bumpCmsTemplateRefsRevision');
    expect(template).toContain('cmsSiteFencePayload(tx, fencedSite)');
    expect(fence.match(/getCmsEffectiveThemeDeployment/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('exposes affected inherited sites in impact analysis instead of only the edited parent', async () => {
    const source = await readFile(new URL('./cms-themes.service.ts', import.meta.url), 'utf8');
    expect(source).toContain("listCmsInheritanceAffectedSiteIds(siteId, 'theme')");
    expect(source).toContain('affectedSiteIds');
    expect(source).toContain('assertSitesAccess(affectedSiteIds)');
  });
});
