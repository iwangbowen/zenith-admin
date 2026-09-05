import { escapeHtml } from '@zenith/shared/core';
import { badRequest, notFound, conflict } from '@/mocks/utils/handlers';
import { mock } from '@/mocks/utils/contract';
import { CMS_WIDGET_HIGH_FANOUT_THRESHOLD, CMS_WIDGET_RENDERER_KEYS, CMS_WIDGET_RENDERER_LABELS, cmsWidgetContract } from '@zenith/shared/cms';
import type { CmsResolvedWidget, CmsResolvedWidgetItem, CmsWidget, CmsWidgetData, CmsWidgetSlot, CmsWidgetSourceReference } from '@zenith/shared/cms';
import {
  getNextCmsWidgetId,
  getNextCmsWidgetRefId,
  mockCmsChannels,
  mockCmsContents,
  mockCmsSites,
  mockCmsWidgetRefs,
  mockCmsWidgets,
} from '../data/cms';
import { mockDateTime } from '../utils/date';
import { createProgressingMockTask } from './async-tasks';

function refreshCounts() {
  for (const widget of mockCmsWidgets) {
    const refs = mockCmsWidgetRefs.filter((ref) => ref.widgetId === widget.id);
    widget.referenceCount = refs.length;
    widget.impactCount = new Set(refs.map((ref) => `${ref.ownerType}:${ref.ownerId}`)).size;
    widget.highFanout = widget.impactCount >= CMS_WIDGET_HIGH_FANOUT_THRESHOLD;
    widget.hasUnpublishedChanges = widget.draftRevision !== widget.publishedRevision;
  }
}

function resolveItems(widget: CmsWidget, draft = false): CmsResolvedWidgetItem[] {
  const data = draft ? widget.draftData : widget.publishedData;
  if (!data) return [];
  return data.items.flatMap((item): CmsResolvedWidgetItem[] => {
    const content = item.sourceType === 'content'
      ? mockCmsContents.find((entry) => entry.id === item.sourceId && entry.status === 'published')
      : null;
    const channel = item.sourceType === 'channel'
      ? mockCmsChannels.find((entry) => entry.id === item.sourceId && entry.status === 'enabled')
      : null;
    if (item.sourceType !== 'manual' && !content && !channel) return [];
    return [{
      id: item.id,
      sourceType: item.sourceType,
      sourceId: item.sourceId ?? null,
      title: item.title || content?.title || channel?.name || '',
      summary: item.summary || content?.summary || channel?.seoDescription || null,
      url: item.url
        || (content ? `/${mockCmsChannels.find((entry) => entry.id === content.channelId)?.path ?? 'content'}/${content.slug ?? content.id}.html` : null)
        || (channel ? `/${channel.path}/` : null),
      image: item.image || content?.coverImage || channel?.image || null,
      displayDate: item.displayDate || content?.publishedAt || null,
    }];
  });
}

function renderPreview(widget: CmsResolvedWidget): string {
  const entries = widget.items.map((item) => {
    const title = item.url
      ? `<a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>`
      : `<span>${escapeHtml(item.title)}</span>`;
    const image = item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}">` : '';
    const summary = item.summary ? `<p>${escapeHtml(item.summary)}</p>` : '';
    if (widget.rendererKey === 'list-grid') return `<article class="card">${image}<div>${title}${summary}</div></article>`;
    if (widget.rendererKey === 'list-carousel') return `<article class="slide">${image}<strong>${title}</strong></article>`;
    return `<div class="row">${title}${summary}</div>`;
  }).join('');
  const bodyClass = widget.rendererKey === 'list-grid' ? 'grid' : widget.rendererKey === 'list-carousel' ? 'carousel' : 'sidebar';
  return `<style>.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.card,.sidebar{border:1px solid #ddd;border-radius:10px;padding:14px}.card img,.slide img{width:100%;aspect-ratio:16/9;object-fit:cover}.carousel{display:flex;gap:12px;overflow:auto}.slide{min-width:260px}.row{padding:9px 0;border-bottom:1px solid #eee}a{color:#3451b2;text-decoration:none}p{color:#666;font-size:12px}</style><section class="${bodyClass}"><h2>${escapeHtml(widget.name)}</h2>${entries}</section>`;
}

function renderPreviewDocument(siteName: string, widgetHtml: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;color:#213547;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}header,footer{padding:20px 6%;background:#172554;color:#fff}main{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:28px;padding:36px 6%;min-height:520px}.hero{padding:48px;background:#f1f5f9;border-radius:14px}aside{min-width:0}@media(max-width:768px){main{grid-template-columns:1fr;padding:20px}.hero{padding:28px}}</style></head><body><header><strong>${escapeHtml(siteName)}</strong></header><main><section class="hero"><h1>站点首页</h1><p>这里展示当前主题首页的真实结构，页面部件位于主题的首页侧栏插槽。</p></section><aside>${widgetHtml}</aside></main><footer>${escapeHtml(siteName)} · Footer</footer></body></html>`;
}

function rendererOptions() {
  return CMS_WIDGET_RENDERER_KEYS.map((key) => ({ key, label: CMS_WIDGET_RENDERER_LABELS[key] }));
}

function cloneItems(value: CmsWidgetData | null | undefined): CmsWidgetData {
  return { items: (value?.items ?? []).map((item) => ({ ...item })) };
}

function homeSidebarSlot(siteId: number): CmsWidgetSlot {
  const binding = mockCmsWidgetRefs.find((ref) =>
    ref.siteId === siteId && ref.ownerType === 'theme_slot' && ref.field === 'home.sidebar') ?? null;
  return {
    key: 'home.sidebar',
    label: '首页侧栏',
    allowedTypes: ['manual-list'],
    rendererKeys: [...CMS_WIDGET_RENDERER_KEYS],
    binding,
  };
}

const refreshTasksByKey = new Map<string, ReturnType<typeof createProgressingMockTask>>();

function submitMockWidgetRefresh(siteId: number, eventKey?: string) {
  const bucket = Math.floor(Date.now() / 5_000);
  const key = eventKey ?? `site:${siteId}:${bucket}`;
  const existing = refreshTasksByKey.get(key);
  if (existing) return existing;
  const itemDelayMs = eventKey ? 300 : Math.max((bucket + 1) * 5_000 - Date.now(), 300);
  const task = createProgressingMockTask({
    taskType: 'cms-widget-refresh',
    title: 'CMS 页面部件引用刷新',
    payload: {
      totalItems: 1,
      siteId,
    },
    totalItems: 1,
    itemDelayMs,
  });
  refreshTasksByKey.set(key, task);
  return task;
}

export function submitMockCmsWidgetSourceRefresh(
  sourceType: 'content' | 'channel',
  sourceIds: number[],
) {
  const ids = new Set(sourceIds);
  const channelSiteIds = sourceType === 'channel'
    ? new Set(mockCmsChannels.filter((channel) => ids.has(channel.id)).map((channel) => channel.siteId))
    : null;
  const siteIds = new Set(mockCmsWidgets
    .filter((widget) => widget.status === 'published' && (
      (channelSiteIds?.has(widget.siteId) ?? false)
      || widget.publishedData?.items.some((item) => item.sourceType === 'content' && item.sourceId && ids.has(item.sourceId))
    ))
    .map((widget) => widget.siteId));
  for (const siteId of siteIds) submitMockWidgetRefresh(siteId);
}

export const cmsWidgetsHandlers = [
  mock(cmsWidgetContract.options, ({ query, ok }) => {
    refreshCounts();
    return ok(mockCmsWidgets.filter((widget) => widget.siteId === query.siteId && widget.status === 'published'));
  }),

  mock(cmsWidgetContract.renderers, ({ ok }) => ok(rendererOptions())),

  mock(cmsWidgetContract.slots, ({ query, ok }) => ok([homeSidebarSlot(query.siteId)])),

  mock(cmsWidgetContract.saveSlot, ({ params, body, ok }) => {
    const { siteId } = body;
    const { slotKey } = params;
    const index = mockCmsWidgetRefs.findIndex((ref) =>
      ref.siteId === siteId && ref.ownerType === 'theme_slot' && ref.field === slotKey);
    if (index >= 0) mockCmsWidgetRefs.splice(index, 1);
    if (body.widgetId) {
      const widget = mockCmsWidgets.find((entry) => entry.id === body.widgetId && entry.siteId === siteId);
      if (!widget || widget.status !== 'published') return badRequest('主题插槽只能绑定已发布页面部件', { status: 400 });
      mockCmsWidgetRefs.push({
        id: getNextCmsWidgetRefId(),
        siteId,
        widgetId: widget.id,
        ownerType: 'theme_slot',
        ownerId: siteId,
        field: slotKey,
        rendererKey: body.rendererKey,
        styleProps: {},
        ownerName: mockCmsSites.find((site) => site.id === siteId)?.name ?? null,
        createdAt: mockDateTime(),
        updatedAt: mockDateTime(),
      });
    }
    refreshCounts();
    submitMockWidgetRefresh(siteId);
    return ok([homeSidebarSlot(siteId)], '主题插槽已更新');
  }),

  mock(cmsWidgetContract.batch, ({ body, ok }) => {
    const ids = [...new Set(body.ids)];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    for (const id of ids) {
      const index = mockCmsWidgets.findIndex((widget) => widget.id === id);
      if (index < 0) {
        failed += 1;
        continue;
      }
      const widget = mockCmsWidgets[index];
      if (body.action === 'publish') {
        widget.publishedData = cloneItems(widget.draftData);
        widget.publishedName = widget.name;
        widget.publishedRevision = widget.draftRevision;
        widget.status = 'published';
        succeeded += 1;
      } else if (body.action === 'offline') {
        if (widget.status === 'published') {
          widget.status = 'offline';
          succeeded += 1;
        } else failed += 1;
      } else if (body.action === 'delete') {
        if (mockCmsWidgetRefs.some((ref) => ref.widgetId === id)) skipped += 1;
        else {
          mockCmsWidgets.splice(index, 1);
          succeeded += 1;
        }
      }
    }
    refreshCounts();
    const task = createProgressingMockTask({
      taskType: 'cms-widget-batch',
      title: '页面部件批量操作',
      payload: {
        totalItems: Math.max(1, ids.length),
        itemDelayMs: 250,
        action: body.action,
        outcome: { processed: ids.length, succeeded, failed, skipped },
      },
      totalItems: Math.max(1, ids.length),
    });
    return ok(task, '批量任务已提交');
  }),

  mock(cmsWidgetContract.sourceRefs, ({ query, ok }) => {
    const { sourceType, sourceId } = query;
    refreshCounts();
    const refs = mockCmsWidgets.flatMap((widget): CmsWidgetSourceReference[] => {
      if (widget.status !== 'published' || !widget.publishedData) return [];
      return widget.publishedData.items
        .filter((item) => (
          item.sourceType === sourceType && item.sourceId === sourceId
        ) || (
          sourceType === 'channel'
          && item.sourceType === 'content'
          && mockCmsContents.some((content) => content.id === item.sourceId && content.channelId === sourceId)
        ))
        .flatMap((item): CmsWidgetSourceReference[] => (item.sourceType === 'manual' || item.sourceId == null ? [] : [{
          widgetId: widget.id,
          widgetName: widget.name,
          widgetCode: widget.code,
          itemId: item.id,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          referenceCount: widget.referenceCount,
          impactCount: widget.impactCount,
          highFanout: widget.highFanout,
        }]));
    });
    return ok(refs);
  }),

  mock(cmsWidgetContract.refs, ({ params, ok }) => ok(mockCmsWidgetRefs.filter((ref) => ref.widgetId === params.id))),

  mock(cmsWidgetContract.preview, ({ params, query, ok }) => {
    const widget = mockCmsWidgets.find((entry) => entry.id === params.id);
    if (!widget) return notFound('页面部件不存在', { status: 404 });
    const rendererKey = query.rendererKey ?? widget.defaultRendererKey;
    const resolved: CmsResolvedWidget = {
      id: widget.id,
      name: widget.name,
      type: widget.type,
      rendererKey,
      items: resolveItems(widget, true),
    };
    const html = renderPreview(resolved);
    const siteName = mockCmsSites.find((site) => site.id === widget.siteId)?.name ?? '演示站点';
    return ok({
      siteId: widget.siteId,
      widget: resolved,
      html,
      documentHtml: renderPreviewDocument(siteName, html),
      renderers: rendererOptions(),
    });
  }),

  mock(cmsWidgetContract.publish, ({ params, ok }) => {
    const widget = mockCmsWidgets.find((entry) => entry.id === params.id);
    if (!widget) return notFound('页面部件不存在', { status: 404 });
    widget.publishedData = cloneItems(widget.draftData);
    widget.publishedName = widget.name;
    widget.publishedRevision = widget.draftRevision;
    widget.status = 'published';
    widget.hasUnpublishedChanges = false;
    widget.updatedAt = mockDateTime();
    submitMockWidgetRefresh(widget.siteId, `publish:${widget.id}:${widget.draftRevision}:${Date.now()}`);
    return ok(widget, '发布成功');
  }),

  mock(cmsWidgetContract.offline, ({ params, ok }) => {
    const widget = mockCmsWidgets.find((entry) => entry.id === params.id);
    if (!widget) return notFound('页面部件不存在', { status: 404 });
    if (widget.status !== 'published') return badRequest(`当前状态（${widget.status}）不允许下线`, { status: 400 });
    widget.status = 'offline';
    widget.updatedAt = mockDateTime();
    submitMockWidgetRefresh(widget.siteId, `offline:${widget.id}:${widget.draftRevision}:${Date.now()}`);
    return ok(widget, '下线成功');
  }),

  mock(cmsWidgetContract.detail, ({ params, ok }) => {
    refreshCounts();
    const widget = mockCmsWidgets.find((entry) => entry.id === params.id);
    return widget ? ok(widget) : notFound('页面部件不存在', { status: 404 });
  }),

  mock(cmsWidgetContract.list, ({ query, ok, paginate }) => {
    const { siteId, keyword, status, type } = query;
    refreshCounts();
    let list = mockCmsWidgets.filter((widget) => widget.siteId === siteId);
    if (keyword) list = list.filter((widget) => widget.name.includes(keyword) || widget.code.includes(keyword));
    if (status) list = list.filter((widget) => widget.status === status);
    if (type) list = list.filter((widget) => widget.type === type);
    return ok(paginate(list));
  }),

  mock(cmsWidgetContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const row: CmsWidget = {
      id: getNextCmsWidgetId(),
      siteId: body.siteId,
      name: body.name,
      code: body.code,
      type: 'manual-list',
      schemaVersion: 1,
      draftData: cloneItems(body.draftData),
      publishedData: null,
      publishedName: null,
      draftRevision: 1,
      publishedRevision: 0,
      status: 'draft',
      defaultRendererKey: body.defaultRendererKey,
      remark: body.remark ?? null,
      referenceCount: 0,
      impactCount: 0,
      highFanout: false,
      hasUnpublishedChanges: true,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsWidgets.push(row);
    return ok(row, '创建成功');
  }),

  mock(cmsWidgetContract.update, ({ params, body, ok }) => {
    const widget = mockCmsWidgets.find((entry) => entry.id === params.id);
    if (!widget) return notFound('页面部件不存在', { status: 404 });
    if (body.expectedRevision !== widget.draftRevision) {
      return conflict('页面部件草稿已被其他人更新，请刷新后再编辑', { status: 409 });
    }
    const nextRemark = body.remark == null ? null : body.remark;
    const changed = body.draftData !== undefined
      || (body.name !== undefined && body.name !== widget.name)
      || (body.defaultRendererKey !== undefined && body.defaultRendererKey !== widget.defaultRendererKey)
      || (body.remark !== undefined && nextRemark !== widget.remark);
    if (body.name !== undefined) widget.name = body.name;
    if (body.draftData !== undefined) widget.draftData = cloneItems(body.draftData);
    if (body.defaultRendererKey !== undefined) widget.defaultRendererKey = body.defaultRendererKey;
    if (body.remark !== undefined) widget.remark = nextRemark;
    if (changed) widget.draftRevision += 1;
    widget.hasUnpublishedChanges = widget.draftRevision !== widget.publishedRevision;
    widget.updatedAt = mockDateTime();
    return ok(widget, '保存成功');
  }),

  mock(cmsWidgetContract.remove, ({ params, ok }) => {
    const index = mockCmsWidgets.findIndex((widget) => widget.id === params.id);
    if (index < 0) return notFound('页面部件不存在', { status: 404 });
    const count = mockCmsWidgetRefs.filter((ref) => ref.widgetId === params.id).length;
    if (count > 0) return conflict(`该页面部件仍被 ${count} 个位置引用，请先解除引用`, { status: 409 });
    mockCmsWidgets.splice(index, 1);
    return ok(null, '删除成功');
  }),
];
