import { describe, expect, it } from 'vitest';
import { SEED_CMS_TEMPLATE_VERSIONS, type CmsTemplateDslDocument, type CmsTemplateDslNode } from '@zenith/shared';
import {
  canonicalizeCmsJson,
  checksumCmsTemplateDsl,
  CmsTemplateDslError,
  renderCmsTemplateDsl,
  validateCmsTemplateDsl,
} from './dsl';

describe('CMS declarative template DSL', () => {
  it('rejects executable elements, event attributes, arbitrary bindings and components', () => {
    const samples = [
      { version: 2, root: { kind: 'element', tag: 'script', children: [] } },
      { version: 2, root: { kind: 'element', tag: 'div', attrs: { onClick: 'alert(1)' } } },
      { version: 2, root: { kind: 'binding', bind: 'process.env.SECRET' } },
      { version: 2, root: { kind: 'component', name: 'ArbitraryImport' } },
    ];
    for (const sample of samples) {
      const report = validateCmsTemplateDsl(sample);
      expect(report.valid).toBe(false);
      expect(report.issues.length).toBeGreaterThan(0);
    }
  });

  it('enforces depth, node count, string length and DSL version limits', () => {
    let deep: CmsTemplateDslNode = { kind: 'text', value: 'leaf' };
    for (let i = 0; i < 34; i++) deep = { kind: 'element', tag: 'div', children: [deep] };
    expect(validateCmsTemplateDsl({ version: 2, root: deep }).issues.some((item) => item.code === 'too_deep')).toBe(true);

    const many = Array.from({ length: 501 }, () => ({ kind: 'text', value: 'x' } as const));
    expect(validateCmsTemplateDsl({ version: 2, root: { kind: 'element', tag: 'div', children: many } }).issues.some((item) => item.code === 'too_many_nodes')).toBe(true);
    expect(validateCmsTemplateDsl({ version: 2, root: { kind: 'text', value: 'x'.repeat(4097) } }).issues.some((item) => item.code === 'string_too_long')).toBe(true);
    expect(validateCmsTemplateDsl({ version: 2, root: { kind: 'binding', bind: 'site.name', fallback: 'x'.repeat(4097) } }).issues.some((item) => item.code === 'string_too_long')).toBe(true);
    expect(validateCmsTemplateDsl({ version: 1, root: { kind: 'text', value: 'legacy' } }).valid).toBe(false);
  });

  it('rejects extremely deep raw payloads before recursive Zod parsing without throwing RangeError', () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let index = 0; index < 2_000; index++) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    let report: ReturnType<typeof validateCmsTemplateDsl> | undefined;
    expect(() => { report = validateCmsTemplateDsl({ version: 2, root }); }).not.toThrow();
    expect(report?.valid).toBe(false);
    expect(report?.issues.some((item) => item.code === 'raw_too_deep')).toBe(true);
  });

  it('fails explicitly when bounded collections would expand into excessive output', () => {
    const nested: CmsTemplateDslDocument = {
      version: 2,
      root: {
        kind: 'each',
        source: 'items',
        children: [{
          kind: 'each',
          source: 'items',
          children: [{ kind: 'binding', bind: 'item.title' }],
        }],
      },
    };
    const items = Array.from({ length: 100 }, (_, id) => ({ id, title: `Item ${id}`, url: `/${id}` }));
    expect(() => renderCmsTemplateDsl(nested, { items })).toThrow(/展开后节点/);
  });

  it('escapes text bindings and sanitizes every rich-text sink with the Stage 1 sanitizer', () => {
    const textDsl: CmsTemplateDslDocument = {
      version: 2,
      root: { kind: 'element', tag: 'p', children: [{ kind: 'binding', bind: 'site.name' }] },
    };
    const text = renderCmsTemplateDsl(textDsl, { site: { name: '<img src=x onerror=alert(1)>' } });
    expect(text).toContain('&lt;img');
    expect(text).not.toContain('<img src=x');

    const richDsl: CmsTemplateDslDocument = {
      version: 2,
      root: { kind: 'rich_text', bind: 'content.body' },
    };
    const rich = renderCmsTemplateDsl(richDsl, {
      content: { body: '<p>safe</p><img src="https://example.com/a.png" onerror="alert(1)"><script>alert(2)</script>' },
    });
    expect(rich).toContain('<p>safe</p>');
    expect(rich).not.toContain('onerror');
    expect(rich).not.toContain('<script');
  });

  it('fails rendering explicitly when a bound URL is unsafe', () => {
    const dsl: CmsTemplateDslDocument = {
      version: 2,
      root: { kind: 'element', tag: 'a', attrs: { href: { bind: 'site.logo' } }, children: [{ kind: 'text', value: 'link' }] },
    };
    expect(() => renderCmsTemplateDsl(dsl, { site: { logo: 'javascript:alert(1)' } })).toThrow(CmsTemplateDslError);
  });

  it('canonicalizes object keys and keeps seeded checksums reproducible', () => {
    expect(canonicalizeCmsJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
    for (const version of SEED_CMS_TEMPLATE_VERSIONS) {
      expect(checksumCmsTemplateDsl(version.dsl)).toBe(version.checksum);
    }
  });
});
