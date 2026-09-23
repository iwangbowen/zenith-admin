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

  it('sanitizes imported page blocks and rich content at the service boundary', async () => {
    const source = await readFile(new URL('./cms-site-transfer.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('return sanitizeCmsPageBlocks(blocks)');
    expect(source).toContain('const blocks = remapImportedWidgetBlocks(p.blocks, widgetIdMap, channelIdMap)');
    expect(source).toContain('const body = sanitizeCmsHtml(str(c.body))');
    expect(source).toContain('pageContent: sanitizeCmsHtml(str(ch.pageContent))');
  });

  it('downgrades imported published or scheduled content to drafts', async () => {
    const source = await readFile(new URL('./cms-site-transfer.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('...CMS_IMPORTED_CONTENT_LIFECYCLE');
    expect(source).not.toContain('status: (str(c.status)');
    expect(source).not.toContain('scheduledAt: parseDateTimeInput(str(c.scheduledAt)');
  });

  it('writes a fenced site publish outbox in the import transaction and enqueues it after commit', async () => {
    const source = await readFile(new URL('./cms-site-transfer.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('enqueueCmsPublishOutboxes');
    expect(source).toContain('insertCmsSiteRefsRebuildOutbox');
    const transactionStart = source.indexOf('const result = await db.transaction(');
    const taskWrite = source.indexOf('const publishTask = await insertCmsSiteRefsRebuildOutbox(', transactionStart);
    const transactionEnd = source.indexOf('});', taskWrite);
    const enqueue = source.indexOf('await enqueueCmsPublishOutboxes([result.publishTask]', transactionEnd);
    expect(transactionStart).toBeGreaterThanOrEqual(0);
    expect(taskWrite).toBeGreaterThan(transactionStart);
    expect(transactionEnd).toBeGreaterThan(taskWrite);
    expect(enqueue).toBeGreaterThan(transactionEnd);
    expect(source.slice(taskWrite, transactionEnd)).toContain('finalSite');
    expect(source.slice(taskWrite, transactionEnd)).toContain('站点导入完成');
  });

  it('invalidates the global site lookup cache only after the import transaction commits', async () => {
    const source = await readFile(new URL('./cms-site-transfer.service.ts', import.meta.url), 'utf8');
    const transactionStart = source.indexOf('const result = await db.transaction(');
    const cacheInvalidation = source.indexOf('invalidateSiteCache();', transactionStart);
    expect(transactionStart).toBeGreaterThanOrEqual(0);
    expect(cacheInvalidation).toBeGreaterThan(transactionStart);
    expect(source.slice(cacheInvalidation - 80, cacheInvalidation)).toContain('});');
  });
});
