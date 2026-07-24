import { describe, expect, it } from 'vitest';
import { CMS_SECRET_MASK } from '@zenith/shared';
import type { CmsSiteInheritanceRow, CmsSiteRow } from '../../db/schema';
import {
  buildCmsTemplateScopeChain,
  resolveCmsSiteSnapshot,
} from './cms-site-inheritance.service';
import { redactCmsSiteSettings } from './cms-site-settings';

function site(input: Partial<CmsSiteRow> & Pick<CmsSiteRow, 'id' | 'name' | 'code'>): CmsSiteRow {
  return {
    parentId: null,
    domain: null,
    aliasDomains: [],
    isDefault: false,
    title: null,
    keywords: null,
    description: null,
    logo: null,
    favicon: null,
    icp: null,
    copyright: null,
    theme: 'default',
    themeRevision: 0,
    templateRefsRevision: 0,
    staticMode: 'hybrid',
    robots: null,
    settings: {},
    status: 'enabled',
    sort: 0,
    remark: null,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date('2026-07-24T00:00:00Z'),
    updatedAt: new Date('2026-07-24T00:00:00Z'),
    ...input,
  };
}

function inheritance(siteId: number, patch: Partial<CmsSiteInheritanceRow>): CmsSiteInheritanceRow {
  return {
    siteId,
    seoTitle: false,
    seoKeywords: false,
    seoDescription: false,
    staticMode: false,
    reviewMode: false,
    webhook: false,
    cdn: false,
    theme: false,
    themeConfig: false,
    templates: false,
    revision: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date('2026-07-24T00:00:00Z'),
    updatedAt: new Date('2026-07-24T00:00:00Z'),
    ...patch,
  };
}

describe('CMS explicit site inheritance resolver', () => {
  const rows = [
    site({
      id: 1,
      name: 'root',
      code: 'root',
      title: 'Root title',
      keywords: 'root-keywords',
      theme: 'docs',
      settings: {
        auditMode: 'workflow',
        webhookUrl: 'https://hooks.example.test/cms',
        webhookSecret: 'parent-secret',
        defaultTemplates: { pc: { list: 'root-list' } },
      },
    }),
    site({
      id: 2,
      parentId: 1,
      name: 'child',
      code: 'child',
      title: 'Child title',
      keywords: 'child-keywords',
      settings: {
        auditMode: 'simple',
        webhookSecret: 'child-secret',
        defaultTemplates: { pc: { list: 'child-list' } },
      },
    }),
  ];

  it('resolves each field independently and preserves explicit own overrides', () => {
    const resolved = resolveCmsSiteSnapshot(rows, [
      inheritance(1, {}),
      inheritance(2, {
        seoKeywords: true,
        reviewMode: true,
        webhook: true,
        theme: true,
        templates: true,
      }),
    ], 2);
    expect(resolved.site.title).toBe('Child title');
    expect(resolved.site.keywords).toBe('root-keywords');
    expect(resolved.site.theme).toBe('docs');
    expect(resolved.site.settings).toMatchObject({
      auditMode: 'workflow',
      webhookUrl: 'https://hooks.example.test/cms',
      webhookSecret: 'parent-secret',
      defaultTemplates: { pc: { list: 'root-list' } },
    });
    expect(resolved.sourceSiteIds).toMatchObject({
      seoTitle: 2,
      seoKeywords: 1,
      reviewMode: 1,
      theme: 1,
      templates: 1,
    });
  });

  it('restores the child value when an inherit flag is disabled', () => {
    const inherited = resolveCmsSiteSnapshot(rows, [inheritance(2, { seoTitle: true })], 2);
    const restored = resolveCmsSiteSnapshot(rows, [inheritance(2, { seoTitle: false })], 2);
    expect(inherited.site.title).toBe('Root title');
    expect(restored.site.title).toBe('Child title');
  });

  it('keeps inherited secrets available only to runtime and masks the API boundary', () => {
    const resolved = resolveCmsSiteSnapshot(rows, [inheritance(2, { webhook: true })], 2);
    expect(resolved.site.settings.webhookSecret).toBe('parent-secret');
    expect(redactCmsSiteSettings(resolved.site.settings).webhookSecret).toBe(CMS_SECRET_MASK);
  });

  it('builds the exact site-own → inherited-parent → global template scope chain', () => {
    const grandchild = site({ id: 3, parentId: 2, name: 'grandchild', code: 'grandchild' });
    expect(buildCmsTemplateScopeChain(
      [...rows, grandchild],
      [inheritance(2, { templates: false }), inheritance(3, { templates: true })],
      3,
    )).toEqual([3, 2]);
    expect(buildCmsTemplateScopeChain(
      [...rows, grandchild],
      [inheritance(2, { templates: true }), inheritance(3, { templates: true })],
      3,
    )).toEqual([3, 2, 1]);
  });
});
