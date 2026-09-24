import { matchesFilter } from '../utils/filter';
import { cmsReleaseContract, mergeCmsConfigurationSnapshots, type CmsConfigurationSnapshot, type CmsRelease, type CmsDeployment, type CreateCmsReleaseInput } from '@zenith/shared/cms';
import { mock, MockHttpError } from '../utils/contract';
import { requireItem, updateItem } from '../utils/crud';
import { badRequest, conflict, nextIdFrom } from '../utils/handlers';
import { mockDateTime } from '../utils/date';
import { mockCmsContents, mockCmsSites, mockCmsPages, mockCmsWidgets, mockCmsChannels, mockCmsWidgetRefs, mockCmsFriendLinkGroups, mockCmsFriendLinks, mockCmsLinkWords, mockCmsRedirects, mockCmsSearchWords, mockCmsResources } from '../data/cms';
import { activateMockCmsRevision, getMockCmsPublishedContent, getMockCmsRevision, getMockCmsRevisionContent, getMockCmsWorkingContent, withdrawMockCmsContent } from '../utils/cms-revisions';
import { escapeHtml, type OutputOf } from '@zenith/shared/core';

const releases: CmsRelease[] = [];
const deployments: (CmsDeployment & { siteId: number; revisions: Map<number, number> })[] = [];
const active = new Map<number, number>();
const suppressed = new Set<number>();
const activations: (OutputOf<typeof cmsReleaseContract.detail>['activations'][number] & { releaseId: number })[] = [];
const configurations = new Map<number, CmsConfigurationSnapshot>();
const requireRelease = (id: number) => requireItem(releases, id, '发布单不存在', { status: 404 });

function captureConfiguration(siteId: number, options: { pageIds?: number[]; widgetIds?: number[]; includeSiteConfiguration?: boolean }) {
  const all = options.includeSiteConfiguration === true;
  const pageIds = options.pageIds ?? [];
  const widgetIds = options.widgetIds ?? [];
  const pages = mockCmsPages.filter((row) => row.siteId === siteId && (all || pageIds.includes(row.id)));
  const widgets = mockCmsWidgets.filter((row) => row.siteId === siteId && (all || widgetIds.includes(row.id)));
  const rows = (values: readonly object[]) => values.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), structuredClone(value)])));
  const snapshot: CmsConfigurationSnapshot = { tables: {}, replaceAll: [], pageIds, widgetIds, deleteIds: {} };
  if (all || pageIds.length) {
    snapshot.tables.cms_pages = rows(pages);
    snapshot.tables.cms_widget_refs = rows(mockCmsWidgetRefs.filter((row) => row.siteId === siteId && (all || (row.ownerType === 'page' && pageIds.includes(row.ownerId)))));
  }
  if (all || widgetIds.length) snapshot.tables.cms_widgets = rows(widgets);
  if (all) {
    for (const [table, values] of Object.entries({ cms_sites: mockCmsSites, cms_channels: mockCmsChannels, cms_friend_link_groups: mockCmsFriendLinkGroups, cms_friend_links: mockCmsFriendLinks, cms_link_words: mockCmsLinkWords, cms_redirects: mockCmsRedirects, cms_search_words: mockCmsSearchWords, cms_resources: mockCmsResources })) {
      snapshot.tables[table] = rows(values.filter((row) => 'siteId' in row ? row.siteId === siteId : row.id === siteId));
    }
    snapshot.replaceAll = Object.keys(snapshot.tables);
  }
  const items: CmsRelease['configurationItems'] = [
    ...(all ? [{ kind: 'site' as const, id: siteId, title: '整站公开配置与导航' }] : []),
    ...pages.map((page) => ({ kind: 'page' as const, id: page.id, title: page.name })),
    ...widgets.map((widget) => ({ kind: 'widget' as const, id: widget.id, title: widget.name })),
  ];
  return { snapshot, items, pages, widgets };
}

/** Saving configuration only updates the current actor's review draft. Building freezes it. */
export function stageMockCmsConfigurationDraft(siteId: number) {
  requireItem(mockCmsSites, siteId, '站点不存在', { status: 404 });
  const capture = captureConfiguration(siteId, { includeSiteConfiguration: true });
  const existing = releases.findLast((row) => row.siteId === siteId && row.source === 'configuration' && row.status === 'draft' && row.createdBy === 1);
  if (existing) {
    configurations.set(existing.id, mergeCmsConfigurationSnapshots(configurations.get(existing.id)!, capture.snapshot));
    return updateItem(releases, existing.id, { configurationItems: capture.items, baseGenerationId: active.get(siteId) ?? null, error: null }, { notFoundMessage: '发布单不存在', now: mockDateTime });
  }
  const release = create({ siteId, name: '站点配置变更', revisionIds: [], withdrawContentIds: [], pageIds: [], widgetIds: [], includeSiteConfiguration: true, timeZone: 'Asia/Shanghai', autoActivate: false });
  release.source = 'configuration';
  return release;
}

function activate(id: number, expectedGenerationId: number | null, rollback = false) {
  const release = requireRelease(id);
  const current = active.get(release.siteId) ?? null;
  if (current === release.deploymentId && release.status === 'active') return release;
  if (current !== expectedGenerationId || (!rollback && release.baseGenerationId !== current)) throw new MockHttpError(conflict('公开版本已变化，请刷新发布单', { status: 409 }));
  if (!(rollback ? ['active', 'superseded'] : ['ready', 'scheduled']).includes(release.status) || !release.deploymentId) throw new MockHttpError(conflict('候选部署尚未就绪', { status: 409 }));
  const deployment = requireItem(deployments, release.deploymentId, '部署不存在', { status: 404 });
  for (const row of mockCmsContents.filter((item) => item.siteId === release.siteId)) {
    const revisionId = deployment.revisions.get(row.id);
    if (revisionId && !suppressed.has(row.id)) activateMockCmsRevision(revisionId);
    else if (getMockCmsPublishedContent(row.id)) withdrawMockCmsContent(row.id);
  }
  for (const old of releases.filter((item) => item.siteId === release.siteId && item.status === 'active')) old.status = 'superseded';
  for (const old of deployments.filter((item) => item.siteId === release.siteId && item.status === 'active')) old.status = 'retired';
  active.set(release.siteId, deployment.id);
  activations.push({ id: nextIdFrom(activations), releaseId: release.id, fromGenerationId: current, toGenerationId: deployment.id, action: rollback ? 'rollback' : 'activate', operatorId: 1, operatorName: '演示管理员', createdAt: mockDateTime() });
  deployment.status = 'active'; deployment.activatedAt = mockDateTime();
  return updateItem(releases, release.id, { status: 'active' as const, error: null }, { notFoundMessage: '发布单不存在', now: mockDateTime });
}

function create(input: CreateCmsReleaseInput) {
  requireItem(mockCmsSites, input.siteId, '站点不存在', { status: 404 });
  mockCmsContents.filter((row) => row.siteId === input.siteId).forEach((row) => getMockCmsWorkingContent(row.id));
  const items: CmsRelease['items'] = input.revisionIds.map((id) => {
    const revision = getMockCmsRevision(id);
    if (!revision) throw new MockHttpError(badRequest('修订不存在', { status: 400 }));
    const content = getMockCmsWorkingContent(revision.contentId);
    if (content.siteId !== input.siteId || (content.approvedRevisionId !== id && content.publishedRevisionId !== id)) throw new MockHttpError(badRequest('修订未批准或不属于该站点', { status: 400 }));
    return { contentId: content.id, revisionId: revision.id, title: revision.title, action: 'publish' as const };
  });
  const { pages, widgets, snapshot, items: configurationItems } = captureConfiguration(input.siteId, input);
  if (!input.includeSiteConfiguration && (pages.length !== new Set(input.pageIds).size || widgets.length !== new Set(input.widgetIds).size)) throw new MockHttpError(badRequest('配置对象不属于所选站点', { status: 400 }));
  for (const id of input.withdrawContentIds) {
    const row = getMockCmsWorkingContent(id);
    if (row.siteId !== input.siteId) throw new MockHttpError(badRequest('内容不属于该站点', { status: 400 }));
    items.push({ contentId: id, revisionId: null, title: row.title, action: 'withdraw' });
  }
  const release: CmsRelease = { id: nextIdFrom(releases), siteId: input.siteId, name: input.name, source: 'manual', status: 'draft', items,
    configurationItems,
    baseGenerationId: active.get(input.siteId) ?? null, deploymentId: null, activateAt: input.activateAt ?? null, timeZone: input.timeZone,
    autoActivate: input.autoActivate, error: null, createdBy: 1, updatedBy: 1, createdAt: mockDateTime(), updatedAt: mockDateTime() };
  releases.push(release);
  configurations.set(release.id, snapshot);
  return release;
}

function build(id: number) {
  const release = requireRelease(id);
  if (!['draft', 'failed'].includes(release.status)) throw new MockHttpError(conflict('当前状态不能构建', { status: 409 }));
  release.status = 'building';
  const deployment = { id: nextIdFrom(deployments), siteId: release.siteId, status: 'building' as CmsDeployment['status'], manifestHash: null as string | null, artifactCount: 0, error: null, activatedAt: null, revisions: new Map<number, number>() };
  deployments.push(deployment); release.deploymentId = deployment.id;
  setTimeout(() => {
    if (release.status === 'cancelled') return;
    try {
      const base = active.get(release.siteId);
      const prior = base ? deployments.find((item) => item.id === base)?.revisions : undefined;
      deployment.revisions = prior ? new Map(prior) : new Map(mockCmsContents.filter((row) => row.siteId === release.siteId).flatMap((row) => {
        const published = getMockCmsPublishedContent(row.id); return published?.publishedRevisionId ? [[row.id, published.publishedRevisionId] as const] : [];
      }));
      for (const item of release.items) {
        if (item.action === 'publish' && item.revisionId) deployment.revisions.set(item.contentId, item.revisionId);
        else deployment.revisions.delete(item.contentId);
      }
      deployment.status = 'ready'; deployment.manifestHash = `demo-generation-${deployment.id}`; deployment.artifactCount = deployment.revisions.size + 1;
      release.status = release.activateAt && release.activateAt > mockDateTime() ? 'scheduled' : 'ready';
      if (release.autoActivate && release.status === 'ready') activate(release.id, release.baseGenerationId);
    } catch (error) { release.status = 'failed'; release.error = error instanceof Error ? error.message : '构建失败'; }
  }, 250);
  return release;
}

export function submitMockCmsContentRelease(contentId: number, revisionId: number) {
  const content = getMockCmsWorkingContent(contentId);
  const release = create({ siteId: content.siteId, name: `发布：${content.title}`, revisionIds: [revisionId], withdrawContentIds: [], pageIds: [], widgetIds: [], includeSiteConfiguration: false, activateAt: content.scheduledAt, timeZone: 'Asia/Shanghai', autoActivate: true });
  release.source = 'content';
  return build(release.id);
}
export function submitMockCmsContentBatch(contentIds: number[]) {
  const groups = new Map<string, number[]>();
  for (const id of contentIds) {
    const row = getMockCmsWorkingContent(id);
    const key = JSON.stringify([row.siteId, row.scheduledAt ?? null]);
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  return [...groups.values()].map((ids) => {
    const rows = ids.map(getMockCmsWorkingContent);
    const release = create({ siteId: rows[0].siteId, name: `批量发布 ${ids.length} 条内容`, revisionIds: rows.map((row) => row.approvedRevisionId!),
      withdrawContentIds: [], pageIds: [], widgetIds: [], includeSiteConfiguration: false, activateAt: rows[0].scheduledAt, timeZone: 'Asia/Shanghai', autoActivate: true });
    release.source = 'content';
    const submitted = build(release.id);
    return { id: release.id, siteId: release.siteId, status: submitted.status, contentIds: ids };
  });
}
export function submitMockCmsWithdrawal(contentId: number) {
  const content = getMockCmsWorkingContent(contentId);
  return build(create({ siteId: content.siteId, name: `撤下：${content.title}`, revisionIds: [], withdrawContentIds: [contentId], pageIds: [], widgetIds: [], includeSiteConfiguration: false, timeZone: 'Asia/Shanghai', autoActivate: true }).id);
}

export const cmsReleaseHandlers = [
  mock(cmsReleaseContract.list, ({ query, paginate, ok }) => ok(paginate(releases.filter((row) => row.siteId === query.siteId && (!query.keyword || row.name.includes(query.keyword)) && matchesFilter(row.status, query.status)).toReversed()))),
  mock(cmsReleaseContract.detail, ({ params, ok }) => {
    const row = requireRelease(params.id);
    if (row.status === 'scheduled' && row.activateAt && row.activateAt <= mockDateTime()) activate(row.id, row.baseGenerationId);
    return ok({ ...row, deployment: deployments.find((item) => item.id === row.deploymentId) ?? null, activeGenerationId: active.get(row.siteId) ?? null, activations: activations.filter((activation) => activation.releaseId === row.id),
      blockingChecks: row.error ? [row.error] : (active.get(row.siteId) ?? null) !== row.baseGenerationId && row.status !== 'active' ? ['公开版本已变化'] : [] });
  }),
  mock(cmsReleaseContract.preview, ({ params, query, ok }) => {
    const release = requireRelease(params.id);
    const deployment = deployments.find((item) => item.id === release.deploymentId);
    if (!deployment || deployment.status === 'building') return conflict('请先完成候选构建', { status: 409 });
    const contentHtml = [...deployment.revisions.values()].map((revisionId) => {
      const row = getMockCmsRevisionContent(revisionId);
      return `<article><h2>${escapeHtml(row.title)}</h2><p>${escapeHtml(row.summary ?? '')}</p><p>${escapeHtml((row.body ?? '').replace(/<[^>]+>/g, ''))}</p></article>`;
    }).join('');
    const configHtml = configurations.get(release.id)?.tables.cms_pages?.map((page) => `<section><h2>${escapeHtml(String(page.name ?? ''))}</h2></section>`).join('') ?? '';
    return ok({ html: `<!doctype html><html><body><h1>${escapeHtml(release.name)}</h1>${configHtml}${contentHtml}</body></html>`, status: 200, path: query.path, generationId: deployment.id });
  }),
  mock(cmsReleaseContract.create, ({ body, ok }) => ok(create(body))),
  mock(cmsReleaseContract.build, ({ params, ok }) => ok(build(params.id))),
  mock(cmsReleaseContract.activate, ({ params, body, ok }) => ok(activate(params.id, body.expectedGenerationId))),
  mock(cmsReleaseContract.rollback, ({ params, body, ok }) => ok(activate(params.id, body.expectedGenerationId, true))),
  mock(cmsReleaseContract.cancel, ({ params, ok }) => {
    const row = requireRelease(params.id);
    if (row.status === 'active') return conflict('已激活发布不能取消', { status: 409 });
    return ok(updateItem(releases, params.id, { status: 'cancelled' as const }, { notFoundMessage: '发布单不存在', now: mockDateTime }));
  }),
  mock(cmsReleaseContract.suppress, ({ params, ok }) => { getMockCmsWorkingContent(params.id); suppressed.add(params.id); withdrawMockCmsContent(params.id); return ok(null); }),
  mock(cmsReleaseContract.unsuppress, ({ params, ok }) => {
    const row = getMockCmsWorkingContent(params.id); suppressed.delete(params.id);
    const revisionId = deployments.find((item) => item.id === active.get(row.siteId))?.revisions.get(row.id);
    if (revisionId) activateMockCmsRevision(revisionId);
    return ok(null);
  }),
];

export function resetMockCmsReleases() {
  releases.length = 0;
  deployments.length = 0;
  activations.length = 0;
  active.clear();
  suppressed.clear();
  configurations.clear();
}
