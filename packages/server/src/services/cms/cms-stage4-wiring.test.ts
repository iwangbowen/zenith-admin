import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('CMS Stage4 task/export/ACL wiring', () => {
  it('revalidates task permissions and registers all requested export entities', async () => {
    const [tasks, exports, routes, publicRoutes] = await Promise.all([
      readFile(new URL('./cms-stage4-tasks.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../lib/export-center/definitions/index.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../routes/cms/interactions.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../routes/cms/front-public.ts', import.meta.url), 'utf8'),
    ]);
    expect(tasks).toContain("hasPermission('cms:ad-event:cleanup')");
    expect(tasks).toContain("hasPermission('cms:interaction:batch'");
    expect(tasks).toContain('ctx.progress');
    expect(tasks).toContain('ctx.reportItems');
    expect(exports).toContain('cmsAdEventsExportDefinition');
    expect(exports).toContain('cmsSubscriptionsExportDefinition');
    expect(exports).toContain('cmsInteractionResponsesExportDefinition');
    expect(routes).toContain("permission: 'cms:interaction:batch'");
    expect(publicRoutes).toContain('getClientIp(c)');
    expect(publicRoutes).not.toContain("header('x-forwarded-for')");
    expect(publicRoutes).toContain('optionalMemberSessionMiddleware');
  });
});
