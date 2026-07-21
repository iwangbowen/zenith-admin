import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseCmsImportSiteCode } from './cms-import-security';

describe('CMS site import code validation', () => {
  it.each(['../../escape', '..', '.', '/root', 'a/b', 'a\\b', 'https://evil.example', 'site name'])(
    'rejects path/traversal code %s',
    (code) => expect(() => parseCmsImportSiteCode(code)).toThrow(),
  );

  it('uses the normal site code schema', () => {
    expect(parseCmsImportSiteCode('docs-site-2')).toBe('docs-site-2');
    expect(() => parseCmsImportSiteCode('Docs_Site')).toThrow();
  });

  it('sanitizes imported fragments, page blocks and rich content at the service boundary', async () => {
    const source = await readFile(new URL('./cms-site-transfer.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('sanitizeCmsImportedFragment');
    expect(source).toContain('blocks: sanitizeCmsPageBlocks(p.blocks ?? [])');
    expect(source).toContain('body: sanitizeCmsHtml(str(c.body))');
    expect(source).toContain('pageContent: sanitizeCmsHtml(str(ch.pageContent))');
  });

  it('downgrades imported published or scheduled content to drafts', async () => {
    const source = await readFile(new URL('./cms-site-transfer.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('...CMS_IMPORTED_CONTENT_LIFECYCLE');
    expect(source).not.toContain('status: (str(c.status)');
    expect(source).not.toContain('scheduledAt: parseDateTimeInput(str(c.scheduledAt)');
  });

  it('invalidates the global site lookup cache only after the import transaction commits', async () => {
    const source = await readFile(new URL('./cms-site-transfer.service.ts', import.meta.url), 'utf8');
    expect(source).toMatch(
      /const result = await db\.transaction\([\s\S]*?\n {2}\}\);\n {2}invalidateSiteCache\(\);\n {2}return result;/,
    );
  });
});
