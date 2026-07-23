import { afterEach, describe, expect, it } from 'vitest';
import {
  mockCmsPublishArtifacts,
  mockCmsPublishingTasks,
  mockCmsTemplates,
  mockCmsTemplateVersions,
  mockCmsThemePackages,
} from '@/mocks/data/cms-stage3';
import { cmsStage3Handlers } from '@/mocks/handlers/cms-stage3';
import { cmsHandlers } from '@/mocks/handlers/cms';
import { mockCmsSites } from '@/mocks/data/cms';

const snapshots = {
  templates: structuredClone(mockCmsTemplates),
  versions: structuredClone(mockCmsTemplateVersions),
  packages: structuredClone(mockCmsThemePackages),
  tasks: structuredClone(mockCmsPublishingTasks),
  artifacts: structuredClone(mockCmsPublishArtifacts),
  sites: structuredClone(mockCmsSites),
};

afterEach(() => {
  mockCmsTemplates.splice(0, mockCmsTemplates.length, ...structuredClone(snapshots.templates));
  mockCmsTemplateVersions.splice(0, mockCmsTemplateVersions.length, ...structuredClone(snapshots.versions));
  mockCmsThemePackages.splice(0, mockCmsThemePackages.length, ...structuredClone(snapshots.packages));
  mockCmsPublishingTasks.splice(0, mockCmsPublishingTasks.length, ...structuredClone(snapshots.tasks));
  mockCmsPublishArtifacts.splice(0, mockCmsPublishArtifacts.length, ...structuredClone(snapshots.artifacts));
  mockCmsSites.splice(0, mockCmsSites.length, ...structuredClone(snapshots.sites));
});

async function call(method: string, path: string, body?: unknown, uploadName?: string) {
  for (const handler of [...cmsStage3Handlers, ...cmsHandlers]) {
    const boundary = '----zenith-cms-stage3-test';
    const uploadBody = uploadName
      ? `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${uploadName}"\r\nContent-Type: application/zip\r\n\r\nPK demo\r\n--${boundary}--\r\n`
      : undefined;
    const request = new Request(`${window.location.origin}${path}`, {
      method,
      headers: uploadName ? { 'content-type': `multipart/form-data; boundary=${boundary}` } : { 'content-type': 'application/json' },
      body: uploadBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const result = await (handler as unknown as {
      run(args: unknown): Promise<{ response?: Response } | null>;
    }).run({ request, requestId: `cms-stage3-${Math.random()}` });
    if (result?.response) {
      const contentType = result.response.headers.get('content-type') ?? '';
      return {
        status: result.response.status,
        body: contentType.includes('json') ? await result.response.json() : await result.response.arrayBuffer(),
      };
    }
  }
  throw new Error(`No handler matched ${method} ${path}`);
}

describe('CMS Stage 3 MSW handlers', () => {
  it('returns actionable DSL validation feedback for executable nodes', async () => {
    const response = await call('POST', '/api/cms/templates/validate', {
      dsl: { version: 2, root: { kind: 'element', tag: 'script', attrs: { onClick: 'alert(1)' }, children: [] } },
    });
    expect(response.status).toBe(200);
    const report = (response.body as { data: { valid: boolean; issues: Array<{ code: string }> } }).data;
    expect(report.valid).toBe(false);
    expect(report.issues.map((item) => item.code)).toEqual(expect.arrayContaining(['element_not_allowed', 'attribute_not_allowed']));
  });

  it('appends and activates template versions through a publish task', async () => {
    const template = mockCmsTemplates.find((item) => item.source === 'manual')!;
    const before = template.currentVersion;
    const saved = await call('POST', `/api/cms/templates/${template.id}/versions`, {
      dsl: mockCmsTemplateVersions.find((item) => item.templateId === template.id)!.dsl,
      changeNote: 'MSW 行为测试',
    });

    expect(saved.status).toBe(200);
    expect(template.currentVersion).toBe(before + 1);
    const activated = await call('POST', `/api/cms/templates/${template.id}/activate`, {});
    expect((activated.body as { data: { tasks: Array<{ taskType: string }> } }).data.tasks[0].taskType).toBe('cms-publish-build');
    expect(template.activeVersion).toBe(template.currentVersion);
    const currentBeforeRollback = template.currentVersion;
    await call('POST', `/api/cms/templates/${template.id}/rollback`, { version: 1 });
    expect(template.currentVersion).toBe(currentBeforeRollback + 1);
    expect(template.activeVersion).toBe(template.currentVersion);
    expect(mockCmsTemplateVersions.some((item) => item.templateId === template.id && item.version === 1)).toBe(true);
  });

  it('rejects manual lifecycle operations for package-owned templates', async () => {
    const source = mockCmsTemplates[0]!;
    const packageTemplate = {
      ...structuredClone(source),
      id: 9999,
      source: 'package' as const,
      status: 'disabled' as const,
      activeVersion: null,
    };
    mockCmsTemplates.push(packageTemplate);
    const response = await call('POST', `/api/cms/templates/${packageTemplate.id}/activate`, {});
    expect(response.status).toBe(400);
    expect(packageTemplate.activeVersion).toBeNull();
  });

  it('derives package template activity from the selected site deployment', async () => {
    await call('POST', '/api/cms/themes/import', undefined, 'templates.zip');
    const pkg = mockCmsThemePackages[0]!;
    const packageTemplate = mockCmsTemplates.find((item) => item.source === 'package' && item.themeCode === pkg.code)!;
    let list = await call('GET', '/api/cms/templates?page=1&pageSize=100&siteId=1');
    let projected = (list.body as { data: { list: typeof mockCmsTemplates } }).data.list.find((item) => item.id === packageTemplate.id)!;
    expect(projected.status).toBe('disabled');
    expect(projected.activeVersion).toBeNull();

    await call('POST', `/api/cms/themes/${pkg.id}/activate`, { siteId: 1 });
    list = await call('GET', '/api/cms/templates?page=1&pageSize=100&siteId=1');
    projected = (list.body as { data: { list: typeof mockCmsTemplates } }).data.list.find((item) => item.id === packageTemplate.id)!;
    expect(projected.status).toBe('enabled');
    expect(projected.activeVersion).not.toBeNull();
  });

  it('derives the selector catalog only from the active package manifest and restores built-ins', async () => {
    await call('POST', '/api/cms/themes/import', undefined, 'catalog.zip');
    const pkg = mockCmsThemePackages[0]!;
    await call('POST', `/api/cms/themes/${pkg.id}/activate`, { siteId: 1 });
    const packageCatalog = await call('GET', `/api/cms/sites/themes/${pkg.code}/templates?siteId=1`);
    const catalog = (packageCatalog.body as { data: { list: Array<{ name: string }>; detail: Array<{ name: string }> } }).data;
    expect(catalog.list.map((item) => item.name)).toEqual(
      pkg.manifest.templates.filter((item) => item.type === 'list').map((item) => item.code),
    );
    expect(catalog.list.some((item) => item.name === 'list-card')).toBe(false);

    await call('POST', '/api/cms/themes/builtin/default/activate', { siteId: 1 });
    const builtinCatalog = await call('GET', '/api/cms/sites/themes/default/templates?siteId=1');
    expect((builtinCatalog.body as { data: { list: Array<{ name: string }> } }).data.list.some((item) => item.name === 'list-card')).toBe(true);
  });

  it('validates a package upload before submitting the import task', async () => {
    const validation = await call('POST', '/api/cms/themes/validate', undefined, 'editorial-demo.zip');
    expect((validation.body as { data: { valid: boolean } }).data.valid).toBe(true);
    const imported = await call('POST', '/api/cms/themes/import', undefined, 'editorial-demo.zip');
    expect((imported.body as { data: { taskType: string } }).data.taskType).toBe('cms-theme-import');
    await call('POST', '/api/cms/themes/import', undefined, 'editorial-demo-v2.zip');
    const [newest, previous] = mockCmsThemePackages;
    await call('POST', `/api/cms/themes/${previous.id}/activate`, { siteId: 1 });
    const activated = await call('POST', `/api/cms/themes/${newest.id}/activate`, { siteId: 1 });
    expect((activated.body as { data: { task: { taskType: string } } }).data.task.taskType).toBe('cms-publish-build');
    expect(newest.activeSiteIds).toContain(1);
    const rolledBack = await call('POST', '/api/cms/themes/rollback', { siteId: 1, themeCode: newest.code, packageId: newest.id });
    expect((rolledBack.body as { data: { package: { id: number } } }).data.package.id).not.toBe(newest.id);
  });

  it('simulates asynchronous terminal import failure without prematurely mutating catalogs', async () => {
    const packageCount = mockCmsThemePackages.length;
    const templateCount = mockCmsTemplates.length;
    const response = await call('POST', '/api/cms/themes/import', undefined, 'theme-fail.zip');
    const task = (response.body as { data: { taskType: string; payload: Record<string, unknown> } }).data;
    expect(task.taskType).toBe('cms-theme-import');
    expect(task.payload).toMatchObject({ alwaysFail: true, failAtItem: 1 });
    expect(mockCmsThemePackages).toHaveLength(packageCount);
    expect(mockCmsTemplates).toHaveLength(templateCount);
  });

  it('records activate, deactivate and reactivate as three tasks while duplicate activation is a no-op', async () => {
    await call('POST', '/api/cms/themes/import', undefined, 'lifecycle.zip');
    const pkg = mockCmsThemePackages[0]!;
    const before = mockCmsPublishingTasks.length;
    expect((await call('POST', `/api/cms/themes/${pkg.id}/activate`, { siteId: 1 })).status).toBe(200);
    expect((await call('POST', '/api/cms/themes/deactivate', { siteId: 1, themeCode: pkg.code, packageId: pkg.id })).status).toBe(200);
    expect((await call('POST', `/api/cms/themes/${pkg.id}/activate`, { siteId: 1 })).status).toBe(200);
    expect(mockCmsPublishingTasks).toHaveLength(before + 3);
    expect((await call('POST', `/api/cms/themes/${pkg.id}/activate`, { siteId: 1 })).status).toBe(409);
    expect(mockCmsPublishingTasks).toHaveLength(before + 3);
  });

  it('serves anonymous assets only for the exact active site package version', async () => {
    await call('POST', '/api/cms/themes/import', undefined, 'assets.zip');
    const pkg = mockCmsThemePackages[0]!;
    pkg.manifest.assets = ['assets/site.css'];
    const assetPath = pkg.manifest.assets[0]!.replace(/^assets\//, '');
    expect((await call('GET', `/api/public/cms/theme-assets/1/${pkg.code}/${pkg.version}/assets/${assetPath}`)).status).toBe(404);
    await call('POST', `/api/cms/themes/${pkg.id}/activate`, { siteId: 1 });
    expect((await call('GET', `/api/public/cms/theme-assets/1/${pkg.code}/${pkg.version}/assets/${assetPath}`)).status).toBe(200);
    expect((await call('GET', `/api/public/cms/theme-assets/2/${pkg.code}/${pkg.version}/assets/${assetPath}`)).status).toBe(404);
    expect((await call('GET', `/api/public/cms/theme-assets/1/${pkg.code}/9.9.9/assets/${assetPath}`)).status).toBe(404);
  });

  it('submits publishing into the common task model and exposes authorized artifacts', async () => {
    const submitted = await call('POST', '/api/cms/publishing/submit', {
      siteId: 1,
      targetType: 'contents',
      contentIds: [1, 2],
      reason: 'MSW 发布测试',
    });
    expect((submitted.body as { data: { taskType: string } }).data.taskType).toBe('cms-publish-build');
    const list = await call('GET', '/api/cms/publishing?page=1&pageSize=20');
    expect((list.body as { data: { list: Array<{ targetType: string }> } }).data.list.some((item) => item.targetType === 'contents')).toBe(true);
    const artifacts = await call('GET', '/api/cms/publishing/artifacts?page=1&pageSize=20&siteId=1');
    expect((artifacts.body as { data: { list: unknown[] } }).data.list.length).toBeGreaterThan(0);
  });
});
