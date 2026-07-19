import { http, HttpResponse } from 'msw';
import type { CmsChannel, CmsContent, CmsContentStatus, CmsModelField } from '@zenith/shared';
import {
  mockCmsSites, mockCmsModels, mockCmsChannels, mockCmsContents, mockCmsTags,
  mockCmsFragments, mockCmsFriendLinks, buildMockChannelTree,
  getNextCmsSiteId, getNextCmsModelId, getNextCmsModelFieldId, getNextCmsChannelId,
  getNextCmsContentId, getNextCmsTagId, getNextCmsFragmentId, getNextCmsFriendLinkId,
} from '../data/cms';
import { createProgressingMockTask } from './async-tasks';
import { mockDateTime } from '../utils/date';

type Body = Record<string, unknown>;

function okJson<T>(data: T, message = 'ok') {
  return HttpResponse.json({ code: 0, message, data });
}

function notFound(message: string) {
  return HttpResponse.json({ code: 404, message, data: null }, { status: 404 });
}

function paginate<T>(list: T[], page: number, pageSize: number) {
  return { list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize };
}

function pageParams(request: Request) {
  const url = new URL(request.url);
  return {
    url,
    page: Number(url.searchParams.get('page')) || 1,
    pageSize: Number(url.searchParams.get('pageSize')) || 10,
    keyword: url.searchParams.get('keyword') || '',
  };
}

function channelPath(channelId: number): string {
  return mockCmsChannels.find((c) => c.id === channelId)?.path ?? '';
}

export const cmsHandlers = [
  // ═══ 站点 ═══════════════════════════════════════════════════════════════
  http.get('/api/cms/sites/all', () => okJson(mockCmsSites.filter((s) => s.status === 'enabled'))),
  http.get('/api/cms/sites/themes', () => okJson([{ code: 'default', label: '默认主题' }])),
  http.get('/api/cms/sites', ({ request }) => {
    const { url, page, pageSize, keyword } = pageParams(request);
    const status = url.searchParams.get('status') || '';
    let list = [...mockCmsSites];
    if (keyword) list = list.filter((s) => s.name.includes(keyword) || s.code.includes(keyword) || (s.domain ?? '').includes(keyword));
    if (status) list = list.filter((s) => s.status === status);
    return okJson(paginate(list, page, pageSize));
  }),
  http.get('/api/cms/sites/:id', ({ params }) => {
    const site = mockCmsSites.find((s) => s.id === Number(params.id));
    return site ? okJson(site) : notFound('站点不存在');
  }),
  http.post('/api/cms/sites', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    if (body.isDefault) mockCmsSites.forEach((s) => { s.isDefault = false; });
    const site = {
      id: getNextCmsSiteId(),
      name: String(body.name ?? ''),
      code: String(body.code ?? ''),
      domain: (body.domain as string) ?? null,
      aliasDomains: (body.aliasDomains as string[]) ?? [],
      isDefault: Boolean(body.isDefault),
      title: (body.title as string) ?? null,
      keywords: (body.keywords as string) ?? null,
      description: (body.description as string) ?? null,
      logo: null,
      favicon: null,
      icp: (body.icp as string) ?? null,
      copyright: (body.copyright as string) ?? null,
      theme: String(body.theme ?? 'default'),
      staticMode: (body.staticMode as 'dynamic' | 'hybrid' | 'static') ?? 'hybrid',
      robots: (body.robots as string) ?? null,
      settings: {},
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      sort: Number(body.sort ?? 0),
      remark: (body.remark as string) ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsSites.push(site);
    return okJson(site, '创建成功');
  }),
  http.put('/api/cms/sites/:id', async ({ params, request }) => {
    const idx = mockCmsSites.findIndex((s) => s.id === Number(params.id));
    if (idx === -1) return notFound('站点不存在');
    const body = (await request.json()) as Body;
    if (body.isDefault) mockCmsSites.forEach((s) => { s.isDefault = false; });
    Object.assign(mockCmsSites[idx], body, { updatedAt: mockDateTime() });
    return okJson(mockCmsSites[idx], '更新成功');
  }),
  http.delete('/api/cms/sites/:id', ({ params }) => {
    const id = Number(params.id);
    if (mockCmsChannels.some((c) => c.siteId === id)) {
      return HttpResponse.json({ code: 400, message: '该站点下存在栏目，请先删除栏目', data: null }, { status: 400 });
    }
    const idx = mockCmsSites.findIndex((s) => s.id === id);
    if (idx === -1) return notFound('站点不存在');
    mockCmsSites.splice(idx, 1);
    return okJson(null, '删除成功');
  }),

  // ═══ 模型 ═══════════════════════════════════════════════════════════════
  http.get('/api/cms/models/all', () => okJson(mockCmsModels.filter((m) => m.status === 'enabled'))),
  http.get('/api/cms/models', ({ request }) => {
    const { page, pageSize, keyword } = pageParams(request);
    let list = [...mockCmsModels];
    if (keyword) list = list.filter((m) => m.name.includes(keyword) || m.code.includes(keyword));
    return okJson(paginate(list, page, pageSize));
  }),
  http.get('/api/cms/models/:id', ({ params }) => {
    const model = mockCmsModels.find((m) => m.id === Number(params.id));
    return model ? okJson(model) : notFound('内容模型不存在');
  }),
  http.post('/api/cms/models', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const modelId = getNextCmsModelId();
    const fields = ((body.fields as Body[]) ?? []).map((f, i) => ({
      id: getNextCmsModelFieldId(),
      modelId,
      name: String(f.name ?? ''),
      label: String(f.label ?? ''),
      fieldType: (f.fieldType as CmsModelField['fieldType']) ?? 'text',
      required: Boolean(f.required),
      searchable: Boolean(f.searchable),
      showInList: Boolean(f.showInList),
      placeholder: (f.placeholder as string) ?? null,
      defaultValue: null,
      options: (f.options as { label: string; value: string }[]) ?? null,
      sort: i,
      createdAt: now,
      updatedAt: now,
    }));
    const model = {
      id: modelId,
      name: String(body.name ?? ''),
      code: String(body.code ?? ''),
      description: (body.description as string) ?? null,
      isSystem: false,
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      sort: 0,
      fields,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsModels.push(model);
    return okJson(model, '创建成功');
  }),
  http.put('/api/cms/models/:id', async ({ params, request }) => {
    const idx = mockCmsModels.findIndex((m) => m.id === Number(params.id));
    if (idx === -1) return notFound('内容模型不存在');
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const { fields, ...rest } = body;
    Object.assign(mockCmsModels[idx], rest, { updatedAt: now });
    if (fields) {
      mockCmsModels[idx].fields = (fields as Body[]).map((f, i) => ({
        id: getNextCmsModelFieldId(),
        modelId: mockCmsModels[idx].id,
        name: String(f.name ?? ''),
        label: String(f.label ?? ''),
        fieldType: (f.fieldType as CmsModelField['fieldType']) ?? 'text',
        required: Boolean(f.required),
        searchable: Boolean(f.searchable),
        showInList: Boolean(f.showInList),
        placeholder: (f.placeholder as string) ?? null,
        defaultValue: null,
        options: (f.options as { label: string; value: string }[]) ?? null,
        sort: i,
        createdAt: now,
        updatedAt: now,
      }));
    }
    return okJson(mockCmsModels[idx], '更新成功');
  }),
  http.delete('/api/cms/models/:id', ({ params }) => {
    const id = Number(params.id);
    const model = mockCmsModels.find((m) => m.id === id);
    if (!model) return notFound('内容模型不存在');
    if (model.isSystem) {
      return HttpResponse.json({ code: 400, message: '系统内置模型不可删除', data: null }, { status: 400 });
    }
    mockCmsModels.splice(mockCmsModels.indexOf(model), 1);
    return okJson(null, '删除成功');
  }),

  // ═══ 栏目 ═══════════════════════════════════════════════════════════════
  http.get('/api/cms/channels/tree', ({ request }) => {
    const url = new URL(request.url);
    const siteId = Number(url.searchParams.get('siteId'));
    const list = mockCmsChannels
      .filter((c) => c.siteId === siteId)
      .map((c) => ({ ...c, modelName: mockCmsModels.find((m) => m.id === c.modelId)?.name ?? null }));
    return okJson(buildMockChannelTree(list));
  }),
  http.get('/api/cms/channels/:id', ({ params }) => {
    const channel = mockCmsChannels.find((c) => c.id === Number(params.id));
    return channel ? okJson(channel) : notFound('栏目不存在');
  }),
  http.post('/api/cms/channels', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const parentId = Number(body.parentId ?? 0);
    const parent = mockCmsChannels.find((c) => c.id === parentId);
    const slug = String(body.slug ?? '');
    const channel: CmsChannel = {
      id: getNextCmsChannelId(),
      siteId: Number(body.siteId),
      parentId,
      modelId: (body.modelId as number) ?? null,
      name: String(body.name ?? ''),
      slug,
      path: parent ? `${parent.path}/${slug}` : slug,
      type: (body.type as CmsChannel['type']) ?? 'list',
      linkUrl: (body.linkUrl as string) ?? null,
      listTemplate: null,
      detailTemplate: null,
      pageSize: Number(body.pageSize ?? 20),
      pageContent: (body.pageContent as string) ?? null,
      seoTitle: (body.seoTitle as string) ?? null,
      seoKeywords: (body.seoKeywords as string) ?? null,
      seoDescription: (body.seoDescription as string) ?? null,
      image: null,
      visible: body.visible === undefined ? true : Boolean(body.visible),
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      sort: Number(body.sort ?? 0),
      settings: {},
      createdAt: now,
      updatedAt: now,
    };
    mockCmsChannels.push(channel);
    return okJson(channel, '创建成功');
  }),
  http.put('/api/cms/channels/:id', async ({ params, request }) => {
    const idx = mockCmsChannels.findIndex((c) => c.id === Number(params.id));
    if (idx === -1) return notFound('栏目不存在');
    const body = (await request.json()) as Body;
    Object.assign(mockCmsChannels[idx], body, { updatedAt: mockDateTime() });
    const parent = mockCmsChannels.find((c) => c.id === mockCmsChannels[idx].parentId);
    mockCmsChannels[idx].path = parent ? `${parent.path}/${mockCmsChannels[idx].slug}` : mockCmsChannels[idx].slug;
    return okJson(mockCmsChannels[idx], '更新成功');
  }),
  http.delete('/api/cms/channels/:id', ({ params }) => {
    const id = Number(params.id);
    if (mockCmsChannels.some((c) => c.parentId === id)) {
      return HttpResponse.json({ code: 400, message: '存在子栏目，请先删除子栏目', data: null }, { status: 400 });
    }
    if (mockCmsContents.some((c) => c.channelId === id)) {
      return HttpResponse.json({ code: 400, message: '栏目下存在内容，请先移除内容', data: null }, { status: 400 });
    }
    const idx = mockCmsChannels.findIndex((c) => c.id === id);
    if (idx === -1) return notFound('栏目不存在');
    mockCmsChannels.splice(idx, 1);
    return okJson(null, '删除成功');
  }),

  // ═══ 内容 ═══════════════════════════════════════════════════════════════
  http.get('/api/cms/contents', ({ request }) => {
    const { url, page, pageSize, keyword } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    const channelId = url.searchParams.get('channelId');
    const status = url.searchParams.get('status') || '';
    const deleted = url.searchParams.get('deleted') === 'true';
    let list = mockCmsContents.filter((c) => c.siteId === siteId && (deleted ? c.status === 'offline' && (c as { deleted?: boolean }).deleted : !(c as { deleted?: boolean }).deleted));
    if (channelId) list = list.filter((c) => c.channelId === Number(channelId));
    if (status) list = list.filter((c) => c.status === status);
    if (keyword) list = list.filter((c) => c.title.includes(keyword) || (c.author ?? '').includes(keyword));
    list = [...list].sort((a, b) => Number(b.isTop) - Number(a.isTop) || b.id - a.id);
    return okJson(paginate(list.map((c) => ({ ...c, channelName: mockCmsChannels.find((ch) => ch.id === c.channelId)?.name ?? null })), page, pageSize));
  }),
  http.get('/api/cms/contents/:id', ({ params }) => {
    const content = mockCmsContents.find((c) => c.id === Number(params.id));
    if (!content) return notFound('内容不存在');
    return okJson({
      ...content,
      channelName: mockCmsChannels.find((ch) => ch.id === content.channelId)?.name ?? null,
      tags: mockCmsTags.filter((t) => content.tagIds.includes(t.id)),
    });
  }),
  http.post('/api/cms/contents/recycle', async ({ request }) => {
    const { ids } = (await request.json()) as { ids: number[] };
    for (const c of mockCmsContents) {
      if (ids.includes(c.id)) {
        (c as { deleted?: boolean }).deleted = true;
        c.status = 'offline';
      }
    }
    return okJson(null, `已移入回收站 ${ids.length} 条`);
  }),
  http.post('/api/cms/contents/restore', async ({ request }) => {
    const { ids } = (await request.json()) as { ids: number[] };
    for (const c of mockCmsContents) {
      if (ids.includes(c.id)) {
        (c as { deleted?: boolean }).deleted = false;
        c.status = 'draft';
      }
    }
    return okJson(null, `已恢复 ${ids.length} 条`);
  }),
  http.post('/api/cms/contents/purge', async ({ request }) => {
    const { ids } = (await request.json()) as { ids: number[] };
    for (const id of ids) {
      const idx = mockCmsContents.findIndex((c) => c.id === id);
      if (idx >= 0) mockCmsContents.splice(idx, 1);
    }
    return okJson(null, '已彻底删除');
  }),
  http.post('/api/cms/contents/:id/:action', ({ params }) => {
    const content = mockCmsContents.find((c) => c.id === Number(params.id));
    if (!content) return notFound('内容不存在');
    const action = String(params.action);
    const statusMap: Record<string, CmsContentStatus> = {
      submit: 'pending', publish: 'published', reject: 'rejected', offline: 'offline',
    };
    if (statusMap[action]) {
      content.status = statusMap[action];
      if (action === 'publish') content.publishedAt = mockDateTime();
      content.updatedAt = mockDateTime();
    }
    return okJson(content, '操作成功');
  }),
  http.post('/api/cms/contents', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const content: CmsContent & { tagIds: number[] } = {
      id: getNextCmsContentId(),
      siteId: Number(body.siteId),
      channelId: Number(body.channelId),
      modelId: mockCmsChannels.find((c) => c.id === Number(body.channelId))?.modelId ?? null,
      title: String(body.title ?? ''),
      slug: (body.slug as string) ?? null,
      summary: (body.summary as string) ?? null,
      coverImage: (body.coverImage as string) ?? null,
      author: (body.author as string) ?? null,
      source: (body.source as string) ?? null,
      body: (body.body as string) ?? null,
      extend: (body.extend as Record<string, unknown>) ?? {},
      externalLink: (body.externalLink as string) ?? null,
      isTop: Boolean(body.isTop),
      isRecommend: Boolean(body.isRecommend),
      isHot: Boolean(body.isHot),
      status: 'draft',
      rejectReason: null,
      publishedAt: null,
      scheduledAt: null,
      viewCount: 0,
      sort: Number(body.sort ?? 0),
      seoTitle: (body.seoTitle as string) ?? null,
      seoKeywords: (body.seoKeywords as string) ?? null,
      seoDescription: (body.seoDescription as string) ?? null,
      tagIds: (body.tagIds as number[]) ?? [],
      createdAt: now,
      updatedAt: now,
    };
    mockCmsContents.push(content);
    return okJson(content, '创建成功');
  }),
  http.put('/api/cms/contents/:id', async ({ params, request }) => {
    const idx = mockCmsContents.findIndex((c) => c.id === Number(params.id));
    if (idx === -1) return notFound('内容不存在');
    const body = (await request.json()) as Body;
    Object.assign(mockCmsContents[idx], body, { updatedAt: mockDateTime() });
    return okJson(mockCmsContents[idx], '更新成功');
  }),

  // ═══ 标签 ═══════════════════════════════════════════════════════════════
  http.get('/api/cms/tags/all', ({ request }) => {
    const siteId = Number(new URL(request.url).searchParams.get('siteId'));
    return okJson(mockCmsTags.filter((t) => t.siteId === siteId));
  }),
  http.get('/api/cms/tags', ({ request }) => {
    const { url, page, pageSize, keyword } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    let list = mockCmsTags.filter((t) => t.siteId === siteId);
    if (keyword) list = list.filter((t) => t.name.includes(keyword) || t.slug.includes(keyword));
    return okJson(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/tags', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const tag = {
      id: getNextCmsTagId(),
      siteId: Number(body.siteId),
      name: String(body.name ?? ''),
      slug: String(body.slug ?? ''),
      contentCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsTags.push(tag);
    return okJson(tag, '创建成功');
  }),
  http.put('/api/cms/tags/:id', async ({ params, request }) => {
    const idx = mockCmsTags.findIndex((t) => t.id === Number(params.id));
    if (idx === -1) return notFound('标签不存在');
    Object.assign(mockCmsTags[idx], await request.json(), { updatedAt: mockDateTime() });
    return okJson(mockCmsTags[idx], '更新成功');
  }),
  http.delete('/api/cms/tags/:id', ({ params }) => {
    const idx = mockCmsTags.findIndex((t) => t.id === Number(params.id));
    if (idx === -1) return notFound('标签不存在');
    mockCmsTags.splice(idx, 1);
    return okJson(null, '删除成功');
  }),

  // ═══ 碎片 ═══════════════════════════════════════════════════════════════
  http.get('/api/cms/fragments', ({ request }) => {
    const { url, page, pageSize, keyword } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    let list = mockCmsFragments.filter((f) => f.siteId === siteId);
    if (keyword) list = list.filter((f) => f.name.includes(keyword) || f.code.includes(keyword));
    return okJson(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/fragments', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const fragment = {
      id: getNextCmsFragmentId(),
      siteId: Number(body.siteId),
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      type: (body.type as 'html' | 'text' | 'image' | 'json') ?? 'html',
      content: (body.content as string) ?? null,
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      remark: (body.remark as string) ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsFragments.push(fragment);
    return okJson(fragment, '创建成功');
  }),
  http.put('/api/cms/fragments/:id', async ({ params, request }) => {
    const idx = mockCmsFragments.findIndex((f) => f.id === Number(params.id));
    if (idx === -1) return notFound('碎片不存在');
    Object.assign(mockCmsFragments[idx], await request.json(), { updatedAt: mockDateTime() });
    return okJson(mockCmsFragments[idx], '更新成功');
  }),
  http.delete('/api/cms/fragments/:id', ({ params }) => {
    const idx = mockCmsFragments.findIndex((f) => f.id === Number(params.id));
    if (idx === -1) return notFound('碎片不存在');
    mockCmsFragments.splice(idx, 1);
    return okJson(null, '删除成功');
  }),

  // ═══ 友情链接 ═══════════════════════════════════════════════════════════
  http.get('/api/cms/friend-links', ({ request }) => {
    const { url, page, pageSize, keyword } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    let list = mockCmsFriendLinks.filter((l) => l.siteId === siteId);
    if (keyword) list = list.filter((l) => l.name.includes(keyword));
    return okJson(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/friend-links', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const link = {
      id: getNextCmsFriendLinkId(),
      siteId: Number(body.siteId),
      name: String(body.name ?? ''),
      url: String(body.url ?? ''),
      logo: (body.logo as string) ?? null,
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      sort: Number(body.sort ?? 0),
      remark: (body.remark as string) ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsFriendLinks.push(link);
    return okJson(link, '创建成功');
  }),
  http.put('/api/cms/friend-links/:id', async ({ params, request }) => {
    const idx = mockCmsFriendLinks.findIndex((l) => l.id === Number(params.id));
    if (idx === -1) return notFound('友情链接不存在');
    Object.assign(mockCmsFriendLinks[idx], await request.json(), { updatedAt: mockDateTime() });
    return okJson(mockCmsFriendLinks[idx], '更新成功');
  }),
  http.delete('/api/cms/friend-links/:id', ({ params }) => {
    const idx = mockCmsFriendLinks.findIndex((l) => l.id === Number(params.id));
    if (idx === -1) return notFound('友情链接不存在');
    mockCmsFriendLinks.splice(idx, 1);
    return okJson(null, '删除成功');
  }),

  // ═══ 静态化 / 索引重建（任务中心模拟）═══════════════════════════════════
  http.post('/api/cms/static/build', async ({ request }) => {
    const { siteId } = (await request.json()) as { siteId: number };
    const site = mockCmsSites.find((s) => s.id === siteId);
    if (!site) return notFound('站点不存在');
    const contentCount = mockCmsContents.filter((c) => c.siteId === siteId).length;
    const task = createProgressingMockTask({
      taskType: 'cms-static-build',
      title: `CMS 全站静态化（${site.name}）`,
      payload: { siteId },
      totalItems: 3 + mockCmsChannels.filter((c) => c.siteId === siteId).length + contentCount,
      itemDelayMs: 400,
    });
    return okJson(task, '任务已提交，可在任务中心查看进度');
  }),
  http.post('/api/cms/search/reindex', async ({ request }) => {
    const { siteId } = (await request.json()) as { siteId: number | null };
    const site = siteId ? mockCmsSites.find((s) => s.id === siteId) : null;
    const task = createProgressingMockTask({
      taskType: 'cms-search-reindex',
      title: site ? `CMS 检索索引重建（${site.name}）` : 'CMS 检索索引重建（全部站点）',
      payload: { siteId },
      totalItems: mockCmsContents.filter((c) => !siteId || c.siteId === siteId).length || 1,
      itemDelayMs: 300,
    });
    return okJson(task, '任务已提交，可在任务中心查看进度');
  }),

  // ═══ 检索 ═══════════════════════════════════════════════════════════════
  http.get('/api/cms/search/test', ({ request }) => {
    const { url, page, pageSize, keyword } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    const kw = keyword || url.searchParams.get('keyword') || '';
    const hits = mockCmsContents
      .filter((c) => c.siteId === siteId && c.status === 'published'
        && (c.title.includes(kw) || (c.summary ?? '').includes(kw) || (c.body ?? '').includes(kw)))
      .map((c, i) => ({
        id: c.id,
        siteId: c.siteId,
        channelId: c.channelId,
        channelName: mockCmsChannels.find((ch) => ch.id === c.channelId)?.name ?? null,
        title: c.title,
        titleHighlight: c.title.replaceAll(kw, `<mark>${kw}</mark>`),
        snippet: (c.summary ?? '').replaceAll(kw, `<mark>${kw}</mark>`),
        url: `/${channelPath(c.channelId)}/${c.slug ?? c.id}.html`,
        publishedAt: c.publishedAt,
        rank: 1 - i * 0.05,
      }));
    return okJson(paginate(hits, page, pageSize));
  }),
  http.get('/api/cms/search/segment', ({ request }) => {
    const text = new URL(request.url).searchParams.get('text') ?? '';
    // Demo 模式简化分词：按 2 字滑窗 + 原词
    const tokens = new Set<string>();
    if (text.length <= 2) tokens.add(text);
    else {
      for (let i = 0; i < text.length - 1; i += 2) tokens.add(text.slice(i, i + 2));
      tokens.add(text);
    }
    return okJson({ tokens: [...tokens].filter(Boolean) });
  }),
];
