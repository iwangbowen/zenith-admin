import { afterEach, describe, expect, it } from 'vitest';
import {
  mockCmsContents, mockCmsForms, mockCmsHotwordGroups, mockCmsHotKeywords,
  mockCmsResourceFolders, mockCmsResources, mockCmsSearchWords,
} from '@/mocks/data/cms';
import { cmsHandlers, cmsP2Handlers, cmsP3Handlers, cmsP6Handlers } from '@/mocks/handlers/cms';

const handlers = [...cmsHandlers, ...cmsP2Handlers, ...cmsP3Handlers, ...cmsP6Handlers];
const snapshots = {
  contents: structuredClone(mockCmsContents),
  forms: structuredClone(mockCmsForms),
  groups: structuredClone(mockCmsHotwordGroups),
  hotwords: structuredClone(mockCmsHotKeywords),
  folders: structuredClone(mockCmsResourceFolders),
  resources: structuredClone(mockCmsResources),
  words: structuredClone(mockCmsSearchWords),
};

afterEach(() => {
  mockCmsContents.splice(0, mockCmsContents.length, ...structuredClone(snapshots.contents));
  mockCmsForms.splice(0, mockCmsForms.length, ...structuredClone(snapshots.forms));
  mockCmsHotwordGroups.splice(0, mockCmsHotwordGroups.length, ...structuredClone(snapshots.groups));
  mockCmsHotKeywords.splice(0, mockCmsHotKeywords.length, ...structuredClone(snapshots.hotwords));
  mockCmsResourceFolders.splice(0, mockCmsResourceFolders.length, ...structuredClone(snapshots.folders));
  mockCmsResources.splice(0, mockCmsResources.length, ...structuredClone(snapshots.resources));
  mockCmsSearchWords.splice(0, mockCmsSearchWords.length, ...structuredClone(snapshots.words));
});

async function call(method: string, path: string, body?: unknown) {
  for (const handler of handlers) {
    const request = new Request(`${window.location.origin}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await (handler as unknown as {
      run(args: unknown): Promise<{ response?: Response } | null>;
    }).run({ request, requestId: `cms-stage2-${Math.random()}` });
    if (result?.response) return { status: result.response.status, body: await result.response.json() };
  }
  throw new Error(`No handler matched ${method} ${path}`);
}

describe('CMS Stage 2 MSW handlers', () => {
  it('locks content, blocks mutation, then unlocks it', async () => {
    const locked = await call('POST', '/api/cms/contents/1/lock', { reason: '合规审查' });
    expect(locked.status).toBe(200);
    expect(mockCmsContents.find((item) => item.id === 1)?.scheduledAt).toBeNull();
    const denied = await call('PUT', '/api/cms/contents/1', { title: '不可修改' });
    expect(denied.status).toBe(423);
    await call('POST', '/api/cms/contents/1/unlock', {});
    expect((await call('PUT', '/api/cms/contents/1', { title: '允许修改' })).status).toBe(200);
  });

  it('manages resource folders and submits governance tasks', async () => {
    const created = await call('POST', '/api/cms/resources/folders', {
      siteId: 1, parentId: null, name: '治理测试', sort: 3,
    });
    expect(created.status).toBe(200);
    const folderId = (created.body as { data: { id: number } }).data.id;
    const task = await call('POST', '/api/cms/resources/governance', {
      siteId: 1, operation: 'scan', dryRun: true,
    });
    expect((task.body as { data: { taskType: string } }).data.taskType).toBe('cms-resource-governance');
    expect((await call('GET', '/api/cms/resources/folders?siteId=1')).status).toBe(200);
    await call('DELETE', `/api/cms/resources/folders/${folderId}`);
  });

  it('supports site dictionary types, hotword groups and masked form secrets', async () => {
    const word = await call('POST', '/api/cms/search/words', {
      siteId: 1, word: '停用演示', type: 'stop', groupName: '测试', weight: 1, status: 'enabled',
    });
    expect((word.body as { data: { type: string } }).data.type).toBe('stop');
    expect((await call('POST', '/api/cms/search/words', {
      siteId: 1, word: 'Bad Word', type: 'extension', groupName: '测试', weight: 1000, status: 'enabled',
    })).status).toBe(400);
    const group = await call('POST', '/api/cms/search/hotword-groups', {
      siteId: 1, name: '新分组', sort: 3, status: 'enabled',
    });
    expect(group.status).toBe(200);
    const form = await call('POST', '/api/cms/forms', {
      siteId: 1, code: 'secure-form', name: '安全表单',
      fields: [{ name: 'email', label: '邮箱', fieldType: 'email', required: true }],
      captchaProvider: 'turnstile', turnstileSiteKey: 'site', turnstileSecret: 'secret',
    });
    expect((form.body as { data: { turnstileSecret: string } }).data.turnstileSecret).toBe('********');
    const unsafe = await call('POST', '/api/cms/forms', {
      siteId: 1, code: 'unsafe-pattern', name: '危险规则',
      fields: [{ name: 'value', label: '值', fieldType: 'text', pattern: 'bad\npattern' }],
      captchaProvider: 'none',
    });
    expect(unsafe.status).toBe(400);
  });
});
