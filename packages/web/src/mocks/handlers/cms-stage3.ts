import { http, HttpResponse } from 'msw';
import {
  CMS_PUBLISH_TARGET_TYPES,
  CMS_TEMPLATE_TYPES,
  type AsyncTask,
  type CmsPublishTargetType,
  type CmsTemplateDslDocument,
} from '@zenith/shared';
import {
  getNextCmsTemplateId,
  getNextCmsTemplateVersionId,
  getNextCmsThemePackageId,
  mockCmsPublishArtifacts,
  mockCmsPublishingTasks,
  mockCmsTemplates,
  mockCmsTemplateVersions,
  mockCmsThemePackages,
} from '../data/cms-stage3';
import { mockCmsSites } from '../data/cms';
import { mockDateTime } from '../utils/date';
import { createProgressingMockTask } from './async-tasks';

const ok = <T>(data: T, message = 'success') => HttpResponse.json({ code: 0, message, data });
const fail = (message: string, status = 400) => HttpResponse.json({ code: status, message, data: null }, { status });

function page<T>(rows: T[], url: URL) {
  const current = Number(url.searchParams.get('page')) || 1;
  const pageSize = Number(url.searchParams.get('pageSize')) || 10;
  return { list: rows.slice((current - 1) * pageSize, current * pageSize), total: rows.length, page: current, pageSize };
}

async function mockUploadMeta(request: Request): Promise<{ name: string; size: number } | null> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) return null;
  const bytes = new Uint8Array(await request.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const match = /filename="([^"]+)"/i.exec(text);
  return match ? { name: match[1], size: bytes.byteLength } : null;
}

function validateDsl(dsl: unknown) {
  const issues: Array<{ path: string; code: string; message: string }> = [];
  let nodes = 0;
  let depth = 0;
  const walk = (node: unknown, currentDepth: number, path: string) => {
    if (!node || typeof node !== 'object') {
      issues.push({ path, code: 'invalid_node', message: '节点必须是对象' });
      return;
    }
    nodes += 1;
    depth = Math.max(depth, currentDepth);
    if (nodes > 500) issues.push({ path, code: 'too_many_nodes', message: '节点不能超过 500' });
    if (currentDepth > 32) issues.push({ path, code: 'too_deep', message: '深度不能超过 32' });
    const value = node as Record<string, unknown>;
    if (!['element', 'text', 'binding', 'if', 'each', 'rich_text', 'component'].includes(String(value.kind))) {
      issues.push({ path: `${path}.kind`, code: 'kind_not_allowed', message: '节点类型不在白名单' });
    }
    if (value.kind === 'element') {
      if (['script', 'iframe', 'object', 'style'].includes(String(value.tag))) {
        issues.push({ path: `${path}.tag`, code: 'element_not_allowed', message: '可执行或嵌入元素被禁止' });
      }
      for (const key of Object.keys((value.attrs ?? {}) as object)) {
        if (/^on/i.test(key) || key === 'dangerouslySetInnerHTML') {
          issues.push({ path: `${path}.attrs.${key}`, code: 'attribute_not_allowed', message: '事件与任意 HTML 属性被禁止' });
        }
      }
    }
    const childGroups = [value.children, value.fallback, value.empty];
    childGroups.forEach((children, groupIndex) => {
      if (Array.isArray(children)) children.forEach((child, index) => walk(child, currentDepth + 1, `${path}.${groupIndex}.${index}`));
    });
  };
  const document = dsl as { version?: unknown; root?: unknown };
  if (document?.version !== 2) issues.push({ path: '$.version', code: 'version', message: '仅支持 DSL v2' });
  walk(document?.root, 1, '$.root');
  return {
    valid: issues.length === 0,
    version: document?.version === 2 ? 2 : null,
    checksum: issues.length ? null : 'demo-sha256-checksum',
    nodeCount: nodes,
    maxDepth: depth,
    issues,
  };
}

function templateDetail(id: number) {
  const template = mockCmsTemplates.find((item) => item.id === id);
  if (!template) return null;
  return {
    ...template,
    versions: mockCmsTemplateVersions.filter((version) => version.templateId === id).sort((a, b) => b.version - a.version),
  };
}

function toPublishingTask(task: AsyncTask, targetType: CmsPublishTargetType, siteId: number) {
  const siteName = mockCmsSites.find((site) => site.id === siteId)?.name ?? null;
  return Object.assign(task, {
    siteId,
    siteName,
    siteIds: [siteId],
    siteNames: siteName ? [siteName] : [],
    targetType,
    artifactCount: mockCmsPublishArtifacts.filter((artifact) => artifact.taskId === task.id).length,
    failedArtifactCount: mockCmsPublishArtifacts.filter((artifact) => artifact.taskId === task.id && artifact.status === 'failed').length,
  });
}

function recordPublishingTask(task: AsyncTask, targetType: CmsPublishTargetType, siteId: number): AsyncTask {
  mockCmsPublishingTasks.unshift(toPublishingTask(task, targetType, siteId));
  return task;
}

export const cmsStage3Handlers = [
  http.get('/api/public/cms/theme-assets/:siteId/:code/:version/assets/*', ({ params }) => {
    const siteId = Number(params.siteId);
    const code = String(params.code);
    const version = String(params.version);
    const asset = `assets/${String(params['*'] ?? params['0'] ?? '')}`;
    const site = mockCmsSites.find((item) => item.id === siteId);
    const pkg = mockCmsThemePackages.find((item) =>
      item.code === code
      && item.version === version
      && item.status === 'validated'
      && item.validationReport.valid
      && item.activeSiteIds.includes(siteId));
    if (!site || site.theme !== code || !pkg?.manifest.assets.includes(asset)) {
      return new HttpResponse(null, { status: 404 });
    }
    const contentType = asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
    return new HttpResponse(asset.endsWith('.css') ? '/* scoped demo theme asset */' : new Uint8Array(), {
      headers: { 'content-type': contentType, 'x-content-type-options': 'nosniff' },
    });
  }),

  http.get('/api/cms/templates', ({ request }) => {
    const url = new URL(request.url);
    let rows = [...mockCmsTemplates];
    const siteId = Number(url.searchParams.get('siteId')) || undefined;
    const keyword = url.searchParams.get('keyword') ?? '';
    const type = url.searchParams.get('type');
    const status = url.searchParams.get('status');
    if (siteId) {
      rows = rows
        .filter((item) => item.siteId == null || item.siteId === siteId)
        .map((item) => {
          if (item.source !== 'package') return item;
          const activePackage = mockCmsThemePackages.find((pkg) => pkg.code === item.themeCode && pkg.activeSiteIds.includes(siteId));
          const packageVersion = activePackage
            ? mockCmsTemplateVersions.find((version) => version.templateId === item.id && version.themePackageId === activePackage.id)
            : undefined;
          const packageEntry = activePackage?.manifest.templates.find((entry) => entry.type === item.type && entry.code === item.code);
          return {
            ...item,
            name: packageVersion && packageEntry ? packageEntry.name : item.name,
            status: packageVersion ? 'enabled' as const : 'disabled' as const,
            activeVersion: packageVersion?.version ?? null,
          };
        });
    } else {
      rows = rows.map((item) => item.source === 'package' ? { ...item, status: 'disabled' as const, activeVersion: null } : item);
    }
    if (keyword) rows = rows.filter((item) => item.name.includes(keyword) || item.code.includes(keyword));
    if (type) rows = rows.filter((item) => item.type === type);
    if (status) rows = rows.filter((item) => item.status === status);
    return ok(page(rows, url));
  }),

  http.post('/api/cms/templates/validate', async ({ request }) => {
    const body = await request.json() as { dsl?: unknown };
    return ok(validateDsl(body.dsl));
  }),

  http.post('/api/cms/templates', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    if (!CMS_TEMPLATE_TYPES.includes(body.type as never)) return fail('模板类型无效');
    const report = validateDsl(body.dsl);
    if (!report.valid) return fail(`模板 DSL 校验失败：${report.issues[0]?.message}`);
    const now = mockDateTime();
    const id = getNextCmsTemplateId();
    const template = {
      id,
      siteId: Number(body.siteId) || null,
      themeCode: String(body.themeCode ?? 'default'),
      type: body.type as typeof mockCmsTemplates[number]['type'],
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      source: 'manual' as const,
      status: 'enabled' as const,
      currentVersion: 1,
      activeVersion: null,
      lifecycleRevision: 0,
      description: typeof body.description === 'string' ? body.description : null,
      createdAt: now,
      updatedAt: now,
    };
    mockCmsTemplates.unshift(template);
    mockCmsTemplateVersions.push({
      id: getNextCmsTemplateVersionId(),
      templateId: id,
      version: 1,
      dsl: body.dsl as CmsTemplateDslDocument,
      checksum: report.checksum ?? '',
      changeNote: typeof body.changeNote === 'string' ? body.changeNote : null,
      themePackageId: null,
      createdAt: now,
    });
    return ok(templateDetail(id), '创建成功');
  }),

  http.get('/api/cms/templates/:id/diff', ({ params, request }) => {
    const id = Number(params.id);
    const url = new URL(request.url);
    const from = Number(url.searchParams.get('from'));
    const to = Number(url.searchParams.get('to'));
    const before = mockCmsTemplateVersions.find((item) => item.templateId === id && item.version === from);
    const after = mockCmsTemplateVersions.find((item) => item.templateId === id && item.version === to);
    if (!before || !after) return fail('模板版本不存在', 404);
    return ok({
      templateId: id,
      from,
      to,
      changes: JSON.stringify(before.dsl) === JSON.stringify(after.dsl) ? [] : [{ path: '$.root', change: 'changed', before: before.dsl.root, after: after.dsl.root }],
    });
  }),

  http.get('/api/cms/templates/:id', ({ params }) => {
    const detail = templateDetail(Number(params.id));
    return detail ? ok(detail) : fail('模板不存在', 404);
  }),

  http.put('/api/cms/templates/:id', async ({ params, request }) => {
    const template = mockCmsTemplates.find((item) => item.id === Number(params.id));
    if (!template) return fail('模板不存在', 404);
    if (template.source === 'package') return fail('主题包模板元数据由签名 manifest 管理，禁止手工修改');
    const body = await request.json() as { name?: string; description?: string | null };
    Object.assign(template, { name: body.name ?? template.name, description: body.description === undefined ? template.description : body.description, updatedAt: mockDateTime() });
    return ok(template, '更新成功');
  }),

  http.post('/api/cms/templates/:id/versions', async ({ params, request }) => {
    const template = mockCmsTemplates.find((item) => item.id === Number(params.id));
    if (!template) return fail('模板不存在', 404);
    if (template.source === 'package') return fail('主题包模板不可直接编辑');
    const body = await request.json() as { dsl: CmsTemplateDslDocument; changeNote?: string };
    const report = validateDsl(body.dsl);
    if (!report.valid) return fail(`模板 DSL 校验失败：${report.issues[0]?.message}`);
    template.currentVersion += 1;
    template.updatedAt = mockDateTime();
    const version = {
      id: getNextCmsTemplateVersionId(),
      templateId: template.id,
      version: template.currentVersion,
      dsl: structuredClone(body.dsl),
      checksum: report.checksum ?? '',
      changeNote: body.changeNote ?? null,
      themePackageId: null,
      createdAt: mockDateTime(),
    };
    mockCmsTemplateVersions.push(version);
    return ok(version, '新版本已保存');
  }),

  http.post('/api/cms/templates/:id/preview', ({ params }) => {
    const template = mockCmsTemplates.find((item) => item.id === Number(params.id));
    if (!template) return fail('模板不存在', 404);
    return ok({ status: 200, html: `<!doctype html><html><head><title>${template.name}</title></head><body><h1>${template.name}</h1><p>Demo 模式同源声明式渲染预览</p></body></html>` });
  }),

  http.post('/api/cms/templates/:id/:action', async ({ params, request }) => {
    const template = mockCmsTemplates.find((item) => item.id === Number(params.id));
    if (!template) return fail('模板不存在', 404);
    const action = String(params.action);
    if (template.source === 'package' && ['activate', 'deactivate', 'rollback'].includes(action)) {
      return fail('主题包模板状态由活动 deployment 派生，禁止手工操作');
    }
    const body = await request.json().catch(() => ({})) as { version?: number };
    if (action === 'rollback') {
      const source = mockCmsTemplateVersions.find((item) => item.templateId === template.id && item.version === body.version);
      if (!source) return fail('目标版本不存在', 404);
      template.currentVersion += 1;
      mockCmsTemplateVersions.push({ ...structuredClone(source), id: getNextCmsTemplateVersionId(), version: template.currentVersion, changeNote: `回滚至 v${body.version}`, createdAt: mockDateTime() });
      template.activeVersion = template.currentVersion;
    } else if (action === 'activate') {
      const targetVersion = body.version ?? template.currentVersion;
      if (template.activeVersion === targetVersion && template.status === 'enabled') return fail('模板版本已激活', 409);
      template.activeVersion = targetVersion;
      template.status = 'enabled';
    } else if (action === 'deactivate') {
      if (template.activeVersion == null || template.status === 'disabled') return fail('模板当前未激活', 409);
      template.activeVersion = null;
      template.status = 'disabled';
    } else return fail('操作不存在', 404);
    template.lifecycleRevision += 1;
    const siteId = template.siteId ?? 1;
    const task = recordPublishingTask(
      createProgressingMockTask({ taskType: 'cms-publish-build', title: `模板 ${template.name} 影响重建`, payload: {
        siteId,
        targetType: 'template',
        templateId: template.id,
        expectedThemeRevision: mockCmsSites.find((site) => site.id === siteId)?.themeRevision ?? 0,
        expectedTemplateRefsRevision: mockCmsSites.find((site) => site.id === siteId)?.templateRefsRevision ?? 0,
        expectedTemplateLifecycleRevision: template.lifecycleRevision,
      }, totalItems: 4 }),
      'template',
      siteId,
    );
    return ok({ template, tasks: [task] });
  }),

  http.get('/api/cms/themes', ({ request }) => {
    const url = new URL(request.url);
    let rows = [...mockCmsThemePackages];
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status');
    if (keyword) rows = rows.filter((item) => item.name.includes(keyword) || item.code.includes(keyword) || item.version.includes(keyword));
    if (status) rows = rows.filter((item) => item.status === status);
    return ok(page(rows, url));
  }),

  http.get('/api/cms/themes/impact', ({ request }) => {
    const url = new URL(request.url);
    const siteId = Number(url.searchParams.get('siteId')) || 1;
    const targetPackage = mockCmsThemePackages.find((item) => item.id === Number(url.searchParams.get('packageId')));
    const themeCode = targetPackage?.code ?? url.searchParams.get('themeCode') ?? mockCmsSites.find((item) => item.id === siteId)?.theme ?? 'default';
    const active = mockCmsThemePackages.find((item) => item.code === themeCode && item.activeSiteIds.includes(siteId));
    const evaluated = targetPackage ?? active;
    const affectedSites = mockCmsSites.filter((site) => site.id === siteId || site.parentId === siteId);
    return ok({
      siteId,
      affectedSiteIds: affectedSites.map((site) => site.id),
      affectedSiteNames: affectedSites.map((site) => site.name),
      themeCode,
      themeAvailable: themeCode === 'default' || Boolean(evaluated?.validationReport.valid),
      activePackageId: active?.id ?? null,
      activePackageVersion: active?.version ?? null,
      evaluatedPackageId: evaluated?.id ?? null,
      evaluatedPackageVersion: evaluated?.version ?? null,
      invalidRefs: [],
      affectedChannels: 3,
      affectedContents: 6,
      affectedPages: 1,
      pendingRebuildTasks: mockCmsPublishingTasks.filter((item) => item.siteId === siteId && ['pending', 'running'].includes(item.status)).length,
      estimatedPaths: 14,
      ranges: ['/', '/news/', '/news/{content}.html', '/p/{page}/', '/sitemap.xml'],
    });
  }),

  http.post('/api/cms/themes/validate', async ({ request }) => {
    const upload = await mockUploadMeta(request);
    if (!upload || !upload.name.toLowerCase().endsWith('.zip')) return fail('请选择 ZIP 主题包文件');
    return ok({
      valid: true,
      archiveChecksum: 'demo-package-checksum',
      manifest: mockCmsThemePackages[0]?.manifest ?? null,
      fileCount: (mockCmsThemePackages[0]?.manifest.templates.length ?? 0) + (mockCmsThemePackages[0]?.manifest.assets.length ?? 0) + 1,
      compressedBytes: upload.size,
      uncompressedBytes: upload.size * 2,
      issues: [],
    });
  }),

  http.post('/api/cms/themes/import', async ({ request }) => {
    const upload = await mockUploadMeta(request);
    if (!upload) return fail('请选择 ZIP 主题包文件');
    const shouldFail = upload.name.toLowerCase().includes('fail');
    const source = mockCmsThemePackages[0];
    if (source && !shouldFail) {
      const version = `1.0.${mockCmsThemePackages.length}`;
      const imported = {
        ...structuredClone(source),
        id: getNextCmsThemePackageId(),
        version,
        status: 'validated' as const,
        manifest: { ...structuredClone(source.manifest), version },
        activeSiteIds: [],
        createdAt: mockDateTime(),
        updatedAt: mockDateTime(),
      };
      mockCmsThemePackages.unshift(imported);
      for (const entry of imported.manifest.templates) {
        let template = mockCmsTemplates.find((item) =>
          item.siteId == null
          && item.themeCode === imported.code
          && item.type === entry.type
          && item.code === entry.code);
        if (template) {
          template.currentVersion += 1;
          template.name = entry.name;
          template.updatedAt = mockDateTime();
        } else {
          template = {
            id: getNextCmsTemplateId(),
            siteId: null,
            themeCode: imported.code,
            type: entry.type,
            code: entry.code,
            name: entry.name,
            source: 'package' as const,
            status: 'disabled' as const,
            currentVersion: 1,
            activeVersion: null,
            lifecycleRevision: 0,
            description: `${imported.name} ${imported.version} 导入模板`,
            createdAt: mockDateTime(),
            updatedAt: mockDateTime(),
          };
          mockCmsTemplates.push(template);
        }
        mockCmsTemplateVersions.push({
          id: getNextCmsTemplateVersionId(),
          templateId: template.id,
          version: template.currentVersion,
          dsl: { version: 2, root: { kind: 'element', tag: 'div', children: [{ kind: 'text', value: `${entry.name} Demo` }] } },
          checksum: imported.manifest.checksums[entry.path] ?? 'demo-checksum',
          changeNote: `主题包 ${imported.code}@${imported.version}`,
          themePackageId: imported.id,
          createdAt: mockDateTime(),
        });
      }
    }
    const task = createProgressingMockTask({
      taskType: 'cms-theme-import',
      title: `导入 CMS 主题包（${upload.name}）`,
      payload: shouldFail ? { failAtItem: 1, alwaysFail: true } : undefined,
      totalItems: 3,
    });
    return ok(task, '导入任务已提交');
  }),

  http.post('/api/cms/themes/rollback', async ({ request }) => {
    const body = await request.json() as { siteId: number; themeCode: string; packageId: number };
    const current = mockCmsThemePackages.find((item) => item.id === body.packageId);
    if (!current || !current.activeSiteIds.includes(body.siteId) || current.code !== body.themeCode) {
      return fail('请求的主题部署不是当前活动部署，无法回滚', 409);
    }
    const versions = mockCmsThemePackages.filter((item) => item.code === body.themeCode);
    const previous = versions.find((item) => item.id !== current.id && item.status === 'validated');
    if (!previous) return fail('没有可回滚的上一主题包版本');
    mockCmsThemePackages.forEach((item) => { item.activeSiteIds = item.activeSiteIds.filter((id) => id !== body.siteId); });
    previous.activeSiteIds.push(body.siteId);
    const site = mockCmsSites.find((item) => item.id === body.siteId);
    if (site) { site.theme = previous.code; site.themeRevision += 1; }
    const task = recordPublishingTask(
      createProgressingMockTask({ taskType: 'cms-publish-build', title: 'CMS 主题回滚影响重建', payload: {
        siteId: body.siteId, targetType: 'theme', expectedThemeRevision: site?.themeRevision, expectedTemplateRefsRevision: site?.templateRefsRevision, expectedDeploymentId: previous.id,
      } }),
      'theme',
      body.siteId,
    );
    return ok({ package: previous, siteName: site?.name ?? '站点', task });
  }),

  http.post('/api/cms/themes/deactivate', async ({ request }) => {
    const body = await request.json() as { siteId: number; themeCode: string; packageId: number };
    const current = mockCmsThemePackages.find((item) => item.id === body.packageId);
    const site = mockCmsSites.find((item) => item.id === body.siteId);
    if (!current || !current.activeSiteIds.includes(body.siteId) || current.code !== body.themeCode || site?.theme !== body.themeCode) {
      return fail('请求的主题部署不是该站点当前活动部署，未执行任何变更', 409);
    }
    current.activeSiteIds = current.activeSiteIds.filter((id) => id !== body.siteId);
    if (site) { site.theme = 'default'; site.themeRevision += 1; }
    const task = recordPublishingTask(
      createProgressingMockTask({ taskType: 'cms-publish-build', title: 'CMS 主题停用回退重建', payload: {
        siteId: body.siteId, targetType: 'theme', expectedThemeRevision: site?.themeRevision, expectedTemplateRefsRevision: site?.templateRefsRevision, expectedDeploymentId: null,
      } }),
      'theme',
      body.siteId,
    );
    return ok({ task });
  }),

  http.get('/api/cms/themes/:id/export', ({ params }) => {
    const item = mockCmsThemePackages.find((pkg) => pkg.id === Number(params.id));
    if (!item?.exportAvailable) return fail('未配置 CMS_THEME_SIGNING_PRIVATE_KEY，签名导出不可用', 503);
    return new HttpResponse(new Blob(['demo']), { headers: { 'content-type': 'application/zip' } });
  }),

  http.get('/api/cms/themes/:id', ({ params }) => {
    const item = mockCmsThemePackages.find((pkg) => pkg.id === Number(params.id));
    return item ? ok(item) : fail('主题包版本不存在', 404);
  }),

  http.post('/api/cms/themes/:id/preview', ({ params }) => {
    const item = mockCmsThemePackages.find((pkg) => pkg.id === Number(params.id));
    if (!item) return fail('主题包版本不存在', 404);
    return ok({ status: 200, html: `<!doctype html><html><head><title>${item.name}</title></head><body><h1>${item.name}</h1><p>签名声明式主题包预览</p></body></html>` });
  }),

  http.post('/api/cms/themes/builtin/:code/activate', async ({ params, request }) => {
    const code = String(params.code);
    if (!['default', 'docs'].includes(code)) return fail('内置主题不存在');
    const { siteId } = await request.json() as { siteId: number };
    const site = mockCmsSites.find((value) => value.id === siteId);
    if (!site) return fail('站点不存在', 404);
    const hasActivePackage = mockCmsThemePackages.some((pkg) => pkg.activeSiteIds.includes(siteId));
    if (site.theme === code && !hasActivePackage) return fail(`内置主题 ${code} 已激活`, 409);
    mockCmsThemePackages.forEach((pkg) => { pkg.activeSiteIds = pkg.activeSiteIds.filter((id) => id !== siteId); });
    site.theme = code;
    site.themeRevision += 1;
    const task = recordPublishingTask(
      createProgressingMockTask({ taskType: 'cms-publish-build', title: `激活内置主题 ${code}`, payload: {
        siteId, targetType: 'theme', expectedThemeRevision: site.themeRevision, expectedTemplateRefsRevision: site.templateRefsRevision, expectedDeploymentId: null,
      }, totalItems: 8 }),
      'theme',
      siteId,
    );
    return ok({ themeCode: code, siteName: site.name, task });
  }),

  http.post('/api/cms/themes/:id/activate', async ({ params, request }) => {
    const item = mockCmsThemePackages.find((pkg) => pkg.id === Number(params.id));
    if (!item) return fail('主题包版本不存在', 404);
    const { siteId } = await request.json() as { siteId: number };
    if (item.status !== 'validated') return fail('主题包已停用，不能激活');
    const site = mockCmsSites.find((value) => value.id === siteId);
    if (site?.theme === item.code && item.activeSiteIds.includes(siteId)) return fail('主题包版本已激活', 409);
    mockCmsThemePackages.forEach((pkg) => { pkg.activeSiteIds = pkg.activeSiteIds.filter((id) => id !== siteId); });
    if (!item.activeSiteIds.includes(siteId)) item.activeSiteIds.push(siteId);
    if (site) { site.theme = item.code; site.themeRevision += 1; }
    const task = recordPublishingTask(
      createProgressingMockTask({ taskType: 'cms-publish-build', title: `激活主题 ${item.code}@${item.version}`, payload: {
        siteId, targetType: 'theme', expectedThemeRevision: site?.themeRevision, expectedTemplateRefsRevision: site?.templateRefsRevision, expectedDeploymentId: item.id,
      }, totalItems: 8 }),
      'theme',
      siteId,
    );
    return ok({ package: item, siteName: site?.name ?? '站点', task });
  }),

  http.put('/api/cms/themes/:id/status', async ({ params, request }) => {
    const item = mockCmsThemePackages.find((pkg) => pkg.id === Number(params.id));
    if (!item) return fail('主题包版本不存在', 404);
    const { status } = await request.json() as { status: 'validated' | 'disabled' };
    if (status === item.status) return fail(`主题包已经是 ${status} 状态`, 409);
    if (status === 'disabled' && item.activeSiteIds.length) return fail('主题包仍在站点生效，请先停用站点部署', 409);
    item.status = status;
    item.updatedAt = mockDateTime();
    return ok(item);
  }),

  http.get('/api/cms/publishing/artifacts', ({ request }) => {
    const url = new URL(request.url);
    let rows = [...mockCmsPublishArtifacts];
    const siteId = Number(url.searchParams.get('siteId')) || undefined;
    const targetType = url.searchParams.get('targetType');
    const status = url.searchParams.get('status');
    const keyword = url.searchParams.get('keyword') ?? '';
    const startTime = url.searchParams.get('startTime');
    const endTime = url.searchParams.get('endTime');
    if (siteId) rows = rows.filter((item) => item.siteId === siteId);
    if (targetType) rows = rows.filter((item) => item.targetType === targetType);
    if (status) rows = rows.filter((item) => item.status === status);
    if (keyword) rows = rows.filter((item) => item.path.includes(keyword) || item.url?.includes(keyword));
    if (startTime) rows = rows.filter((item) => (item.generatedAt ?? item.updatedAt) >= startTime);
    if (endTime) rows = rows.filter((item) => (item.generatedAt ?? item.updatedAt) <= endTime);
    return ok(page(rows, url));
  }),

  http.post('/api/cms/publishing/submit', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    if (!CMS_PUBLISH_TARGET_TYPES.includes(body.targetType as never) || !Number(body.siteId)) return fail('发布目标参数无效');
    const targetType = body.targetType as CmsPublishTargetType;
    if (['content', 'contents'].includes(targetType) && !Array.isArray(body.contentIds)) return fail('内容发布必须选择内容');
    const task = createProgressingMockTask({
      taskType: 'cms-publish-build',
      title: `CMS ${targetType} 发布`,
      payload: body,
      totalItems: targetType === 'site' ? 12 : Math.max(1, (body.contentIds as unknown[] | undefined)?.length ?? 4),
      itemDelayMs: 250,
    });
    mockCmsPublishingTasks.unshift(toPublishingTask(task, targetType, Number(body.siteId)));
    return ok(task, '发布任务已提交');
  }),

  http.post('/api/cms/publishing/batch-action', async ({ request }) => {
    const body = await request.json() as { ids: number[]; action: string };
    let affected = 0;
    for (const id of body.ids ?? []) {
      const task = mockCmsPublishingTasks.find((item) => item.id === id);
      if (!task) continue;
      if (body.action === 'cancel' && ['pending', 'running'].includes(task.status)) task.status = 'cancelled';
      else if (body.action !== 'cancel' && ['success', 'failed', 'cancelled'].includes(task.status)) {
        task.status = 'pending';
        if (['restart', 'rebuild'].includes(body.action)) {
          mockCmsPublishArtifacts.splice(0, mockCmsPublishArtifacts.length, ...mockCmsPublishArtifacts.filter((item) => item.taskId !== id));
        }
      }
      else continue;
      affected++;
    }
    return ok({ affected, errors: [] });
  }),

  http.get('/api/cms/publishing/:id', ({ params }) => {
    const task = mockCmsPublishingTasks.find((item) => item.id === Number(params.id));
    if (!task) return fail('CMS 发布任务不存在', 404);
    const artifacts = mockCmsPublishArtifacts.filter((item) => item.taskId === task.id);
    return ok({
      task,
      items: artifacts.map((item, index) => ({
        id: index + 1,
        taskId: task.id,
        itemKey: item.path,
        label: item.path,
        status: item.status === 'failed' ? 'failed' : 'success',
        message: item.error,
        data: { path: item.path },
        attempt: task.attempts || 1,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      artifacts,
    });
  }),

  http.post('/api/cms/publishing/:id/:action', ({ params }) => {
    const task = mockCmsPublishingTasks.find((item) => item.id === Number(params.id));
    if (!task) return fail('CMS 发布任务不存在', 404);
    const action = String(params.action);
    if (action === 'cancel' && ['pending', 'running'].includes(task.status)) task.status = 'cancelled';
    else if (action === 'resume' && ['failed', 'cancelled'].includes(task.status)) task.status = 'pending';
    else if (['restart', 'rebuild'].includes(action) && ['success', 'failed', 'cancelled'].includes(task.status)) {
      task.status = 'pending';
      mockCmsPublishArtifacts.splice(0, mockCmsPublishArtifacts.length, ...mockCmsPublishArtifacts.filter((item) => item.taskId !== task.id));
    } else return fail('当前任务状态不支持该操作');
    task.updatedAt = mockDateTime();
    return ok(task);
  }),

  http.get('/api/cms/publishing', ({ request }) => {
    const url = new URL(request.url);
    let rows = [...mockCmsPublishingTasks];
    const siteId = Number(url.searchParams.get('siteId')) || undefined;
    const targetType = url.searchParams.get('targetType');
    const status = url.searchParams.get('status');
    const keyword = url.searchParams.get('keyword') ?? '';
    const taskType = url.searchParams.get('taskType');
    const createdBy = url.searchParams.get('createdBy')?.trim().toLowerCase();
    const startTime = url.searchParams.get('startTime');
    const endTime = url.searchParams.get('endTime');
    if (siteId) rows = rows.filter((item) => item.siteIds.includes(siteId));
    if (targetType) rows = rows.filter((item) => item.targetType === targetType);
    if (taskType) rows = rows.filter((item) => item.taskType === taskType);
    if (createdBy) rows = rows.filter((item) => (item.createdByName ?? '').toLowerCase().includes(createdBy));
    if (status === 'active') rows = rows.filter((item) => ['pending', 'running'].includes(item.status));
    else if (status === 'terminal') rows = rows.filter((item) => ['success', 'failed', 'cancelled'].includes(item.status));
    else if (status) rows = rows.filter((item) => item.status === status);
    if (keyword) rows = rows.filter((item) => item.title.includes(keyword) || item.taskType.includes(keyword));
    if (startTime) rows = rows.filter((item) => item.createdAt >= startTime);
    if (endTime) rows = rows.filter((item) => item.createdAt <= endTime);
    rows.forEach((task) => {
      task.artifactCount = mockCmsPublishArtifacts.filter((item) => item.taskId === task.id).length;
      task.failedArtifactCount = mockCmsPublishArtifacts.filter((item) => item.taskId === task.id && item.status === 'failed').length;
    });
    return ok(page(rows, url));
  }),
];
