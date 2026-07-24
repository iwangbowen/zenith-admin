import { http, HttpResponse } from 'msw';
import {
  CMS_SECRET_MASK,
  CMS_SITE_INHERITABLE_FIELDS,
  CMS_SITE_MAX_DEPTH,
  type AsyncTaskItem,
  type CmsDistributionRule,
  type CmsDistributionRun,
  type CmsSite,
  type CmsSiteInheritableField,
  type CmsSiteInheritanceFlags,
} from '@zenith/shared';
import {
  buildMockChannelTree,
  getNextCmsContentId,
  mockCmsChannels,
  mockCmsContents,
  mockCmsSites,
} from '../data/cms';
import {
  getNextCmsDistributionItemId,
  getNextCmsDistributionRuleId,
  mockCmsDistributionItems,
  mockCmsDistributionRules,
  mockCmsDistributionRuns,
} from '../data/cms-stage5';
import { mockCmsTemplates, mockCmsThemePackages } from '../data/cms-stage3';
import { createProgressingMockTask, setMockTaskItems } from './async-tasks';
import { mockDateTime } from '../utils/date';

type Body = Record<string, unknown>;

function okJson<T>(data: T, message = 'ok') {
  return HttpResponse.json({ code: 0, message, data });
}

function errorJson(status: number, message: string) {
  return HttpResponse.json({ code: status, message, data: null }, { status });
}

const EMPTY_INHERITANCE: CmsSiteInheritanceFlags = {
  seoTitle: false,
  seoKeywords: false,
  seoDescription: false,
  staticMode: false,
  reviewMode: false,
  webhook: false,
  cdn: false,
  theme: false,
  themeConfig: false,
  templates: false,
};

function siteDepth(siteId: number): number {
  let depth = 1;
  let current = mockCmsSites.find((site) => site.id === siteId);
  const seen = new Set<number>();
  while (current?.parentId != null) {
    if (seen.has(current.id)) return CMS_SITE_MAX_DEPTH + 1;
    seen.add(current.id);
    current = mockCmsSites.find((site) => site.id === current?.parentId);
    depth += 1;
  }
  return depth;
}

function descendants(rootId: number): number[] {
  const result: number[] = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    result.push(id);
    queue.push(...mockCmsSites.filter((site) => site.parentId === id).map((site) => site.id));
  }
  return result;
}

function chain(siteId: number): CmsSite[] {
  const result: CmsSite[] = [];
  let current = mockCmsSites.find((site) => site.id === siteId);
  const seen = new Set<number>();
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    result.push(current);
    current = current.parentId == null
      ? undefined
      : mockCmsSites.find((site) => site.id === current?.parentId);
  }
  return result;
}

function sourceForField(siteId: number, field: CmsSiteInheritableField): CmsSite {
  const nodes = chain(siteId);
  let index = 0;
  while (index < nodes.length - 1 && (nodes[index].inheritance ?? EMPTY_INHERITANCE)[field]) index += 1;
  return nodes[index];
}

function inheritedSettings(site: CmsSite) {
  const settings = structuredClone(site.settings);
  const copyKeys = (field: CmsSiteInheritableField, keys: string[]) => {
    const source = sourceForField(site.id, field).settings;
    for (const key of keys) {
      delete settings[key];
      if (Object.hasOwn(source, key)) settings[key] = structuredClone(source[key]);
    }
  };
  copyKeys('reviewMode', ['auditMode', 'auditWorkflowDefinitionId']);
  copyKeys('webhook', ['webhookUrl', 'webhookSecret']);
  copyKeys('cdn', ['cdnPurgeUrl', 'cdnPurgeToken']);
  copyKeys('themeConfig', ['themeConfig', 'themePrimary', 'themeDark']);
  copyKeys('templates', ['defaultTemplates']);
  return settings;
}

function masked(value: unknown) {
  return typeof value === 'string' && value ? CMS_SECRET_MASK : null;
}

function redactSettings(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
    if (/(?:secret|token|password|private[_-]?key|api[_-]?key|access[_-]?key|credential)/i.test(key)) {
      return [key, typeof nested === 'string' && nested ? CMS_SECRET_MASK : nested];
    }
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return [key, redactSettings(nested as Record<string, unknown>)];
    }
    return [key, nested];
  }));
}

function effectiveConfig(site: CmsSite) {
  const settings = inheritedSettings(site);
  const sources = Object.fromEntries(CMS_SITE_INHERITABLE_FIELDS.map((field) => {
    const source = sourceForField(site.id, field);
    return [field, {
      kind: source.id === site.id ? 'own' : 'inherited',
      siteId: source.id,
      siteName: source.name,
    }];
  }));
  return {
    siteId: site.id,
    chain: chain(site.id).reverse().map((item, index) => ({
      id: item.id,
      name: item.name,
      code: item.code,
      depth: index + 1,
    })),
    inheritance: { ...EMPTY_INHERITANCE, ...(site.inheritance ?? {}) },
    resolved: {
      title: sourceForField(site.id, 'seoTitle').title,
      keywords: sourceForField(site.id, 'seoKeywords').keywords,
      description: sourceForField(site.id, 'seoDescription').description,
      staticMode: sourceForField(site.id, 'staticMode').staticMode,
      auditMode: settings.auditMode === 'workflow' ? 'workflow' : 'simple',
      auditWorkflowDefinitionId: Number(settings.auditWorkflowDefinitionId) || null,
      webhookUrl: typeof settings.webhookUrl === 'string' ? settings.webhookUrl : null,
      webhookSecret: masked(settings.webhookSecret),
      cdnPurgeUrl: typeof settings.cdnPurgeUrl === 'string' ? settings.cdnPurgeUrl : null,
      cdnPurgeToken: masked(settings.cdnPurgeToken),
      theme: sourceForField(site.id, 'theme').theme,
      themeSourceSiteId: sourceForField(site.id, 'theme').id,
      activeThemeDeploymentId: null,
      activeThemePackageId: null,
      activeThemePackageVersion: null,
      themeConfig: settings.themeConfig && typeof settings.themeConfig === 'object' ? settings.themeConfig : {},
      defaultTemplates: settings.defaultTemplates && typeof settings.defaultTemplates === 'object' ? settings.defaultTemplates : {},
    },
    sources,
  };
}

function withEffectiveSummary(site: CmsSite): CmsSite {
  return {
    ...site,
    settings: redactSettings(site.settings),
    effectiveTheme: sourceForField(site.id, 'theme').theme,
    effectiveStaticMode: sourceForField(site.id, 'staticMode').staticMode,
  };
}

function treeSites(list: CmsSite[]): CmsSite[] {
  const byId = new Map(list.map((site) => [site.id, {
    ...withEffectiveSummary(site),
    parentName: site.parentId == null ? null : mockCmsSites.find((parent) => parent.id === site.parentId)?.name ?? null,
    depth: siteDepth(site.id),
    hasChildren: mockCmsSites.some((child) => child.parentId === site.id),
    children: [] as CmsSite[],
  }]));
  const roots: CmsSite[] = [];
  for (const site of byId.values()) {
    const parent = site.parentId == null ? null : byId.get(site.parentId);
    if (parent) parent.children!.push(site);
    else roots.push(site);
  }
  const prune = (nodes: CmsSite[]) => nodes.forEach((node) => {
    if (node.children?.length) prune(node.children);
    else delete node.children;
  });
  prune(roots);
  return roots;
}

function paginate<T>(list: T[], page: number, pageSize: number) {
  return { list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize };
}

function sanitizeMockHtml(value: string | null): string | null {
  return value?.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '') ?? null;
}

function executeMockDistribution(rule: CmsDistributionRule, taskId: number) {
  const sources = mockCmsContents.filter((content) =>
    content.siteId === rule.sourceSiteId
    && content.status === 'published'
    && content.distributionSourceId == null
    && (rule.sourceChannelId == null || content.channelId === rule.sourceChannelId)
    && (!rule.filters.contentTypes.length || rule.filters.contentTypes.includes(content.contentType))
    && (!rule.filters.keyword || `${content.title} ${content.summary ?? ''}`.includes(rule.filters.keyword)));
  const items: AsyncTaskItem[] = [];
  let succeeded = 0;
  let skipped = 0;
  let conflicts = 0;
  const failed = 0;
  for (const source of sources) {
    const tracked = mockCmsContents.find((content) =>
      content.distributionRuleId === rule.id
      && content.distributionSourceId === source.id);
    const conflict = tracked ?? mockCmsContents.find((content) =>
      content.siteId === rule.targetSiteId
      && content.channelId === rule.targetChannelId
      && content.title === source.title);
    let outcome: 'success' | 'skipped' | 'conflict';
    let message: string;
    let targetId: number | null = conflict?.id ?? null;
    if (conflict?.lockedAt) {
      outcome = 'conflict';
      conflicts += 1;
      message = '目标内容已锁定，禁止覆盖';
    } else if (tracked && (tracked.distributionSourceVersion ?? 0) >= source.version) {
      outcome = 'skipped';
      skipped += 1;
      message = '来源版本已同步，幂等跳过';
    } else if (conflict && !tracked && rule.conflictStrategy === 'skip') {
      outcome = 'conflict';
      conflicts += 1;
      message = '目标存在同名内容，按规则跳过';
    } else {
      const target = conflict && rule.conflictStrategy === 'overwrite'
        ? conflict
        : tracked ?? {
          ...structuredClone(source),
          id: getNextCmsContentId(),
          siteId: rule.targetSiteId,
          channelId: rule.targetChannelId,
          status: 'draft' as const,
          publishedAt: null,
          viewCount: 0,
          likeCount: 0,
          favoriteCount: 0,
          slug: null,
          tagIds: [],
          createdAt: mockDateTime(),
        };
      Object.assign(target, {
        title: source.title,
        summary: source.summary,
        body: rule.mode === 'mapping' ? null : sanitizeMockHtml(source.body),
        extend: rule.mode === 'mapping' ? {} : structuredClone(source.extend),
        mappingSourceId: rule.mode === 'mapping' ? (source.mappingSourceId ?? source.id) : null,
        distributionRuleId: rule.id,
        distributionSourceId: source.id,
        distributionSourceVersion: source.version,
        updatedAt: mockDateTime(),
      });
      if (!mockCmsContents.some((content) => content.id === target.id)) mockCmsContents.push(target);
      succeeded += 1;
      targetId = target.id;
      outcome = 'success';
      message = rule.mode === 'mapping' ? '已创建或更新映射草稿' : '已创建或更新独立草稿';
    }
    items.push({
      id: getNextCmsDistributionItemId(),
      taskId,
      itemKey: `source:${source.id}`,
      label: source.title,
      status: outcome === 'success' ? 'success' : 'skipped',
      message,
      data: { outcome, ruleId: rule.id, sourceContentId: source.id, targetContentId: targetId },
      attempt: 1,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    });
  }
  mockCmsDistributionItems.set(taskId, items);
  setMockTaskItems(taskId, items);
  return { succeeded, skipped, conflicts, failed, total: sources.length };
}

export const cmsStage5Handlers = [
  http.get('/api/public/cms/theme-assets/:siteId/:code/:version/assets/*', ({ params }) => {
    const site = mockCmsSites.find((item) => item.id === Number(params.siteId));
    if (!site) return new HttpResponse(null, { status: 404 });
    const themeSource = sourceForField(site.id, 'theme');
    const code = String(params.code);
    const version = String(params.version);
    const asset = `assets/${String(params['*'] ?? params['0'] ?? '')}`;
    const pkg = mockCmsThemePackages.find((item) =>
      item.code === code
      && item.version === version
      && item.status === 'validated'
      && item.validationReport.valid
      && item.activeSiteIds.includes(themeSource.id));
    if (themeSource.theme !== code || !pkg?.manifest.assets.includes(asset)) {
      return new HttpResponse(null, { status: 404 });
    }
    const contentType = asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
    return new HttpResponse(asset.endsWith('.css') ? '/* inherited scoped demo asset */' : new Uint8Array(), {
      status: 200,
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  }),

  http.get('/api/cms/sites/all', () =>
    okJson(mockCmsSites.filter((site) => site.status === 'enabled').map(withEffectiveSummary))),

  http.get('/api/cms/sites', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    let rows = [...mockCmsSites];
    if (keyword) rows = rows.filter((site) => site.name.includes(keyword) || site.code.includes(keyword) || (site.domain ?? '').includes(keyword));
    if (status) rows = rows.filter((site) => site.status === status);
    return okJson(paginate(rows.map(withEffectiveSummary), page, pageSize));
  }),

  http.get('/api/cms/sites/themes', ({ request }) => {
    const siteId = Number(new URL(request.url).searchParams.get('siteId')) || 0;
    const site = mockCmsSites.find((item) => item.id === siteId);
    const themes = [
      { code: 'default', label: '默认主题' },
      { code: 'docs', label: '文档主题' },
    ];
    if (!site) return okJson(themes);
    const source = sourceForField(site.id, 'theme');
    const activePackage = mockCmsThemePackages.find((item) =>
      item.status === 'validated' && item.activeSiteIds.includes(source.id) && item.code === source.theme);
    return okJson(activePackage
      ? [...themes, { code: activePackage.code, label: `${activePackage.name} ${activePackage.version}` }]
      : themes);
  }),

  http.get('/api/cms/sites/themes/:code/templates', ({ params, request }) => {
    const siteId = Number(new URL(request.url).searchParams.get('siteId')) || 0;
    const site = mockCmsSites.find((item) => item.id === siteId);
    const code = String(params.code);
    if (!site) return errorJson(404, '站点不存在');
    const themeSource = sourceForField(site.id, 'theme');
    const activePackage = mockCmsThemePackages.find((item) =>
      item.code === code
      && item.status === 'validated'
      && item.activeSiteIds.includes(themeSource.id)
      && sourceForField(site.id, 'theme').theme === code);
    if (activePackage) {
      return okJson({
        list: activePackage.manifest.templates.filter((item) => item.type === 'list').map((item) => ({ name: item.code, label: item.name, source: 'package' })),
        detail: activePackage.manifest.templates.filter((item) => item.type === 'detail').map((item) => ({ name: item.code, label: item.name, source: 'package' })),
      });
    }
    if (!['default', 'docs'].includes(code)) return okJson({ list: [], detail: [] });
    const templateScope = (() => {
      const nodes = chain(site.id);
      const ids = [nodes[0].id];
      let index = 0;
      while (index < nodes.length - 1 && (nodes[index].inheritance ?? EMPTY_INHERITANCE).templates) {
        index += 1;
        ids.push(nodes[index].id);
      }
      return ids;
    })();
    const manual = mockCmsTemplates.filter((template) =>
      template.themeCode === code
      && template.source === 'manual'
      && template.status === 'enabled'
      && template.activeVersion != null
      && (template.siteId == null || templateScope.includes(template.siteId)));
    const make = (type: 'list' | 'detail') => {
      const options = new Map<string, { name: string; label: string; source: string; sourceSiteId: number | null }>();
      const builtins = type === 'list' && code === 'default'
        ? [{ name: 'list-card', label: '卡片网格（产品/案例）' }, { name: 'list-compact', label: '紧凑标题（公告/文件）' }]
        : type === 'detail' && code === 'default'
          ? [{ name: 'detail-plain', label: '简洁正文（公告/政策）' }]
          : [];
      builtins.forEach((item) => options.set(item.name, { ...item, source: 'builtin', sourceSiteId: null }));
      [...manual].sort((a, b) => {
        const rank = (value: typeof a) => value.siteId == null ? -1 : templateScope.length - templateScope.indexOf(value.siteId);
        return rank(a) - rank(b);
      }).filter((template) => template.type === type).forEach((template) => {
        options.set(template.code, {
          name: template.code,
          label: template.name,
          source: template.siteId == null ? 'global' : template.siteId === site.id ? 'own' : 'inherited',
          sourceSiteId: template.siteId,
        });
      });
      return [...options.values()];
    };
    return okJson({ list: make('list'), detail: make('detail') });
  }),

  http.get('/api/cms/sites/:id/template-health', ({ params, request }) => {
    const site = mockCmsSites.find((item) => item.id === Number(params.id));
    if (!site) return errorJson(404, '站点不存在');
    const theme = new URL(request.url).searchParams.get('theme') || sourceForField(site.id, 'theme').theme;
    return okJson({
      theme,
      themeRegistered: ['default', 'docs'].includes(theme) || mockCmsThemePackages.some((item) => item.code === theme),
      invalidRefs: [],
    });
  }),

  http.get('/api/cms/sites/tree', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    let rows = [...mockCmsSites];
    if (keyword) rows = rows.filter((site) => site.name.includes(keyword) || site.code.includes(keyword));
    if (status) rows = rows.filter((site) => site.status === status);
    return okJson(treeSites(rows));
  }),

  http.get('/api/cms/sites/:id/inheritance-chain', ({ params }) => {
    const site = mockCmsSites.find((item) => item.id === Number(params.id));
    if (!site) return errorJson(404, '站点不存在');
    return okJson(chain(site.id).reverse().map((item, index) => ({
      id: item.id,
      parentId: item.parentId,
      name: item.name,
      code: item.code,
      depth: index + 1,
      status: item.status,
    })));
  }),

  http.get('/api/cms/sites/:id/effective-config', ({ params }) => {
    const site = mockCmsSites.find((item) => item.id === Number(params.id));
    return site ? okJson(effectiveConfig(site)) : errorJson(404, '站点不存在');
  }),

  http.put('/api/cms/sites/:id/parent', async ({ params, request }) => {
    const site = mockCmsSites.find((item) => item.id === Number(params.id));
    if (!site) return errorJson(404, '站点不存在');
    const body = await request.json() as { parentId?: number | null };
    const parentId = body.parentId ?? null;
    if (parentId === site.id || descendants(site.id).includes(parentId ?? -1)) {
      return errorJson(400, '不能把站点移动到自身子树中');
    }
    const subtreeHeight = Math.max(...descendants(site.id).map((id) => siteDepth(id) - siteDepth(site.id) + 1));
    const nextDepth = parentId == null ? 1 : siteDepth(parentId) + 1;
    if (nextDepth + subtreeHeight - 1 > CMS_SITE_MAX_DEPTH) return errorJson(400, `移动后站点层级将超过 ${CMS_SITE_MAX_DEPTH} 层`);
    site.parentId = parentId;
    site.themeRevision += 1;
    site.templateRefsRevision += 1;
    site.updatedAt = mockDateTime();
    return okJson({
      site,
      affectedSiteIds: descendants(site.id),
      maxDepth: CMS_SITE_MAX_DEPTH,
    }, '站点子树已移动');
  }),

  http.put('/api/cms/sites/:id/inheritance', async ({ params, request }) => {
    const site = mockCmsSites.find((item) => item.id === Number(params.id));
    if (!site) return errorJson(404, '站点不存在');
    const patch = await request.json() as Partial<CmsSiteInheritanceFlags>;
    if (site.parentId == null && Object.values(patch).some(Boolean)) return errorJson(400, '根站点没有父级，不能启用继承');
    site.inheritance = { ...EMPTY_INHERITANCE, ...(site.inheritance ?? {}), ...patch };
    site.themeRevision += 1;
    site.templateRefsRevision += 1;
    site.updatedAt = mockDateTime();
    return okJson({
      inheritance: site.inheritance,
      effectiveConfig: effectiveConfig(site),
      affectedSiteIds: descendants(site.id),
    }, '继承策略已更新');
  }),

  http.post('/api/cms/publishing/group-submit', async ({ request }) => {
    const body = await request.json() as { rootSiteId?: number };
    const root = mockCmsSites.find((site) => site.id === Number(body.rootSiteId));
    if (!root) return errorJson(404, '站群根站点不存在');
    const targetSiteIds = descendants(root.id).filter((id) => mockCmsSites.find((site) => site.id === id)?.status === 'enabled');
    const tasks = targetSiteIds.map((siteId) => createProgressingMockTask({
      taskType: 'cms-publish-build',
      title: `CMS 站群整站发布 #${siteId}`,
      payload: { siteId, targetType: 'site', groupRootSiteId: root.id },
      totalItems: 5,
    }));
    return okJson({ rootSiteId: root.id, targetSiteIds, tasks }, '站群重建任务已提交');
  }),

  http.get('/api/cms/distributions/runs', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const ruleId = Number(url.searchParams.get('ruleId')) || 0;
    const siteId = Number(url.searchParams.get('siteId')) || 0;
    const status = url.searchParams.get('status') ?? '';
    let rows = [...mockCmsDistributionRuns];
    if (ruleId) rows = rows.filter((run) => run.ruleId === ruleId);
    if (siteId) rows = rows.filter((run) => run.sourceSiteId === siteId || run.targetSiteId === siteId);
    if (status) rows = rows.filter((run) => run.status === status);
    return okJson(paginate(rows, page, pageSize));
  }),

  http.get('/api/cms/distributions/runs/:id', ({ params }) => {
    const run = mockCmsDistributionRuns.find((item) => item.id === Number(params.id));
    return run
      ? okJson({ run, items: mockCmsDistributionItems.get(run.id) ?? [] })
      : errorJson(404, '分发同步记录不存在');
  }),

  http.get('/api/cms/distributions', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') ?? '';
    const mode = url.searchParams.get('mode') ?? '';
    const status = url.searchParams.get('status') ?? '';
    let rows = [...mockCmsDistributionRules];
    if (keyword) rows = rows.filter((rule) => rule.name.includes(keyword));
    if (mode) rows = rows.filter((rule) => rule.mode === mode);
    if (status) rows = rows.filter((rule) => rule.status === status);
    return okJson(paginate(rows, page, pageSize));
  }),

  http.post('/api/cms/distributions', async ({ request }) => {
    const body = await request.json() as Body;
    if (Number(body.sourceSiteId) === Number(body.targetSiteId)) return errorJson(400, '来源站点与目标站点不能相同');
    const sourceSite = mockCmsSites.find((site) => site.id === Number(body.sourceSiteId));
    const targetSite = mockCmsSites.find((site) => site.id === Number(body.targetSiteId));
    const targetChannel = mockCmsChannels.find((channel) => channel.id === Number(body.targetChannelId));
    if (!sourceSite || !targetSite || !targetChannel || targetChannel.siteId !== targetSite.id) return errorJson(400, '站点或栏目范围无效');
    const now = mockDateTime();
    const rule: CmsDistributionRule = {
      id: getNextCmsDistributionRuleId(),
      name: String(body.name ?? ''),
      sourceSiteId: sourceSite.id,
      sourceSiteName: sourceSite.name,
      sourceChannelId: Number(body.sourceChannelId) || null,
      sourceChannelName: mockCmsChannels.find((channel) => channel.id === Number(body.sourceChannelId))?.name ?? null,
      targetSiteId: targetSite.id,
      targetSiteName: targetSite.name,
      targetChannelId: targetChannel.id,
      targetChannelName: targetChannel.name,
      mode: body.mode as CmsDistributionRule['mode'],
      conflictStrategy: body.conflictStrategy as CmsDistributionRule['conflictStrategy'],
      filters: structuredClone(body.filters as CmsDistributionRule['filters']),
      scheduleCron: String(body.scheduleCron ?? '') || null,
      nextRunAt: null,
      lastRunAt: null,
      status: body.status as CmsDistributionRule['status'],
      revision: 1,
      remark: String(body.remark ?? '') || null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsDistributionRules.unshift(rule);
    return okJson(rule, '分发规则已创建');
  }),

  http.get('/api/cms/distributions/:id', ({ params }) => {
    const rule = mockCmsDistributionRules.find((item) => item.id === Number(params.id));
    return rule ? okJson(rule) : errorJson(404, '分发规则不存在');
  }),

  http.put('/api/cms/distributions/:id', async ({ params, request }) => {
    const rule = mockCmsDistributionRules.find((item) => item.id === Number(params.id));
    if (!rule) return errorJson(404, '分发规则不存在');
    const body = await request.json() as Body;
    Object.assign(rule, body, {
      revision: rule.revision + 1,
      updatedAt: mockDateTime(),
    });
    return okJson(rule, '分发规则已更新');
  }),

  http.post('/api/cms/distributions/:id/run', ({ params }) => {
    const rule = mockCmsDistributionRules.find((item) => item.id === Number(params.id));
    if (!rule) return errorJson(404, '分发规则不存在');
    if (rule.status !== 'enabled') return errorJson(409, '分发规则已停用');
    const watermark = `${rule.revision}-${mockCmsContents.filter((item) => item.siteId === rule.sourceSiteId).reduce((max, item) => Math.max(max, item.version), 0)}`;
    const duplicate = mockCmsDistributionRuns.find((run) =>
      run.ruleId === rule.id && run.payload.watermark === watermark && ['pending', 'running'].includes(run.status));
    if (duplicate) return okJson(duplicate, '分发任务已存在');
    const task = createProgressingMockTask({
      taskType: 'cms-distribution-sync',
      title: `CMS 内容分发：${rule.name}`,
      payload: {
        ruleId: rule.id,
        expectedRevision: rule.revision,
        sourceSiteId: rule.sourceSiteId,
        targetSiteId: rule.targetSiteId,
        trigger: 'manual',
        watermark,
      },
      totalItems: Math.max(1, mockCmsContents.filter((content) => content.siteId === rule.sourceSiteId && content.status === 'published').length),
    });
    const result = executeMockDistribution(rule, task.id);
    const run = Object.assign(task, {
      ruleId: rule.id,
      ruleName: rule.name,
      sourceSiteId: rule.sourceSiteId,
      sourceSiteName: rule.sourceSiteName,
      targetSiteId: rule.targetSiteId,
      targetSiteName: rule.targetSiteName,
      trigger: 'manual' as const,
      succeeded: result.succeeded,
      skipped: result.skipped,
      conflicts: result.conflicts,
      failedCount: result.failed,
    }) as CmsDistributionRun;
    mockCmsDistributionRuns.unshift(run);
    rule.lastRunAt = mockDateTime();
    return okJson(run, '分发任务已提交');
  }),

  http.delete('/api/cms/distributions/:id', ({ params }) => {
    const index = mockCmsDistributionRules.findIndex((item) => item.id === Number(params.id));
    if (index < 0) return errorJson(404, '分发规则不存在');
    const rule = mockCmsDistributionRules[index];
    const locked = mockCmsContents.find((content) =>
      content.distributionRuleId === rule.id && content.mappingSourceId != null && content.lockedAt);
    if (locked) return errorJson(423, `映射内容 #${locked.id} 已锁定，不能删除规则并解除映射`);
    mockCmsContents.forEach((content) => {
      if (content.distributionRuleId !== rule.id) return;
      if (content.mappingSourceId != null) {
        const source = mockCmsContents.find((item) => item.id === content.mappingSourceId);
        content.body = sanitizeMockHtml(source?.body ?? content.body);
        content.extend = structuredClone(source?.extend ?? content.extend);
        content.mappingSourceId = null;
        content.version += 1;
      }
      content.distributionRuleId = null;
    });
    mockCmsDistributionRules.splice(index, 1);
    return okJson(null, '删除成功');
  }),

  http.get('/api/cms/distributions/:id/source-channels', ({ params }) => {
    const rule = mockCmsDistributionRules.find((item) => item.id === Number(params.id));
    return rule ? okJson(buildMockChannelTree(mockCmsChannels.filter((channel) => channel.siteId === rule.sourceSiteId))) : errorJson(404, '分发规则不存在');
  }),
];
