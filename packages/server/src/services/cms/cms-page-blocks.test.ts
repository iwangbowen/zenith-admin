import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { CmsBaseContext } from '../../cms/themes/types';
import { renderBlocksHtml } from '../../cms/themes/blocks';
import { sanitizeCmsImportedFragment } from './cms-fragment-content';
import { sanitizeCmsPageBlocks } from './cms-page-blocks';

describe('CMS imported visual content safety', () => {
  it('sanitizes imported HTML fragments', () => {
    const clean = sanitizeCmsImportedFragment(
      'html',
      '<div onclick="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">link</a><p>safe</p></div>',
    );
    expect(clean).toContain('<p>safe</p>');
    expect(clean).not.toMatch(/onclick|script|javascript:/i);
  });

  it('canonicalizes imported JSON and renders HTML-looking values as inert text', () => {
    const clean = sanitizeCmsImportedFragment(
      'json',
      '{ "payload": "<img src=x onerror=alert(1)>" }',
    );
    expect(clean).toBe('{"payload":"<img src=x onerror=alert(1)>"}');
    const rendered = renderBlocksHtml({
      blocks: [{
        id: 'json-fragment',
        type: 'fragment',
        props: { code: 'unsafe-json' },
      }],
      ctx: {
        fragments: {
          'unsafe-json': { type: 'json', content: clean! },
        },
      } as CmsBaseContext,
      contentListData: new Map(),
    });
    expect(rendered).toContain('<pre>');
    expect(rendered).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(rendered).not.toContain('<img src=x');
  });

  it('rejects invalid imported JSON fragments', () => {
    expect(() => sanitizeCmsImportedFragment('json', '{"broken":')).toThrow();
  });

  it('routes default and docs theme fragments through the safe renderer', async () => {
    const [defaultTheme, docsTheme] = await Promise.all([
      readFile(new URL('../../cms/themes/default/templates.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../cms/themes/docs/index.tsx', import.meta.url), 'utf8'),
    ]);
    expect(defaultTheme).toContain('CmsFragmentContent');
    expect(defaultTheme).not.toContain('__html: fragment.content');
    expect(docsTheme).toContain('CmsFragmentContent');
    expect(docsTheme).not.toContain('__html: banner.content');
  });

  it('validates block shape and sanitizes nested richtext HTML', () => {
    const blocks = sanitizeCmsPageBlocks([
      {
        id: 'rich-1',
        type: 'richtext',
        props: {
          html: '<p onmouseover="alert(1)">text<img src="data:text/html,evil"></p>',
        },
      },
    ]);
    expect(blocks).toHaveLength(1);
    expect(String(blocks[0].props.html)).toContain('<p>text');
    expect(String(blocks[0].props.html)).not.toMatch(/onmouseover|data:/i);
  });

  it('rejects unknown, duplicate or malformed blocks', () => {
    expect(() => sanitizeCmsPageBlocks({})).toThrow();
    expect(() => sanitizeCmsPageBlocks([{ id: 'x', type: 'unknown', props: {} }])).toThrow();
    expect(() => sanitizeCmsPageBlocks([
      { id: 'same', type: 'hero', props: {} },
      { id: 'same', type: 'image', props: {} },
    ])).toThrow();
  });
});
