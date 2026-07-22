import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildCmsFieldReferences, cmsResourceContainsUrl, cmsResourceMatchingFields, isCmsResourceOrphan,
} from './cms-resources.service';

describe('CMS resource governance', () => {
  it('detects URLs in nested mediaData/extend/page/form/theme structures', () => {
    const url = '/api/files/demo/content';
    expect(cmsResourceContainsUrl({ nested: [{ cover: url }] }, url)).toBe(true);
    expect(cmsResourceContainsUrl('<p>other</p>', url)).toBe(false);
  });

  it('treats a friend-link logo as a material reference', async () => {
    const url = '/assets/partner-logo.svg';
    expect(cmsResourceMatchingFields({ logo: url, url: 'https://partner.example' }, url)).toEqual(['logo']);
    const source = await readFile(new URL('./cms-resources.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('cmsFriendLinks.logo');
    expect(source).toContain('FRIEND_LINK_RESOURCE_FIELDS');
  });

  it.each([
    ['content', { sourceUrl: '/files/source.pdf' }, '/files/source.pdf', 'sourceUrl'],
    ['content', { externalLink: '/files/download.zip' }, '/files/download.zip', 'externalLink'],
    ['channel', { linkUrl: '/files/channel.pdf' }, '/files/channel.pdf', 'linkUrl'],
  ] as const)('keeps %s references found only through newly covered URL fields', (kind, fields, url, field) => {
    const references = buildCmsFieldReferences(kind, 1, '引用对象', fields, url);
    expect(references).toEqual([{ kind, id: 1, title: '引用对象', field }]);
    expect(isCmsResourceOrphan(references)).toBe(false);
  });

  it('uses task center checkpoints, cancellation and row-level items', async () => {
    const source = await readFile(new URL('./cms-resource-tasks.ts', import.meta.url), 'utf8');
    expect(source).toContain('registerTaskHandler');
    expect(source).toContain('ctx.reportItems');
    expect(source).toContain('checkpoint:');
    expect(source).toContain('cancelRequested');
  });
});
