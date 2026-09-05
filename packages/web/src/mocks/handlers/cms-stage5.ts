import { badRequest, conflict, locked, notFound } from '@/mocks/utils/handlers';
import { mock } from '@/mocks/utils/contract';
import {
  CMS_SECRET_MASK,
  CMS_SITE_INHERITABLE_FIELDS,
  CMS_SITE_MAX_DEPTH,
  cmsDistributionContract,
  cmsPublishingContract,
  cmsSiteContract,
} from '@zenith/shared/cms';
import type {
  CmsDistributionRule,
  CmsDistributionRun,
  CmsSite,
  CmsSiteEffectiveConfig,
  CmsSiteInheritableField,
  CmsSiteInheritanceFlags,
  CmsSiteInheritanceSource,
  CmsSiteTemplateDefaults,
} from '@zenith/shared/cms';
import type { AsyncTaskItem } from '@zenith/shared/tasks';
import {
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
import { createProgressingMockTask, setMockTaskItems } from './async-tasks';
import { mockDateTime } from '../utils/date';

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

function effectiveConfig(site: CmsSite): CmsSiteEffectiveConfig {
  const settings = inheritedSettings(site);
  const sources = Object.fromEntries(CMS_SITE_INHERITABLE_FIELDS.map((field): [CmsSiteInheritableField, CmsSiteInheritanceSource] => {
    const source = sourceForField(site.id, field);
    return [field, {
      kind: source.id === site.id ? 'own' : 'inherited',
      siteId: source.id,
      siteName: source.name,
    }];
  })) as Record<CmsSiteInheritableField, CmsSiteInheritanceSource>;
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
      themeConfig: settings.themeConfig && typeof settings.themeConfig === 'object' ? settings.themeConfig as Record<string, unknown> : {},
      defaultTemplates: settings.defaultTemplates && typeof settings.defaultTemplates === 'object' ? settings.defaultTemplates as CmsSiteTemplateDefaults : {},
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
    const conflicting = tracked ?? mockCmsContents.find((content) =>
      content.siteId === rule.targetSiteId
      && content.channelId === rule.targetChannelId
      && content.title === source.title);
    let outcome: 'success' | 'skipped' | 'conflict';
    let message: string;
    let targetId: number | null = conflicting?.id ?? null;
    if (conflicting?.lockedAt) {
      outcome = 'conflict';
      conflicts += 1;
      message = '目标内容已锁定，禁止覆盖';
    } else if (tracked && (tracked.distributionSourceVersion ?? 0) >= source.version) {
      outcome = 'skipped';
      skipped += 1;
      message = '来源版本已同步，幂等跳过';
    } else if (conflicting && !tracked && rule.conflictStrategy === 'skip') {
      outcome = 'conflict';
      conflicts += 1;
      message = '目标存在同名内容，按规则跳过';
    } else {
      const target = conflicting && rule.conflictStrategy === 'overwrite'
        ? conflicting
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
  mock(cmsSiteContract.all, ({ ok }) => ok(mockCmsSites.filter((site) => site.status === 'enabled').map(withEffectiveSummary))),

  mock(cmsSiteContract.list, ({ query, paginate, ok }) => {
    const { keyword, status } = query;
    let rows = [...mockCmsSites];
    if (keyword) rows = rows.filter((site) => site.name.includes(keyword) || site.code.includes(keyword) || (site.domain ?? '').includes(keyword));
    if (status) rows = rows.filter((site) => site.status === status);
    return ok(paginate(rows.map(withEffectiveSummary)));
  }),

  mock(cmsSiteContract.themes, ({ ok }) => ok([
    { code: 'default', label: '默认主题' },
    { code: 'docs', label: '文档主题' },
  ])),

  mock(cmsSiteContract.themeTemplates, ({ params, ok }) => {
    const { code } = params;
    if (!['default', 'docs'].includes(code)) return ok({ list: [], detail: [] });
    return ok({
      list: code === 'default' ? [
        { name: 'list-card', label: '卡片网格（产品/案例）', source: 'builtin' as const, sourceSiteId: null },
        { name: 'list-compact', label: '紧凑标题（公告/文件）', source: 'builtin' as const, sourceSiteId: null },
      ] : [],
      detail: code === 'default' ? [
        { name: 'detail-plain', label: '简洁正文（公告/政策）', source: 'builtin' as const, sourceSiteId: null },
      ] : [],
    });
  }),

  mock(cmsSiteContract.templateHealth, ({ params, query, ok }) => {
    const site = mockCmsSites.find((item) => item.id === params.id);
    if (!site) return notFound('站点不存在', { status: 404 });
    const theme = query.theme || sourceForField(site.id, 'theme').theme;
    return ok({
      theme,
      themeRegistered: ['default', 'docs'].includes(theme),
      invalidRefs: [],
    });
  }),

  mock(cmsSiteContract.tree, ({ query, ok }) => {
    const { keyword, status } = query;
    let rows = [...mockCmsSites];
    if (keyword) rows = rows.filter((site) => site.name.includes(keyword) || site.code.includes(keyword));
    if (status) rows = rows.filter((site) => site.status === status);
    return ok(treeSites(rows));
  }),

  mock(cmsSiteContract.inheritanceChain, ({ params, ok }) => {
    const site = mockCmsSites.find((item) => item.id === params.id);
    if (!site) return notFound('站点不存在', { status: 404 });
    return ok(chain(site.id).reverse().map((item, index) => ({
      id: item.id,
      parentId: item.parentId,
      name: item.name,
      code: item.code,
      depth: index + 1,
      status: item.status,
    })));
  }),

  mock(cmsSiteContract.effectiveConfig, ({ params, ok }) => {
    const site = mockCmsSites.find((item) => item.id === params.id);
    return site ? ok(effectiveConfig(site)) : notFound('站点不存在', { status: 404 });
  }),

  mock(cmsSiteContract.move, ({ params, body, ok }) => {
    const site = mockCmsSites.find((item) => item.id === params.id);
    if (!site) return notFound('站点不存在', { status: 404 });
    const parentId = body.parentId ?? null;
    if (parentId === site.id || descendants(site.id).includes(parentId ?? -1)) {
      return badRequest('不能把站点移动到自身子树中', { status: 400 });
    }
    const subtreeHeight = Math.max(...descendants(site.id).map((id) => siteDepth(id) - siteDepth(site.id) + 1));
    const nextDepth = parentId == null ? 1 : siteDepth(parentId) + 1;
    if (nextDepth + subtreeHeight - 1 > CMS_SITE_MAX_DEPTH) return badRequest(`移动后站点层级将超过 ${CMS_SITE_MAX_DEPTH} 层`, { status: 400 });
    site.parentId = parentId;
    site.themeRevision += 1;
    site.templateRefsRevision += 1;
    site.updatedAt = mockDateTime();
    return ok({
      site,
      affectedSiteIds: descendants(site.id),
      maxDepth: CMS_SITE_MAX_DEPTH,
    }, '站点子树已移动');
  }),

  mock(cmsSiteContract.updateInheritance, ({ params, body, ok }) => {
    const site = mockCmsSites.find((item) => item.id === params.id);
    if (!site) return notFound('站点不存在', { status: 404 });
    if (site.parentId == null && Object.values(body).some(Boolean)) return badRequest('根站点没有父级，不能启用继承', { status: 400 });
    site.inheritance = { ...EMPTY_INHERITANCE, ...(site.inheritance ?? {}), ...body };
    site.themeRevision += 1;
    site.templateRefsRevision += 1;
    site.updatedAt = mockDateTime();
    return ok({
      inheritance: site.inheritance,
      effectiveConfig: effectiveConfig(site),
      affectedSiteIds: descendants(site.id),
    }, '继承策略已更新');
  }),

  mock(cmsPublishingContract.groupSubmit, ({ body, ok }) => {
    const root = mockCmsSites.find((site) => site.id === body.rootSiteId);
    if (!root) return notFound('站群根站点不存在', { status: 404 });
    const targetSiteIds = descendants(root.id).filter((id) => mockCmsSites.find((site) => site.id === id)?.status === 'enabled');
    const tasks = targetSiteIds.map((siteId) => createProgressingMockTask({
      taskType: 'cms-publish-build',
      title: `CMS 站群整站发布 #${siteId}`,
      payload: { siteId, targetType: 'site', groupRootSiteId: root.id },
      totalItems: 5,
    }));
    return ok({ rootSiteId: root.id, targetSiteIds, tasks }, '站群重建任务已提交');
  }),

  mock(cmsDistributionContract.runs, ({ query, paginate, ok }) => {
    const { ruleId, siteId, status } = query;
    let rows = [...mockCmsDistributionRuns];
    if (ruleId) rows = rows.filter((run) => run.ruleId === ruleId);
    if (siteId) rows = rows.filter((run) => run.sourceSiteId === siteId || run.targetSiteId === siteId);
    if (status) rows = rows.filter((run) => run.status === status);
    return ok(paginate(rows));
  }),

  mock(cmsDistributionContract.runDetail, ({ params, ok }) => {
    const run = mockCmsDistributionRuns.find((item) => item.id === params.id);
    return run
      ? ok({ run, items: mockCmsDistributionItems.get(run.id) ?? [] })
      : notFound('分发同步记录不存在', { status: 404 });
  }),

  mock(cmsDistributionContract.list, ({ query, paginate, ok }) => {
    const { keyword, mode, status } = query;
    let rows = [...mockCmsDistributionRules];
    if (keyword) rows = rows.filter((rule) => rule.name.includes(keyword));
    if (mode) rows = rows.filter((rule) => rule.mode === mode);
    if (status) rows = rows.filter((rule) => rule.status === status);
    return ok(paginate(rows));
  }),

  mock(cmsDistributionContract.create, ({ body, ok }) => {
    if (body.sourceSiteId === body.targetSiteId) return badRequest('来源站点与目标站点不能相同', { status: 400 });
    const sourceSite = mockCmsSites.find((site) => site.id === body.sourceSiteId);
    const targetSite = mockCmsSites.find((site) => site.id === body.targetSiteId);
    const targetChannel = mockCmsChannels.find((channel) => channel.id === body.targetChannelId);
    if (!sourceSite || !targetSite || !targetChannel || targetChannel.siteId !== targetSite.id) return badRequest('站点或栏目范围无效', { status: 400 });
    const now = mockDateTime();
    const rule: CmsDistributionRule = {
      id: getNextCmsDistributionRuleId(),
      name: body.name,
      sourceSiteId: sourceSite.id,
      sourceSiteName: sourceSite.name,
      sourceChannelId: body.sourceChannelId,
      sourceChannelName: mockCmsChannels.find((channel) => channel.id === body.sourceChannelId)?.name ?? null,
      targetSiteId: targetSite.id,
      targetSiteName: targetSite.name,
      targetChannelId: targetChannel.id,
      targetChannelName: targetChannel.name,
      mode: body.mode,
      conflictStrategy: body.conflictStrategy,
      filters: structuredClone(body.filters),
      scheduleCron: body.scheduleCron || null,
      nextRunAt: null,
      lastRunAt: null,
      status: body.status,
      revision: 1,
      remark: body.remark || null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsDistributionRules.unshift(rule);
    return ok(rule, '分发规则已创建');
  }),

  mock(cmsDistributionContract.detail, ({ params, ok }) => {
    const rule = mockCmsDistributionRules.find((item) => item.id === params.id);
    return rule ? ok(rule) : notFound('分发规则不存在', { status: 404 });
  }),

  mock(cmsDistributionContract.update, ({ params, body, ok }) => {
    const rule = mockCmsDistributionRules.find((item) => item.id === params.id);
    if (!rule) return notFound('分发规则不存在', { status: 404 });
    Object.assign(rule, body, {
      revision: rule.revision + 1,
      updatedAt: mockDateTime(),
    });
    return ok(rule, '分发规则已更新');
  }),

  mock(cmsDistributionContract.run, ({ params, ok }) => {
    const rule = mockCmsDistributionRules.find((item) => item.id === params.id);
    if (!rule) return notFound('分发规则不存在', { status: 404 });
    if (rule.status !== 'enabled') return conflict('分发规则已停用', { status: 409 });
    const watermark = `${rule.revision}-${mockCmsContents.filter((item) => item.siteId === rule.sourceSiteId).reduce((max, item) => Math.max(max, item.version), 0)}`;
    const duplicate = mockCmsDistributionRuns.find((run) =>
      run.ruleId === rule.id && run.payload.watermark === watermark && ['pending', 'running'].includes(run.status));
    if (duplicate) return ok(duplicate, '分发任务已存在');
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
    const run: CmsDistributionRun = Object.assign(task, {
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
    });
    mockCmsDistributionRuns.unshift(run);
    rule.lastRunAt = mockDateTime();
    return ok(run, '分发任务已提交');
  }),

  mock(cmsDistributionContract.remove, ({ params, ok }) => {
    const index = mockCmsDistributionRules.findIndex((item) => item.id === params.id);
    if (index < 0) return notFound('分发规则不存在', { status: 404 });
    const rule = mockCmsDistributionRules[index];
    const lockedContent = mockCmsContents.find((content) =>
      content.distributionRuleId === rule.id && content.mappingSourceId != null && content.lockedAt);
    if (lockedContent) return locked(`映射内容 #${lockedContent.id} 已锁定，不能删除规则并解除映射`, { status: 423 });
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
    return ok(null, '删除成功');
  }),
];
