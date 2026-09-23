import { describe, expect, it } from 'vitest';
import { normalizeCmsContentDocument, renderCmsContentDocument } from './cms-document.service';

describe('canonical CMS document', () => {
  it('roundtrips text, lists, images and captions through the canonical document', () => {
    const document = normalizeCmsContentDocument('<h2>目录</h2><ul><li>A &amp; B</li></ul><figure><img src="/image.png" alt="示例" /><figcaption>说明</figcaption></figure>');
    const html = renderCmsContentDocument(document);
    expect(html).toContain('<h2>目录</h2>');
    expect(html).toContain('A &amp; B');
    expect(html).toContain('alt="示例"');
    expect(html).toContain('<figcaption>说明</figcaption>');
  });
  it('preserves node identities when unchanged blocks move', () => {
    const first = normalizeCmsContentDocument('<p>One</p><p>Two</p>');
    const moved = normalizeCmsContentDocument('<p>Two</p><p>One</p>', first);
    expect(moved.nodes[0].id).toBe(first.nodes[1].id);
    expect(moved.nodes[1].id).toBe(first.nodes[0].id);
  });
  it('cleans unsafe imports before creating the authority tree', () => {
    const document = normalizeCmsContentDocument('<p onclick="alert(1)">ok<script>alert(1)</script><a href="javascript:alert(2)">link</a></p>');
    const html = renderCmsContentDocument(document);
    expect(html).not.toMatch(/onclick|javascript:|<script/);
    expect(html).toContain('ok');
  });
});
