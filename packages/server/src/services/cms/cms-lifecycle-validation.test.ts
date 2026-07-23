import { describe, expect, it } from 'vitest';
import { createCmsTemplateSchema, saveCmsTemplateVersionSchema, updateCmsSiteSchema, updateCmsTemplateSchema } from '@zenith/shared';
import { ensureValidCmsTemplateDsl, validateCmsTemplateDsl } from './cms-templates.service';

describe('CMS lifecycle write boundaries', () => {
  it('strips theme from ordinary site updates', () => {
    expect(updateCmsSiteSchema.parse({ name: 'Renamed', theme: 'untrusted-theme' })).toEqual({ name: 'Renamed' });
  });

  it('strips status from ordinary template updates', () => {
    expect(updateCmsTemplateSchema.parse({ name: 'Renamed', status: 'enabled' })).toEqual({ name: 'Renamed' });
  });

  it('rejects package asset references in manually managed templates with actionable feedback', () => {
    const report = validateCmsTemplateDsl({
      version: 2,
      root: { kind: 'element', tag: 'link', attrs: { rel: 'stylesheet', href: { asset: 'styles/site.css' } } },
    });
    expect(report.valid).toBe(false);
    expect(report.issues.some((issue) => issue.code === 'manual_asset_not_available')).toBe(true);
  });

  it('keeps recursive DSL out of request Zod parsing so service preflight returns a controlled validation error', () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let index = 0; index < 2_000; index++) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    expect(() => createCmsTemplateSchema.parse({
      siteId: null,
      themeCode: 'default',
      type: 'list',
      code: 'deep-template',
      name: 'Deep',
      dsl: { version: 2, root },
    })).not.toThrow();
    expect(() => saveCmsTemplateVersionSchema.parse({ dsl: { version: 2, root } })).not.toThrow();
    expect(validateCmsTemplateDsl({ version: 2, root }).issues.some((issue) => issue.code === 'raw_too_deep')).toBe(true);
    expect(() => ensureValidCmsTemplateDsl({ version: 2, root })).toThrow(expect.objectContaining({ status: 400 }));
  });
});
