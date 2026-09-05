import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('CMS admin/member route authentication boundary', () => {
  it('keeps member CMS routes on memberAuthMiddleware only', async () => {
    const source = await readFile(new URL('../../routes/member/member-cms.ts', import.meta.url), 'utf8');
    expect(source).toContain('memberAuthMiddleware');
    expect(source).not.toMatch(/\bauthMiddleware\b/);
  });

  it('keeps admin CMS content routes on authMiddleware and guards', async () => {
    const source = await readFile(new URL('../../routes/cms/contents.ts', import.meta.url), 'utf8');
    expect(source).toContain('authMiddleware');
    expect(source).toContain("cms:content:publish");
    expect(source).not.toContain('memberAuthMiddleware');
  });

  it('keeps open CMS writes on an app-scoped principal instead of super-admin impersonation', async () => {
    const [writeSource, contextSource, sitesSource, channelsSource] = await Promise.all([
      readFile(new URL('./cms-open-write.service.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../lib/context.ts', import.meta.url), 'utf8'),
      readFile(new URL('./cms-sites.service.ts', import.meta.url), 'utf8'),
      readFile(new URL('./cms-channels.service.ts', import.meta.url), 'utf8'),
    ]);
    expect(writeSource).toContain('runWithCmsOpenApiAccess');
    expect(writeSource).toContain("roles: []");
    expect(writeSource).not.toContain("roles: ['super_admin']");
    expect(contextSource).toContain('CmsOpenApiAccessContext');
    expect(sitesSource).toContain('currentCmsOpenApiAccess');
    expect(channelsSource).toContain('currentCmsOpenApiAccess');
  });

  it('keeps direct publication as an explicit open API endpoint', async () => {
    const [routeSource, validationSource] = await Promise.all([
      readFile(new URL('../../routes/open-platform/open-cms.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../../../shared/src/cms/validation.ts', import.meta.url), 'utf8'),
    ]);
    // PATCH 入参由契约绑定的 update schema 派生，publish 意图只能走 /publish 端点
    expect(routeSource).toContain('openCmsContract.updateContent');
    expect(routeSource).toContain('openCmsContract.publishContent');
    expect(validationSource).toContain('partialForUpdate(openCmsContentWriteSchema.omit({ publish: true }))');
  });
});
