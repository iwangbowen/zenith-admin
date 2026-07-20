import { http, HttpResponse } from 'msw';
import type { CmsChannel, CmsContent, CmsContentStatus, CmsModelField, CmsPublishChannel, CmsSurvey } from '@zenith/shared';
import {
  mockCmsSites, mockCmsModels, mockCmsChannels, mockCmsContents, mockCmsTags,
  mockCmsFragments, mockCmsFriendLinks, buildMockChannelTree,
  getNextCmsSiteId, getNextCmsModelId, getNextCmsModelFieldId, getNextCmsChannelId,
  getNextCmsContentId, getNextCmsTagId, getNextCmsFragmentId, getNextCmsFriendLinkId,
  mockCmsAdSlots, mockCmsAds, mockCmsForms, mockCmsFormSubmissions, mockCmsSensitiveWords,
  mockCmsErrorProneWords, mockCmsContentOpLogs, mockCmsLinkWords, mockCmsComments, mockCmsRedirects, mockCmsPushLogs, mockCmsContentVersions,
  getNextCmsAdSlotId, getNextCmsAdId, getNextCmsFormId, getNextCmsSensitiveWordId,
  getNextCmsErrorProneWordId, getNextCmsContentOpLogId, getNextCmsLinkWordId, getNextCmsRedirectId,
  mockCmsSearchWords, mockCmsHotKeywords, getNextCmsSearchWordId,
  mockCmsPublishChannels, getNextCmsPublishChannelId,
  mockCmsSurveys, getNextCmsSurveyId,
} from '../data/cms';
import { createProgressingMockTask } from './async-tasks';
import { mockDateTime, mockDate } from '../utils/date';

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
  // 主题可选模板清单（与 packages/server/src/cms/themes/default 注册的变体保持一致）
  http.get('/api/cms/sites/themes/:code/templates', () => okJson({
    list: [
      { name: 'list-card', label: '卡片网格（产品/案例）' },
      { name: 'list-compact', label: '紧凑标题（公告/文件）' },
    ],
    detail: [
      { name: 'detail-plain', label: '简洁正文（公告/政策）' },
    ],
  })),
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

  // ═══ 发布通道 ═══════════════════════════════════════════════════════════
  http.get('/api/cms/publish-channels', ({ request }) => {
    const url = new URL(request.url);
    const siteId = Number(url.searchParams.get('siteId')) || 0;
    return okJson(mockCmsPublishChannels.filter((c) => c.siteId === siteId));
  }),
  http.post('/api/cms/publish-channels', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const siteId = Number(body.siteId);
    if (body.isDefault) mockCmsPublishChannels.forEach((c) => { if (c.siteId === siteId) c.isDefault = false; });
    const channel: CmsPublishChannel = {
      id: getNextCmsPublishChannelId(),
      siteId,
      name: String(body.name ?? ''),
      code: String(body.code ?? ''),
      domain: (body.domain as string) ?? null,
      uaRegex: (body.uaRegex as string) ?? null,
      isDefault: body.isDefault === true,
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      sort: Number(body.sort ?? 0),
      remark: (body.remark as string) ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsPublishChannels.push(channel);
    return okJson(channel, '创建成功');
  }),
  http.put('/api/cms/publish-channels/:id', async ({ params, request }) => {
    const idx = mockCmsPublishChannels.findIndex((c) => c.id === Number(params.id));
    if (idx === -1) return notFound('发布通道不存在');
    const body = (await request.json()) as Body;
    const current = mockCmsPublishChannels[idx];
    if (current.isDefault && body.isDefault === false) {
      return HttpResponse.json({ code: 400, message: '默认通道不可取消默认，请将其他通道设为默认', data: null }, { status: 400 });
    }
    if (body.isDefault === true && !current.isDefault) {
      mockCmsPublishChannels.forEach((c) => { if (c.siteId === current.siteId) c.isDefault = false; });
    }
    Object.assign(current, body, { updatedAt: mockDateTime() });
    return okJson(current, '更新成功');
  }),
  http.delete('/api/cms/publish-channels/:id', ({ params }) => {
    const idx = mockCmsPublishChannels.findIndex((c) => c.id === Number(params.id));
    if (idx === -1) return notFound('发布通道不存在');
    if (mockCmsPublishChannels[idx].isDefault) {
      return HttpResponse.json({ code: 400, message: '默认通道不可删除', data: null }, { status: 400 });
    }
    mockCmsPublishChannels.splice(idx, 1);
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
      listTemplate: (body.listTemplate as string) ?? null,
      detailTemplate: (body.detailTemplate as string) ?? null,
      pageSize: Number(body.pageSize ?? 20),
      pageContent: (body.pageContent as string) ?? null,
      seoTitle: (body.seoTitle as string) ?? null,
      seoKeywords: (body.seoKeywords as string) ?? null,
      seoDescription: (body.seoDescription as string) ?? null,
      image: null,
      visible: body.visible === undefined ? true : Boolean(body.visible),
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      sort: Number(body.sort ?? 0),
      settings: (body.settings as Record<string, unknown>) ?? {},
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
    const contentType = url.searchParams.get('contentType') || '';
    const deleted = url.searchParams.get('deleted') === 'true';
    const archived = url.searchParams.get('archived') === 'true';
    let list = mockCmsContents.filter((c) => c.siteId === siteId && (deleted ? c.status === 'offline' && (c as { deleted?: boolean }).deleted : !(c as { deleted?: boolean }).deleted));
    if (!deleted) list = list.filter((c) => (archived ? !!c.archivedAt : !c.archivedAt));
    if (channelId) list = list.filter((c) => c.channelId === Number(channelId));
    if (status) list = list.filter((c) => c.status === status);
    if (contentType) list = list.filter((c) => c.contentType === contentType);
    if (keyword) list = list.filter((c) => c.title.includes(keyword) || (c.author ?? '').includes(keyword));
    list = [...list].sort((a, b) => Number(b.isTop) - Number(a.isTop) || (b.topWeight ?? 0) - (a.topWeight ?? 0) || b.id - a.id);
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
  // ─── 归档（P1）────────────────────────────────────────────────────────────
  http.post('/api/cms/contents/archive', async ({ request }) => {
    const { ids } = (await request.json()) as { ids: number[] };
    let count = 0;
    for (const c of mockCmsContents) {
      if (ids.includes(c.id) && (c.status === 'published' || c.status === 'offline') && !c.archivedAt) {
        c.archivedAt = mockDateTime();
        count += 1;
      }
    }
    return okJson(null, `已归档 ${count} 条（仅已发布/已下线内容可归档）`);
  }),
  http.post('/api/cms/contents/unarchive', async ({ request }) => {
    const { ids } = (await request.json()) as { ids: number[] };
    for (const c of mockCmsContents) {
      if (ids.includes(c.id)) c.archivedAt = null;
    }
    return okJson(null, `已取消归档 ${ids.length} 条`);
  }),
  // ─── 词库检查（P1：敏感词 + 易错词命中清单）───────────────────────────────
  http.post('/api/cms/contents/check-text', async ({ request }) => {
    const { text } = (await request.json()) as { text: string };
    const countHits = (word: string) => (word ? (text ?? '').split(word).length - 1 : 0);
    const sensitive = mockCmsSensitiveWords
      .filter((w) => w.status === 'enabled')
      .map((w) => ({ word: w.word, replaceWith: w.replaceWith ?? null, count: countHits(w.word) }))
      .filter((h) => h.count > 0);
    const errorProne = mockCmsErrorProneWords
      .filter((w) => w.status === 'enabled')
      .map((w) => ({ word: w.word, correction: w.correction, count: countHits(w.word) }))
      .filter((h) => h.count > 0);
    return okJson({ sensitive, errorProne });
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
      const opActionMap: Record<string, { action: string; label: string }> = {
        submit: { action: 'submitted', label: '提交审核' },
        publish: { action: 'published', label: '发布' },
        reject: { action: 'rejected', label: '驳回' },
        offline: { action: 'offlined', label: '下线' },
      };
      const op = opActionMap[action];
      if (op) {
        mockCmsContentOpLogs.push({
          id: getNextCmsContentOpLogId(), contentId: content.id, action: op.action, actionLabel: op.label,
          detail: null, operatorId: 1, operatorName: 'admin', createdAt: mockDateTime(),
        });
      }
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
      contentType: (body.contentType as CmsContent['contentType']) ?? 'article',
      mediaData: (body.mediaData as CmsContent['mediaData']) ?? {},
      title: String(body.title ?? ''),
      subTitle: (body.subTitle as string) ?? null,
      shortTitle: (body.shortTitle as string) ?? null,
      slug: (body.slug as string) ?? null,
      summary: (body.summary as string) ?? null,
      coverImage: (body.coverImage as string) ?? null,
      coverThumb: (body.coverThumb as string) ?? null,
      author: (body.author as string) ?? null,
      editor: (body.editor as string) ?? null,
      source: (body.source as string) ?? null,
      sourceUrl: (body.sourceUrl as string) ?? null,
      isOriginal: Boolean(body.isOriginal),
      body: (body.body as string) ?? null,
      extend: (body.extend as Record<string, unknown>) ?? {},
      externalLink: (body.externalLink as string) ?? null,
      detailTemplate: (body.detailTemplate as string) ?? null,
      isTop: Boolean(body.isTop),
      topWeight: Number(body.topWeight ?? 0),
      topExpireAt: (body.topExpireAt as string) ?? null,
      isRecommend: Boolean(body.isRecommend),
      isHot: Boolean(body.isHot),
      status: 'draft',
      rejectReason: null,
      publishedAt: null,
      scheduledAt: null,
      expireAt: (body.expireAt as string) ?? null,
      viewCount: 0,
      likeCount: 0,
      favoriteCount: 0,
      version: 1,
      sort: Number(body.sort ?? 0),
      seoTitle: (body.seoTitle as string) ?? null,
      seoKeywords: (body.seoKeywords as string) ?? null,
      seoDescription: (body.seoDescription as string) ?? null,
      archivedAt: null,
      mappingSourceId: null,
      tagIds: (body.tagIds as number[]) ?? [],
      createdAt: now,
      updatedAt: now,
    };
    mockCmsContents.push(content);
    mockCmsContentOpLogs.push({
      id: getNextCmsContentOpLogId(), contentId: content.id, action: 'created', actionLabel: '创建',
      detail: null, operatorId: 1, operatorName: 'admin', createdAt: now,
    });
    return okJson(content, '创建成功');
  }),
  http.put('/api/cms/contents/:id', async ({ params, request }) => {
    const idx = mockCmsContents.findIndex((c) => c.id === Number(params.id));
    if (idx === -1) return notFound('内容不存在');
    const body = (await request.json()) as Body;
    const { expectedVersion: _expectedVersion, ...rest } = body;
    Object.assign(mockCmsContents[idx], rest, {
      version: (mockCmsContents[idx].version ?? 1) + 1,
      updatedAt: mockDateTime(),
    });
    return okJson(mockCmsContents[idx], '更新成功');
  }),
  // ─── 编辑锁 / 草稿预览（demo 模式恒定成功）───────────────────────────────
  http.post('/api/cms/contents/:id/edit-lock', () => okJson({ acquired: true, holder: null })),
  http.delete('/api/cms/contents/:id/edit-lock', () => okJson(null, '已释放')),
  http.post('/api/cms/contents/:id/preview-link', ({ params }) =>
    okJson({ url: `/__cms/main/preview/${params.id}?exp=0&sig=demo`, expiresAt: mockDateTime() }, 'Demo 模式无前台渲染，链接仅作展示')),
  // ─── 操作日志时间线（P1）─────────────────────────────────────────────────
  http.get('/api/cms/contents/:id/op-logs', ({ params }) =>
    okJson(mockCmsContentOpLogs.filter((l) => l.contentId === Number(params.id)).sort((a, b) => b.id - a.id))),

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
  http.post('/api/cms/contents/import', async ({ request }) => {
    const { siteId, channelId } = (await request.json()) as { fileId: string; siteId: number; channelId: number };
    const site = mockCmsSites.find((s) => s.id === siteId);
    if (!site || !mockCmsChannels.some((c) => c.id === channelId)) return notFound('站点或栏目不存在');
    const task = createProgressingMockTask({
      taskType: 'cms-content-import',
      title: 'CMS 内容批量导入',
      payload: { siteId, channelId },
      totalItems: 8,
      itemDelayMs: 300,
    });
    return okJson(task, '导入任务已提交，可在任务中心查看进度');
  }),

  // ═══ 数据看板 ═════════════════════════════════════════════════════════════
  http.get('/api/cms/dashboard/stats', ({ request }) => {
    const siteId = Number(new URL(request.url).searchParams.get('siteId'));
    const contents = mockCmsContents.filter((c) => c.siteId === siteId && !(c as { deleted?: boolean }).deleted);
    const byStatus = (s: string) => contents.filter((c) => c.status === s).length;
    const today = mockDate();
    const trend = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { date: key, count: key === today ? contents.filter((c) => c.status === 'published').length : (i % 5 === 0 ? 1 : 0) };
    });
    const channelCounts = new Map<number, number>();
    for (const c of contents) channelCounts.set(c.channelId, (channelCounts.get(c.channelId) ?? 0) + 1);
    return okJson({
      totals: {
        published: byStatus('published'),
        draft: byStatus('draft'),
        pending: byStatus('pending'),
        offline: byStatus('offline'),
        rejected: byStatus('rejected'),
        recycled: mockCmsContents.filter((c) => c.siteId === siteId && (c as { deleted?: boolean }).deleted).length,
      },
      pendingComments: mockCmsComments.filter((c) => c.siteId === siteId && c.status === 'pending').length,
      todayPublished: 0,
      totalViews: contents.reduce((sum, c) => sum + c.viewCount, 0),
      publishTrend: trend,
      topViewed: [...contents]
        .filter((c) => c.status === 'published')
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, 10)
        .map((c) => ({ id: c.id, title: c.title, viewCount: c.viewCount, channelName: mockCmsChannels.find((ch) => ch.id === c.channelId)?.name ?? null })),
      channelDistribution: [...channelCounts.entries()]
        .map(([channelId, count]) => ({ channelId, channelName: mockCmsChannels.find((ch) => ch.id === channelId)?.name ?? `栏目 ${channelId}`, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    });
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

// ═══ P2 handlers ══════════════════════════════════════════════════════════════
export const cmsP2Handlers = [
  // ─── 内容版本 ───────────────────────────────────────────────────────────────
  http.get('/api/cms/contents/:id/versions', ({ params }) => {
    return okJson(mockCmsContentVersions.filter((v) => v.contentId === Number(params.id)));
  }),
  http.post('/api/cms/contents/:id/versions/:versionId/restore', ({ params }) => {
    const content = mockCmsContents.find((c) => c.id === Number(params.id));
    if (!content) return notFound('内容不存在');
    return okJson(content, '回滚成功');
  }),
  http.get('/api/cms/contents/:id/versions/:versionId/diff', ({ params }) => {
    const content = mockCmsContents.find((c) => c.id === Number(params.id));
    const version = mockCmsContentVersions.find((v) => v.id === Number(params.versionId));
    if (!content || !version) return notFound('版本不存在');
    const beforeTitle = (version.snapshot as { title?: string }).title ?? version.title;
    if (beforeTitle === content.title) return okJson([]);
    return okJson([{ field: 'title', label: '标题', before: beforeTitle, after: content.title }]);
  }),

  // ─── SEO：重定向 ────────────────────────────────────────────────────────────
  http.get('/api/cms/seo/redirects', ({ request }) => {
    const { url, page, pageSize, keyword } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    let list = mockCmsRedirects.filter((r) => r.siteId === siteId);
    if (keyword) list = list.filter((r) => r.fromPath.includes(keyword));
    return okJson(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/seo/redirects', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const row = {
      id: getNextCmsRedirectId(),
      siteId: Number(body.siteId),
      fromPath: String(body.fromPath ?? ''),
      toUrl: String(body.toUrl ?? ''),
      redirectType: Number(body.redirectType ?? 301),
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      remark: (body.remark as string) ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsRedirects.push(row);
    return okJson(row, '创建成功');
  }),
  http.put('/api/cms/seo/redirects/:id', async ({ params, request }) => {
    const idx = mockCmsRedirects.findIndex((r) => r.id === Number(params.id));
    if (idx === -1) return notFound('重定向规则不存在');
    Object.assign(mockCmsRedirects[idx], await request.json(), { updatedAt: mockDateTime() });
    return okJson(mockCmsRedirects[idx], '更新成功');
  }),
  http.delete('/api/cms/seo/redirects/:id', ({ params }) => {
    const idx = mockCmsRedirects.findIndex((r) => r.id === Number(params.id));
    if (idx === -1) return notFound('重定向规则不存在');
    mockCmsRedirects.splice(idx, 1);
    return okJson(null, '删除成功');
  }),

  // ─── SEO：内链词 ────────────────────────────────────────────────────────────
  http.get('/api/cms/seo/link-words', ({ request }) => {
    const { url, page, pageSize, keyword } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    let list = mockCmsLinkWords.filter((w) => w.siteId === siteId);
    if (keyword) list = list.filter((w) => w.keyword.includes(keyword));
    return okJson(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/seo/link-words', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const row = {
      id: getNextCmsLinkWordId(),
      siteId: Number(body.siteId),
      keyword: String(body.keyword ?? ''),
      url: String(body.url ?? ''),
      maxReplaces: Number(body.maxReplaces ?? 1),
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      createdAt: now,
      updatedAt: now,
    };
    mockCmsLinkWords.push(row);
    return okJson(row, '创建成功');
  }),
  http.put('/api/cms/seo/link-words/:id', async ({ params, request }) => {
    const idx = mockCmsLinkWords.findIndex((w) => w.id === Number(params.id));
    if (idx === -1) return notFound('内链词不存在');
    Object.assign(mockCmsLinkWords[idx], await request.json(), { updatedAt: mockDateTime() });
    return okJson(mockCmsLinkWords[idx], '更新成功');
  }),
  http.delete('/api/cms/seo/link-words/:id', ({ params }) => {
    const idx = mockCmsLinkWords.findIndex((w) => w.id === Number(params.id));
    if (idx === -1) return notFound('内链词不存在');
    mockCmsLinkWords.splice(idx, 1);
    return okJson(null, '删除成功');
  }),

  // ─── SEO：推送 ─────────────────────────────────────────────────────────────
  http.post('/api/cms/seo/push', async ({ request }) => {
    const body = (await request.json()) as { siteId: number; urls: string[] };
    const now = mockDateTime();
    mockCmsPushLogs.unshift({
      id: mockCmsPushLogs.length + 1,
      siteId: body.siteId,
      engine: 'baidu',
      urls: body.urls,
      success: true,
      statusCode: 200,
      response: '{"success":' + body.urls.length + ',"remain":99}',
      createdAt: now,
    });
    return okJson([
      { engine: 'baidu', submitted: true },
      { engine: 'indexnow', submitted: false, reason: 'Demo 模式未配置 IndexNow Key' },
    ], '推送完成');
  }),
  http.get('/api/cms/seo/push-logs', ({ request }) => {
    const { url, page, pageSize } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    return okJson(paginate(mockCmsPushLogs.filter((l) => l.siteId === siteId), page, pageSize));
  }),

  // ─── 评论 ───────────────────────────────────────────────────────────────────
  http.get('/api/cms/comments/pending-count', ({ request }) => {
    const siteId = Number(new URL(request.url).searchParams.get('siteId'));
    return okJson({ count: mockCmsComments.filter((c) => c.siteId === siteId && c.status === 'pending').length });
  }),
  http.get('/api/cms/comments', ({ request }) => {
    const { url, page, pageSize } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    const status = url.searchParams.get('status') || '';
    let list = mockCmsComments.filter((c) => c.siteId === siteId);
    if (status) list = list.filter((c) => c.status === status);
    return okJson(paginate([...list].sort((a, b) => b.id - a.id), page, pageSize));
  }),
  http.post('/api/cms/comments/:action', async ({ params, request }) => {
    const { ids } = (await request.json()) as { ids: number[] };
    const action = String(params.action);
    if (action === 'delete') {
      for (const id of ids) {
        const idx = mockCmsComments.findIndex((c) => c.id === id);
        if (idx >= 0) mockCmsComments.splice(idx, 1);
      }
      return okJson(null, '删除成功');
    }
    const status = action === 'approve' ? 'approved' as const : 'rejected' as const;
    for (const c of mockCmsComments) {
      if (ids.includes(c.id)) c.status = status;
    }
    return okJson(null, '操作成功');
  }),

  // ─── 广告 ───────────────────────────────────────────────────────────────────
  http.get('/api/cms/ads/slots', ({ request }) => {
    const siteId = Number(new URL(request.url).searchParams.get('siteId'));
    return okJson(mockCmsAdSlots.filter((s) => s.siteId === siteId).map((s) => ({
      ...s,
      adCount: mockCmsAds.filter((a) => a.slotId === s.id).length,
    })));
  }),
  http.post('/api/cms/ads/slots', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const row = {
      id: getNextCmsAdSlotId(),
      siteId: Number(body.siteId),
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      remark: (body.remark as string) ?? null,
      adCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsAdSlots.push(row);
    return okJson(row, '创建成功');
  }),
  http.put('/api/cms/ads/slots/:id', async ({ params, request }) => {
    const idx = mockCmsAdSlots.findIndex((s) => s.id === Number(params.id));
    if (idx === -1) return notFound('广告位不存在');
    Object.assign(mockCmsAdSlots[idx], await request.json(), { updatedAt: mockDateTime() });
    return okJson(mockCmsAdSlots[idx], '更新成功');
  }),
  http.delete('/api/cms/ads/slots/:id', ({ params }) => {
    const id = Number(params.id);
    if (mockCmsAds.some((a) => a.slotId === id)) {
      return HttpResponse.json({ code: 400, message: '广告位下存在广告，请先删除广告', data: null }, { status: 400 });
    }
    const idx = mockCmsAdSlots.findIndex((s) => s.id === id);
    if (idx === -1) return notFound('广告位不存在');
    mockCmsAdSlots.splice(idx, 1);
    return okJson(null, '删除成功');
  }),
  http.get('/api/cms/ads', ({ request }) => {
    const { url, page, pageSize } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    const slotId = url.searchParams.get('slotId');
    const siteSlotIds = new Set(mockCmsAdSlots.filter((s) => s.siteId === siteId).map((s) => s.id));
    let list = mockCmsAds.filter((a) => siteSlotIds.has(a.slotId));
    if (slotId) list = list.filter((a) => a.slotId === Number(slotId));
    return okJson(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/ads', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const slot = mockCmsAdSlots.find((s) => s.id === Number(body.slotId));
    const row = {
      id: getNextCmsAdId(),
      slotId: Number(body.slotId),
      slotName: slot?.name ?? null,
      name: String(body.name ?? ''),
      image: (body.image as string) ?? null,
      linkUrl: (body.linkUrl as string) ?? null,
      startAt: (body.startAt as string) ?? null,
      endAt: (body.endAt as string) ?? null,
      clickCount: 0,
      viewCount: 0,
      sort: Number(body.sort ?? 0),
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      createdAt: now,
      updatedAt: now,
    };
    mockCmsAds.push(row);
    return okJson(row, '创建成功');
  }),
  http.put('/api/cms/ads/:id', async ({ params, request }) => {
    const idx = mockCmsAds.findIndex((a) => a.id === Number(params.id));
    if (idx === -1) return notFound('广告不存在');
    Object.assign(mockCmsAds[idx], await request.json(), { updatedAt: mockDateTime() });
    return okJson(mockCmsAds[idx], '更新成功');
  }),
  http.delete('/api/cms/ads/:id', ({ params }) => {
    const idx = mockCmsAds.findIndex((a) => a.id === Number(params.id));
    if (idx === -1) return notFound('广告不存在');
    mockCmsAds.splice(idx, 1);
    return okJson(null, '删除成功');
  }),

  // ─── 表单 ───────────────────────────────────────────────────────────────────
  http.get('/api/cms/forms/:id/submissions', ({ params, request }) => {
    const { page, pageSize } = pageParams(request);
    const list = mockCmsFormSubmissions.filter((s) => s.formId === Number(params.id));
    return okJson(paginate([...list].sort((a, b) => b.id - a.id), page, pageSize));
  }),
  http.post('/api/cms/forms/:id/submissions/delete', async ({ params, request }) => {
    const { ids } = (await request.json()) as { ids: number[] };
    for (const id of ids) {
      const idx = mockCmsFormSubmissions.findIndex((s) => s.formId === Number(params.id) && s.id === id);
      if (idx >= 0) mockCmsFormSubmissions.splice(idx, 1);
    }
    return okJson(null, '删除成功');
  }),
  http.get('/api/cms/forms', ({ request }) => {
    const { url, page, pageSize, keyword } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    let list = mockCmsForms.filter((f) => f.siteId === siteId);
    if (keyword) list = list.filter((f) => f.name.includes(keyword));
    return okJson(paginate(list.map((f) => ({ ...f, submissionCount: mockCmsFormSubmissions.filter((s) => s.formId === f.id).length })), page, pageSize));
  }),
  http.post('/api/cms/forms', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const row = {
      id: getNextCmsFormId(),
      siteId: Number(body.siteId),
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      fields: ((body.fields as Body[]) ?? []).map((f) => ({
        name: String(f.name ?? ''),
        label: String(f.label ?? ''),
        fieldType: String(f.fieldType ?? 'text'),
        required: Boolean(f.required),
        options: (f.options as { label: string; value: string }[]) ?? null,
      })),
      successMessage: (body.successMessage as string) ?? null,
      notifyEmail: (body.notifyEmail as string) ?? null,
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      submissionCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsForms.push(row);
    return okJson(row, '创建成功');
  }),
  http.put('/api/cms/forms/:id', async ({ params, request }) => {
    const idx = mockCmsForms.findIndex((f) => f.id === Number(params.id));
    if (idx === -1) return notFound('表单不存在');
    Object.assign(mockCmsForms[idx], await request.json(), { updatedAt: mockDateTime() });
    return okJson(mockCmsForms[idx], '更新成功');
  }),
  http.delete('/api/cms/forms/:id', ({ params }) => {
    const idx = mockCmsForms.findIndex((f) => f.id === Number(params.id));
    if (idx === -1) return notFound('表单不存在');
    mockCmsForms.splice(idx, 1);
    return okJson(null, '删除成功');
  }),

  // ─── 敏感词 ─────────────────────────────────────────────────────────────────
  http.get('/api/cms/sensitive-words', ({ request }) => {
    const { page, pageSize, keyword } = pageParams(request);
    let list = [...mockCmsSensitiveWords];
    if (keyword) list = list.filter((w) => w.word.includes(keyword));
    return okJson(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/sensitive-words', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const row = {
      id: getNextCmsSensitiveWordId(),
      word: String(body.word ?? ''),
      replaceWith: (body.replaceWith as string) ?? null,
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      createdAt: now,
      updatedAt: now,
    };
    mockCmsSensitiveWords.push(row);
    return okJson(row, '创建成功');
  }),
  http.put('/api/cms/sensitive-words/:id', async ({ params, request }) => {
    const idx = mockCmsSensitiveWords.findIndex((w) => w.id === Number(params.id));
    if (idx === -1) return notFound('敏感词不存在');
    Object.assign(mockCmsSensitiveWords[idx], await request.json(), { updatedAt: mockDateTime() });
    return okJson(mockCmsSensitiveWords[idx], '更新成功');
  }),
  http.delete('/api/cms/sensitive-words/:id', ({ params }) => {
    const idx = mockCmsSensitiveWords.findIndex((w) => w.id === Number(params.id));
    if (idx === -1) return notFound('敏感词不存在');
    mockCmsSensitiveWords.splice(idx, 1);
    return okJson(null, '删除成功');
  }),

  // ═══ 易错词库（P1）═══════════════════════════════════════════════════════
  http.get('/api/cms/error-prone-words', ({ request }) => {
    const { url, page, pageSize, keyword } = pageParams(request);
    const status = url.searchParams.get('status') || '';
    let list = [...mockCmsErrorProneWords];
    if (keyword) list = list.filter((w) => w.word.includes(keyword) || w.correction.includes(keyword));
    if (status) list = list.filter((w) => w.status === status);
    return okJson(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/error-prone-words', async ({ request }) => {
    const body = (await request.json()) as Body;
    if (mockCmsErrorProneWords.some((w) => w.word === body.word)) {
      return HttpResponse.json({ code: 400, message: '该易错词已存在', data: null }, { status: 400 });
    }
    const now = mockDateTime();
    const row = {
      id: getNextCmsErrorProneWordId(),
      word: String(body.word ?? ''),
      correction: String(body.correction ?? ''),
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      remark: (body.remark as string) ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsErrorProneWords.push(row);
    return okJson(row, '创建成功');
  }),
  http.put('/api/cms/error-prone-words/:id', async ({ params, request }) => {
    const idx = mockCmsErrorProneWords.findIndex((w) => w.id === Number(params.id));
    if (idx === -1) return notFound('易错词不存在');
    Object.assign(mockCmsErrorProneWords[idx], await request.json(), { updatedAt: mockDateTime() });
    return okJson(mockCmsErrorProneWords[idx], '更新成功');
  }),
  http.delete('/api/cms/error-prone-words/:id', ({ params }) => {
    const idx = mockCmsErrorProneWords.findIndex((w) => w.id === Number(params.id));
    if (idx === -1) return notFound('易错词不存在');
    mockCmsErrorProneWords.splice(idx, 1);
    return okJson(null, '删除成功');
  }),

  // ═══ 栏目运维（P1：合并 / 清空 / 批量新增）═══════════════════════════════
  http.post('/api/cms/channels/merge', async ({ request }) => {
    const body = (await request.json()) as Body;
    const sourceIds = (body.sourceIds as number[]) ?? [];
    const targetId = Number(body.targetId);
    const target = mockCmsChannels.find((c) => c.id === targetId);
    if (!target) return notFound('目标栏目不存在');
    let moved = 0;
    for (const c of mockCmsContents) {
      if (sourceIds.includes(c.channelId)) {
        c.channelId = targetId;
        moved += 1;
      }
    }
    for (const id of sourceIds) {
      const idx = mockCmsChannels.findIndex((c) => c.id === id);
      if (idx >= 0) mockCmsChannels.splice(idx, 1);
    }
    return okJson(null, `合并完成，已迁移 ${moved} 条内容`);
  }),
  http.post('/api/cms/channels/batch-create', async ({ request }) => {
    const body = (await request.json()) as Body;
    const names = (body.names as string[]) ?? [];
    const parentId = Number(body.parentId ?? 0);
    const parentPath = parentId ? (mockCmsChannels.find((c) => c.id === parentId)?.path ?? '') : '';
    const now = mockDateTime();
    for (const [i, name] of names.entries()) {
      const slug = `channel-${Date.now()}-${i}`;
      mockCmsChannels.push({
        id: getNextCmsChannelId(),
        siteId: Number(body.siteId),
        parentId,
        modelId: null,
        modelName: null,
        name,
        slug,
        path: parentPath ? `${parentPath}/${slug}` : slug,
        type: 'list',
        linkUrl: null,
        listTemplate: null,
        detailTemplate: null,
        pageSize: 20,
        pageContent: null,
        seoTitle: null,
        seoKeywords: null,
        seoDescription: null,
        image: null,
        visible: true,
        status: 'enabled',
        sort: 0,
        settings: {},
        createdAt: now,
        updatedAt: now,
      });
    }
    return okJson(null, `已创建 ${names.length} 个栏目`);
  }),
  http.post('/api/cms/channels/:id/clear', ({ params }) => {
    const channelId = Number(params.id);
    let count = 0;
    for (const c of mockCmsContents) {
      if (c.channelId === channelId && !(c as { deleted?: boolean }).deleted) {
        (c as { deleted?: boolean }).deleted = true;
        c.status = 'offline';
        count += 1;
      }
    }
    return okJson(null, `已将 ${count} 条内容移入回收站`);
  }),

  // ═══ 问卷调查（P3）═══════════════════════════════════════════════════════
  http.get('/api/cms/surveys', ({ request }) => {
    const { url, page, pageSize, keyword } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    let list = mockCmsSurveys.filter((s) => s.siteId === siteId);
    if (keyword) list = list.filter((s) => s.title.includes(keyword));
    return okJson(paginate(list, page, pageSize));
  }),
  http.get('/api/cms/surveys/:id/stats', ({ params }) => {
    const survey = mockCmsSurveys.find((s) => s.id === Number(params.id));
    if (!survey) return notFound('问卷不存在');
    return okJson({
      surveyId: survey.id,
      answerCount: 42,
      questions: (survey.questions ?? []).map((q) => ({
        id: q.id,
        label: q.label,
        type: q.type,
        options: q.type === 'text' ? [] : q.options.map((o, i) => ({
          label: o.label, value: o.value,
          count: Math.max(0, 20 - i * 6),
          percent: Math.max(0, Math.round((20 - i * 6) / 42 * 1000) / 10),
        })),
        texts: q.type === 'text' ? ['界面很清爽，希望增加更多主题', '静态化速度很快'] : [],
      })),
    });
  }),
  http.get('/api/cms/surveys/:id', ({ params }) => {
    const survey = mockCmsSurveys.find((s) => s.id === Number(params.id));
    return survey ? okJson(survey) : notFound('问卷不存在');
  }),
  http.post('/api/cms/surveys', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const id = getNextCmsSurveyId();
    const questions = ((body.questions as { label: string; type: 'single' | 'multiple' | 'text'; required: boolean; options: { label: string; value: string }[]; sort: number }[]) ?? [])
      .map((q, i) => ({ id: i + 1, surveyId: id, label: q.label, type: q.type, required: q.required, options: q.options ?? [], sort: q.sort ?? i }));
    const row: CmsSurvey = {
      id,
      siteId: Number(body.siteId),
      code: String(body.code ?? ''),
      title: String(body.title ?? ''),
      description: (body.description as string) ?? null,
      status: (body.status as CmsSurvey['status']) ?? 'draft',
      allowAnonymous: body.allowAnonymous !== false,
      startAt: (body.startAt as string) ?? null,
      endAt: (body.endAt as string) ?? null,
      answerCount: 0,
      questions,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsSurveys.push(row);
    return okJson(row, '创建成功');
  }),
  http.put('/api/cms/surveys/:id', async ({ params, request }) => {
    const idx = mockCmsSurveys.findIndex((s) => s.id === Number(params.id));
    if (idx === -1) return notFound('问卷不存在');
    const body = (await request.json()) as Body;
    const { questions, ...rest } = body;
    Object.assign(mockCmsSurveys[idx], rest, { updatedAt: mockDateTime() });
    if (Array.isArray(questions)) {
      mockCmsSurveys[idx].questions = (questions as { label: string; type: 'single' | 'multiple' | 'text'; required: boolean; options: { label: string; value: string }[]; sort: number }[])
        .map((q, i) => ({ id: i + 1, surveyId: mockCmsSurveys[idx].id, label: q.label, type: q.type, required: q.required, options: q.options ?? [], sort: q.sort ?? i }));
    }
    return okJson(mockCmsSurveys[idx], '更新成功');
  }),
  http.delete('/api/cms/surveys/:id', ({ params }) => {
    const idx = mockCmsSurveys.findIndex((s) => s.id === Number(params.id));
    if (idx === -1) return notFound('问卷不存在');
    mockCmsSurveys.splice(idx, 1);
    return okJson(null, '删除成功');
  }),

  // ═══ 访问统计（P4）═══════════════════════════════════════════════════════
  http.get('/api/cms/stats/visits', ({ request }) => {
    const url = new URL(request.url);
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const trend = Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 86400_000);
      const pv = 80 + Math.round(Math.sin(i / 3) * 30) + (i % 7 === 5 ? 40 : 0);
      return { date: mockDate(d), pv, uv: Math.round(pv * 0.6) };
    });
    const today = trend[trend.length - 1];
    const yesterday = trend[trend.length - 2] ?? today;
    return okJson({
      today: { pv: today.pv, uv: today.uv, ips: Math.round(today.uv * 0.9) },
      yesterday: { pv: yesterday.pv, uv: yesterday.uv, ips: Math.round(yesterday.uv * 0.9) },
      totalPv: trend.reduce((s, t) => s + t.pv, 0),
      trend,
      topContents: mockCmsContents.filter((c) => c.status === 'published').slice(0, 10).map((c, i) => ({
        contentId: c.id, title: c.title, pv: 320 - i * 40, uv: 210 - i * 26,
      })),
      devices: [
        { deviceType: 'pc', pv: 1450 },
        { deviceType: 'mobile', pv: 980 },
        { deviceType: 'bot', pv: 260 },
      ],
      referrers: [
        { host: 'www.google.com', pv: 320 },
        { host: 'www.baidu.com', pv: 260 },
        { host: 'github.com', pv: 90 },
      ],
      channels: [
        { channelCode: 'pc', pv: 1450 },
        { channelCode: 'h5', pv: 980 },
      ],
    });
  }),
  http.get('/api/cms/stats/search', ({ request }) => {
    const url = new URL(request.url);
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const trend = Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 86400_000);
      return { date: mockDate(d), count: 6 + (i % 5) };
    });
    return okJson({
      total: trend.reduce((s, t) => s + t.count, 0),
      trend,
      topKeywords: [
        { keyword: 'CMS', count: 46, avgResults: 5 },
        { keyword: '静态化', count: 31, avgResults: 3 },
        { keyword: '全文检索', count: 22, avgResults: 2 },
      ],
      noResultKeywords: [
        { keyword: '小程序模板', count: 9 },
        { keyword: '价格表', count: 5 },
      ],
    });
  }),

  // ─── 站点授权用户 ───────────────────────────────────────────────────────────
  http.get('/api/cms/sites/:id/users', () => okJson({ userIds: [], users: [] })),
  http.put('/api/cms/sites/:id/users', () => okJson(null, '保存成功')),

  // ─── P5 企业级治理 ─────────────────────────────────────────────────────────
  // 栏目授权用户（栏目级数据权限）
  http.get('/api/cms/channels/:id/users', () => okJson({ userIds: [], users: [] })),
  http.put('/api/cms/channels/:id/users', () => okJson(null, '保存成功')),
  // 站点导出（JSON 附件）/ 导入
  http.get('/api/cms/sites/:id/export', ({ params }) => {
    const site = mockCmsSites.find((s) => s.id === Number(params.id));
    const pkg = {
      version: 1,
      exportedAt: mockDateTime(),
      site: { name: site?.name ?? '演示站点', code: site?.code ?? 'demo' },
      channels: [], tags: [], contents: [], contentTags: [], contentChannels: [], contentRelations: [],
      fragments: [], friendLinks: [], redirects: [], linkWords: [], adSlots: [], ads: [], forms: [], pages: [],
    };
    return new HttpResponse(JSON.stringify(pkg, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="cms-site-${pkg.site.code}.json"`,
      },
    });
  }),
  http.post('/api/cms/sites/import', async ({ request }) => {
    const body = (await request.json()) as { site?: { name?: string; code?: string } };
    return okJson({
      siteId: 999,
      siteName: body?.site?.name ?? '导入站点',
      siteCode: `${body?.site?.code ?? 'imported'}-2`,
      counts: { channels: 0, tags: 0, contents: 0, fragments: 0, friendLinks: 0, redirects: 0, linkWords: 0, adSlots: 0, ads: 0, forms: 0, pages: 0 },
    }, '站点导入成功');
  }),
];

// ─── P3：词典 / 热词 / 批量操作 / 统计开通 / 死链检测 ──────────────────────────
export const cmsP3Handlers = [
  // 自定义词典
  http.get('/api/cms/search/words', ({ request }) => {
    const { page, pageSize, keyword } = pageParams(request);
    let list = [...mockCmsSearchWords];
    if (keyword) list = list.filter((w) => w.word.includes(keyword));
    return okJson(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/search/words', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const row = {
      id: getNextCmsSearchWordId(),
      word: String(body.word ?? ''),
      weight: Number(body.weight ?? 100),
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      remark: (body.remark as string) ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsSearchWords.push(row);
    return okJson(row, '创建成功');
  }),
  http.put('/api/cms/search/words/:id', async ({ params, request }) => {
    const idx = mockCmsSearchWords.findIndex((w) => w.id === Number(params.id));
    if (idx === -1) return notFound('词条不存在');
    Object.assign(mockCmsSearchWords[idx], await request.json(), { updatedAt: mockDateTime() });
    return okJson(mockCmsSearchWords[idx], '更新成功');
  }),
  http.delete('/api/cms/search/words/:id', ({ params }) => {
    const idx = mockCmsSearchWords.findIndex((w) => w.id === Number(params.id));
    if (idx === -1) return notFound('词条不存在');
    mockCmsSearchWords.splice(idx, 1);
    return okJson(null, '删除成功（重启服务后从进程词典移除）');
  }),

  // 搜索热词
  http.get('/api/cms/search/hot-keywords', () => okJson(mockCmsHotKeywords)),
  http.post('/api/cms/search/hot-keywords/clear', () => {
    mockCmsHotKeywords.length = 0;
    return okJson(null, '已清空');
  }),

  // 内容批量操作
  http.post('/api/cms/contents/batch-move', async ({ request }) => {
    const body = (await request.json()) as Body;
    const ids = (body.ids as number[]) ?? [];
    for (const c of mockCmsContents) {
      if (ids.includes(c.id)) c.channelId = Number(body.channelId);
    }
    return okJson(null, `已移动 ${ids.length} 条内容`);
  }),
  http.post('/api/cms/contents/batch-flags', async ({ request }) => {
    const body = (await request.json()) as Body;
    const ids = (body.ids as number[]) ?? [];
    for (const c of mockCmsContents) {
      if (!ids.includes(c.id)) continue;
      if (typeof body.isTop === 'boolean') c.isTop = body.isTop;
      if (typeof body.isRecommend === 'boolean') c.isRecommend = body.isRecommend;
      if (typeof body.isHot === 'boolean') c.isHot = body.isHot;
    }
    return okJson(null, `已更新 ${ids.length} 条内容`);
  }),
  http.post('/api/cms/contents/batch-tag', async ({ request }) => {
    const body = (await request.json()) as Body;
    const ids = (body.ids as number[]) ?? [];
    const tagIds = (body.tagIds as number[]) ?? [];
    for (const c of mockCmsContents) {
      if (ids.includes(c.id)) c.tagIds = Array.from(new Set([...c.tagIds, ...tagIds]));
    }
    return okJson(null, `已打标 ${ids.length} 条内容`);
  }),
  http.post('/api/cms/contents/distribute', async ({ request }) => {
    const body = (await request.json()) as Body;
    const ids = (body.ids as number[]) ?? [];
    const mode = (body.mode as 'copy' | 'mapping') ?? 'copy';
    const now = mockDateTime();
    for (const src of mockCmsContents.filter((c) => ids.includes(c.id))) {
      mockCmsContents.push({
        ...src,
        id: getNextCmsContentId(),
        siteId: Number(body.targetSiteId),
        channelId: Number(body.targetChannelId),
        status: 'draft',
        publishedAt: null,
        viewCount: 0,
        tagIds: [],
        // 映射：标记来源（demo 简化为正文同拷，真实实现运行时透传来源正文）
        mappingSourceId: mode === 'mapping' ? (src.mappingSourceId ?? src.id) : null,
        mappingSourceTitle: mode === 'mapping' ? src.title : null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    return okJson(null, `已${mode === 'mapping' ? '映射' : '分发'} ${ids.length} 条内容（目标站点草稿箱）`);
  }),
  http.post('/api/cms/contents/:id/duplicate', ({ params }) => {
    const src = mockCmsContents.find((c) => c.id === Number(params.id));
    if (!src) return notFound('内容不存在');
    const now = mockDateTime();
    const copy = {
      ...src,
      id: getNextCmsContentId(),
      title: `${src.title}（副本）`,
      slug: null,
      status: 'draft' as CmsContentStatus,
      publishedAt: null,
      viewCount: 0,
      tagIds: [...src.tagIds],
      createdAt: now,
      updatedAt: now,
    };
    mockCmsContents.push(copy);
    return okJson(copy, '已复制为草稿');
  }),

  // 站点开通统计
  http.post('/api/cms/sites/:id/enable-analytics', ({ params }) => {
    const site = mockCmsSites.find((s) => s.id === Number(params.id));
    if (!site) return notFound('站点不存在');
    const settings = { ...(site.settings ?? {}) } as Record<string, unknown>;
    if (settings.analyticsSiteKey) {
      return okJson({ siteKey: settings.analyticsSiteKey, created: false }, '已开通');
    }
    settings.analyticsSiteKey = `mock-key-${site.code}`;
    site.settings = settings;
    return okJson({ siteKey: settings.analyticsSiteKey, created: true }, '开通成功');
  }),

  // 图片上传（水印/缩略图管道）
  http.post('/api/cms/upload-image', () => okJson({
    url: 'https://picsum.photos/seed/cms-upload/800/450',
    thumbUrl: 'https://picsum.photos/seed/cms-upload/400/225',
    fileId: 'mock-file-id',
    width: 800,
    height: 450,
    watermarked: false,
  }, '上传成功')),

  // 死链检测（复用任务中心 mock 进度模拟）
  http.post('/api/cms/seo/deadlink-check', () => {
    return okJson(createProgressingMockTask({
      taskType: 'cms-deadlink-check',
      title: 'CMS 死链检测',
      totalItems: 30,
    }), '任务已提交');
  }),

  // ─── 采集中心 ───────────────────────────────────────────────────────────────
  http.get('/api/cms/collect/rules/:id/items', ({ params, request }) => {
    const { page, pageSize } = pageParams(request);
    const list = mockCmsCollectItems.filter((x) => x.ruleId === Number(params.id));
    return okJson(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/collect/rules/:id/run', () => okJson(createProgressingMockTask({
    taskType: 'cms-collect-run',
    title: 'CMS 采集执行',
    totalItems: 20,
  }), '任务已提交')),
  http.get('/api/cms/collect/rules', ({ request }) => {
    const { url, page, pageSize, keyword } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    let list = mockCmsCollectRules.filter((r) => r.siteId === siteId);
    if (keyword) list = list.filter((r) => r.name.includes(keyword));
    return okJson(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/collect/rules', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const row = {
      id: getNextCmsCollectRuleId(),
      siteId: Number(body.siteId),
      channelId: Number(body.channelId),
      channelName: mockCmsChannels.find((c) => c.id === Number(body.channelId))?.name ?? null,
      name: String(body.name ?? ''),
      listUrl: String(body.listUrl ?? ''),
      pageStart: Number(body.pageStart ?? 1),
      pageEnd: Number(body.pageEnd ?? 1),
      listSelector: String(body.listSelector ?? ''),
      titleSelector: String(body.titleSelector ?? ''),
      bodySelector: String(body.bodySelector ?? ''),
      summarySelector: (body.summarySelector as string) || null,
      coverSelector: (body.coverSelector as string) || null,
      removeSelectors: (body.removeSelectors as string[]) ?? [],
      autoPublish: body.autoPublish === true,
      localizeImages: body.localizeImages === true,
      maxItems: Number(body.maxItems ?? 50),
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      lastRunAt: null,
      remark: (body.remark as string) || null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsCollectRules.push(row);
    return okJson(row, '创建成功');
  }),
  http.put('/api/cms/collect/rules/:id', async ({ params, request }) => {
    const idx = mockCmsCollectRules.findIndex((r) => r.id === Number(params.id));
    if (idx === -1) return notFound('采集规则不存在');
    Object.assign(mockCmsCollectRules[idx], await request.json(), { updatedAt: mockDateTime() });
    return okJson(mockCmsCollectRules[idx], '更新成功');
  }),
  http.delete('/api/cms/collect/rules/:id', ({ params }) => {
    const idx = mockCmsCollectRules.findIndex((r) => r.id === Number(params.id));
    if (idx === -1) return notFound('采集规则不存在');
    mockCmsCollectRules.splice(idx, 1);
    return okJson(null, '删除成功');
  }),
];

// P3 Batch5：采集中心 mock 数据
const mockCmsCollectRules: import('@zenith/shared').CmsCollectRule[] = [
  {
    id: 1, siteId: 1, channelId: 2, channelName: '新闻中心', name: '示例：行业资讯采集',
    listUrl: 'https://example.com/news?page={page}', pageStart: 1, pageEnd: 3,
    listSelector: '.news-list li a', titleSelector: 'h1.title', bodySelector: '.article-content',
    summarySelector: null, coverSelector: null, removeSelectors: ['.ad', '.recommend'],
    autoPublish: false, localizeImages: true, maxItems: 50, status: 'enabled',
    lastRunAt: '2024-06-01 03:00:00', remark: '演示规则', createdAt: '2024-05-01 00:00:00', updatedAt: '2024-06-01 03:00:00',
  },
];
const mockCmsCollectItems: import('@zenith/shared').CmsCollectItem[] = [
  { id: 1, ruleId: 1, url: 'https://example.com/news/1001', title: '行业动态：示例采集成功文章', status: 'success', contentId: 1, error: null, createdAt: '2024-06-01 03:00:05' },
  { id: 2, ruleId: 1, url: 'https://example.com/news/1002', title: null, status: 'failed', contentId: null, error: '未匹配到正文', createdAt: '2024-06-01 03:00:08' },
  { id: 3, ruleId: 1, url: 'https://example.com/news/1001', title: null, status: 'skipped', contentId: null, error: null, createdAt: '2024-06-02 03:00:02' },
];
let nextCollectRuleId = 2;
function getNextCmsCollectRuleId() { return nextCollectRuleId++; }

// ─── P3 Batch6：可视化页面搭建 mock ───────────────────────────────────────────
const mockCmsPages: import('@zenith/shared').CmsPage[] = [
  {
    id: 1, siteId: 1, name: '产品落地页', slug: 'landing', isHome: false,
    blocks: [
      { id: 'b1', type: 'hero', props: { title: 'Zenith CMS', subtitle: '多站点内容管理与静态化发布', buttonText: '了解更多', buttonUrl: '/products/' } },
      { id: 'b2', type: 'columns', props: { items: [{ title: '多站点', description: '站群统一管理' }, { title: 'SEO', description: '三级 TDK 与推送' }, { title: '静态化', description: 'SSR 渲染秒开' }] } },
      { id: 'b3', type: 'content-list', props: { title: '最新动态', mode: 'latest', count: 5 } },
    ],
    seoTitle: null, seoKeywords: null, seoDescription: null,
    status: 'enabled', remark: null, createdAt: '2024-06-01 00:00:00', updatedAt: '2024-06-01 00:00:00',
  },
];
let nextCmsPageId = 2;

export const cmsP6Handlers = [
  http.get('/api/cms/pages/:id', ({ params }) => {
    const row = mockCmsPages.find((p) => p.id === Number(params.id));
    return row ? okJson(row) : notFound('页面不存在');
  }),
  http.get('/api/cms/pages', ({ request }) => {
    const { url, page, pageSize, keyword } = pageParams(request);
    const siteId = Number(url.searchParams.get('siteId'));
    let list = mockCmsPages.filter((p) => p.siteId === siteId);
    if (keyword) list = list.filter((p) => p.name.includes(keyword) || p.slug.includes(keyword));
    return okJson(paginate(list, page, pageSize));
  }),
  http.post('/api/cms/pages', async ({ request }) => {
    const body = (await request.json()) as Body;
    const now = mockDateTime();
    const row = {
      id: nextCmsPageId++,
      siteId: Number(body.siteId),
      name: String(body.name ?? ''),
      slug: String(body.slug ?? ''),
      isHome: body.isHome === true,
      blocks: (body.blocks as import('@zenith/shared').CmsPageBlock[]) ?? [],
      seoTitle: (body.seoTitle as string) || null,
      seoKeywords: (body.seoKeywords as string) || null,
      seoDescription: (body.seoDescription as string) || null,
      status: (body.status as 'enabled' | 'disabled') ?? 'enabled',
      remark: (body.remark as string) || null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsPages.push(row);
    return okJson(row, '创建成功');
  }),
  http.put('/api/cms/pages/:id', async ({ params, request }) => {
    const idx = mockCmsPages.findIndex((p) => p.id === Number(params.id));
    if (idx === -1) return notFound('页面不存在');
    Object.assign(mockCmsPages[idx], await request.json(), { updatedAt: mockDateTime() });
    return okJson(mockCmsPages[idx], '更新成功');
  }),
  http.delete('/api/cms/pages/:id', ({ params }) => {
    const idx = mockCmsPages.findIndex((p) => p.id === Number(params.id));
    if (idx === -1) return notFound('页面不存在');
    mockCmsPages.splice(idx, 1);
    return okJson(null, '删除成功');
  }),
];
