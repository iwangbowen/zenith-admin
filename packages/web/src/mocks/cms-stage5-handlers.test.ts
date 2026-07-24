import { afterEach, describe, expect, it } from 'vitest';
import { CMS_SECRET_MASK, type CmsSite } from '@zenith/shared';
import { mockCmsChannels, mockCmsContents, mockCmsSites } from '@/mocks/data/cms';
import {
  mockCmsDistributionItems,
  mockCmsDistributionRules,
  mockCmsDistributionRuns,
} from '@/mocks/data/cms-stage5';
import { cmsStage5Handlers } from '@/mocks/handlers/cms-stage5';
import { mockCmsThemePackages } from '@/mocks/data/cms-stage3';

const snapshots = {
  sites: structuredClone(mockCmsSites),
  channels: structuredClone(mockCmsChannels),
  contents: structuredClone(mockCmsContents),
  rules: structuredClone(mockCmsDistributionRules),
  runs: structuredClone(mockCmsDistributionRuns),
  items: structuredClone([...mockCmsDistributionItems.entries()]),
  packages: structuredClone(mockCmsThemePackages),
};

afterEach(() => {
  mockCmsSites.splice(0, mockCmsSites.length, ...structuredClone(snapshots.sites));
  mockCmsChannels.splice(0, mockCmsChannels.length, ...structuredClone(snapshots.channels));
  mockCmsContents.splice(0, mockCmsContents.length, ...structuredClone(snapshots.contents));
  mockCmsDistributionRules.splice(0, mockCmsDistributionRules.length, ...structuredClone(snapshots.rules));
  mockCmsDistributionRuns.splice(0, mockCmsDistributionRuns.length, ...structuredClone(snapshots.runs));
  mockCmsDistributionItems.clear();
  for (const [taskId, items] of structuredClone(snapshots.items)) mockCmsDistributionItems.set(taskId, items);
  mockCmsThemePackages.splice(0, mockCmsThemePackages.length, ...structuredClone(snapshots.packages));
});

async function call(method: string, path: string, body?: unknown) {
  for (const handler of cmsStage5Handlers) {
    const request = new Request(`${window.location.origin}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await (handler as unknown as {
      run(args: unknown): Promise<{ response?: Response } | null>;
    }).run({ request, requestId: `cms-stage5-${Math.random()}` });
    if (result?.response) {
      const contentType = result.response.headers.get('content-type') ?? '';
      return {
        status: result.response.status,
        body: contentType.includes('json')
          ? await result.response.json() as { code: number; message: string; data: unknown }
          : { code: 0, message: 'ok', data: await result.response.text() },
      };
    }
  }
  throw new Error(`No handler matched ${method} ${path}`);
}

describe('CMS Stage 5 MSW handlers', () => {
  it('renders the parent-child tree and rejects moving a root into its subtree', async () => {
    const tree = await call('GET', '/api/cms/sites/tree');
    const roots = tree.body.data as CmsSite[];
    expect(roots[0].children?.map((site) => site.id)).toContain(2);

    const cycle = await call('PUT', '/api/cms/sites/1/parent', { parentId: 2 });
    expect(cycle.status).toBe(400);
    expect(cycle.body.message).toContain('子树');
  });

  it('resolves explicit own/inherited values and never reveals inherited secrets', async () => {
    const all = await call('GET', '/api/cms/sites/all');
    expect(((all.body.data as CmsSite[])[0].settings as { webhookSecret?: string }).webhookSecret).toBe(CMS_SECRET_MASK);
    const initial = await call('GET', '/api/cms/sites/2/effective-config');
    const config = initial.body.data as {
      resolved: { title: string; webhookSecret: string };
      sources: Record<string, { kind: string; siteId: number }>;
    };
    expect(config.resolved.title).toBe('Zenith 技术中心');
    expect(config.resolved.webhookSecret).toBe(CMS_SECRET_MASK);
    expect(config.sources.webhook).toMatchObject({ kind: 'inherited', siteId: 1 });

    await call('PUT', '/api/cms/sites/2/inheritance', { seoTitle: true });
    const inherited = await call('GET', '/api/cms/sites/2/effective-config');
    expect((inherited.body.data as typeof config).resolved.title).toContain('Zenith Admin');

    await call('PUT', '/api/cms/sites/2/inheritance', { seoTitle: false });
    const restored = await call('GET', '/api/cms/sites/2/effective-config');
    expect((restored.body.data as typeof config).resolved.title).toBe('Zenith 技术中心');
  });

  it('uses the shared child-parent-global template catalog with child overrides first', async () => {
    const response = await call('GET', '/api/cms/sites/themes/default/templates?siteId=2');
    const catalog = response.body.data as {
      list: Array<{ name: string; source: string }>;
      detail: Array<{ name: string; source: string }>;
    };
    expect(catalog.list.find((item) => item.name === 'list-editorial')?.source).toBe('inherited');
    expect(catalog.detail.find((item) => item.name === 'detail-editorial')?.source).toBe('own');
  });

  it('serves inherited package assets through the child site scope only when the parent deployment is active', async () => {
    const pkg = mockCmsThemePackages[0]!;
    pkg.manifest.assets = ['assets/site.css'];
    pkg.activeSiteIds = [1];
    mockCmsSites[0].theme = pkg.code;
    mockCmsSites[1].inheritance = { ...mockCmsSites[1].inheritance!, theme: true };
    const response = await call('GET', `/api/public/cms/theme-assets/2/${pkg.code}/${pkg.version}/assets/site.css`);
    expect(response.status).toBe(200);
  });

  it('reports lock conflicts, enforces idempotency and excludes drafts', async () => {
    const source = mockCmsContents.find((content) => content.id === 1)!;
    const target = mockCmsContents.find((content) => content.id === 6)!;
    source.version += 1;
    target.lockedAt = '2026-07-24 07:00:00';
    target.lockReason = '法务冻结';
    const first = await call('POST', '/api/cms/distributions/1/run');
    const run = first.body.data as CmsDistributionRunShape;
    const detail = await call('GET', `/api/cms/distributions/runs/${run.id}`);
    const items = (detail.body.data as { items: Array<{ data: { outcome: string }; message: string }> }).items;
    expect(items[0]).toMatchObject({ data: { outcome: 'conflict' } });
    expect(items[0].message).toContain('锁定');

    const duplicate = await call('POST', '/api/cms/distributions/1/run');
    expect((duplicate.body.data as CmsDistributionRunShape).id).toBe(run.id);
    expect(mockCmsContents.some((content) => content.status === 'draft' && content.distributionSourceId !== null)).toBe(true);
  });

  it('sanitizes copied HTML and creates only a target draft through a governed rule', async () => {
    const source = mockCmsContents.find((content) => content.id === 1)!;
    source.body = '<p onclick="alert(1)">safe</p><script>alert(2)</script>';
    source.version += 2;
    const created = await call('POST', '/api/cms/distributions', {
      name: '安全复制演示',
      sourceSiteId: 1,
      sourceChannelId: 1,
      targetSiteId: 2,
      targetChannelId: 4,
      mode: 'copy',
      conflictStrategy: 'create-new',
      filters: {
        statuses: ['published'],
        contentTypes: ['article'],
        keyword: 'Zenith',
        publishedFrom: null,
        publishedTo: null,
      },
      scheduleCron: null,
      status: 'enabled',
    });
    const ruleId = (created.body.data as { id: number }).id;
    await call('POST', `/api/cms/distributions/${ruleId}/run`);
    const target = mockCmsContents.find((content) =>
      content.distributionRuleId === ruleId && content.distributionSourceId === source.id);
    expect(target?.status).toBe('draft');
    expect(target?.body).toContain('<p>safe</p>');
    expect(target?.body).not.toMatch(/script|onclick/i);
  });

  it('refuses to delete a locked mapping rule and otherwise materializes the last body snapshot', async () => {
    const target = mockCmsContents.find((content) => content.id === 6)!;
    target.lockedAt = '2026-07-24 08:00:00';
    expect((await call('DELETE', '/api/cms/distributions/1')).status).toBe(423);
    target.lockedAt = null;
    expect((await call('DELETE', '/api/cms/distributions/1')).status).toBe(200);
    expect(target.distributionRuleId).toBeNull();
    expect(target.mappingSourceId).toBeNull();
    expect(target.body).toContain('Zenith Admin 全新 CMS 模块');
  });

  it('submits one fenced publishing task per enabled site in a group', async () => {
    const response = await call('POST', '/api/cms/publishing/group-submit', { rootSiteId: 1 });
    const result = response.body.data as { targetSiteIds: number[]; tasks: Array<{ taskType: string }> };
    expect(result.targetSiteIds).toEqual([1, 2]);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.every((task) => task.taskType === 'cms-publish-build')).toBe(true);
  });
});

interface CmsDistributionRunShape {
  id: number;
}
