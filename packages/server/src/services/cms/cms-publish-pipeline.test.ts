import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(name: string): Promise<string> {
  return readFile(new URL(`./${name}`, import.meta.url), 'utf8');
}

describe('CMS standard publish pipeline', () => {
  it('atomically claims scheduled content, clears the schedule and logs the transition', async () => {
    const text = await source('cms-contents.service.ts');
    const transaction = text.match(
      /const published = await db\.transaction\([\s\S]*?return updated;\s*\}\);/,
    )?.[0] ?? '';
    expect(transaction).toContain('lte(cmsContents.scheduledAt, opts.scheduledAtBefore)');
    expect(transaction).toContain('eq(cmsContents.status, row.status)');
    expect(transaction).toContain('scheduledAt: null');
    expect(transaction).toContain("logContentOp(tx, id, 'published'");
    expect(transaction).toContain("throw new HTTPException(409");
  });

  it('makes the scheduler use the conditional standard pipeline without a second update', async () => {
    const text = await source('cms-scheduled.service.ts');
    expect(text).toContain('publishCmsContent(row.id, { skipAccessCheck: true, scheduledAtBefore: now })');
    expect(text).not.toMatch(/update\(cmsContents\).*scheduledAt/s);
  });

  it('centralizes static refresh and search auto-push for every publish entry point', async () => {
    const [contents, collect, workflow, scheduled, route] = await Promise.all([
      source('cms-contents.service.ts'),
      source('cms-collect.service.ts'),
      source('cms-workflow.service.ts'),
      source('cms-scheduled.service.ts'),
      readFile(new URL('../../routes/cms/contents.ts', import.meta.url), 'utf8'),
    ]);
    expect(contents).toMatch(
      /triggerCmsPublishedSideEffects[\s\S]*?triggerContentStaticRefresh\(row\.id\)[\s\S]*?triggerAutoPushForContent\(row\.id\)/,
    );
    expect(collect).toContain('if (rule.autoPublish) await publishCmsContent(content.id)');
    expect(workflow).toContain("await publishCmsContent(contentId, { fromWorkflow: true, skipAccessCheck: true })");
    expect(scheduled).toContain('await publishCmsContent(row.id, { skipAccessCheck: true, scheduledAtBefore: now })');
    expect(route).toContain('const row = await publishCmsContent(id)');
    for (const caller of [collect, workflow, scheduled, route]) {
      expect(caller).not.toContain('triggerAutoPushForContent');
    }
  });
});
