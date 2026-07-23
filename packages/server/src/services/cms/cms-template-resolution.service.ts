import { AsyncLocalStorage } from 'node:async_hooks';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CmsTemplateDslDocument, CmsTemplateType } from '@zenith/shared';
import { db } from '../../db';
import {
  cmsSites,
  cmsTemplateVersions,
  cmsTemplates,
  cmsThemeDeployments,
  cmsThemePackages,
  type CmsThemePackageRow,
} from '../../db/schema';
import {
  isThemeRegistered,
  listThemeTemplates as listBuiltinThemeTemplates,
} from '../../cms/themes/registry';

export interface CmsRenderOverride {
  packageId?: number;
  templateId?: number;
  templateVersion?: number;
  assetBaseUrl?: string;
}

export interface CmsResolvedDslTemplate {
  dsl: CmsTemplateDslDocument;
  assetBaseUrl: string | null;
}

export interface CmsTemplateCatalog {
  siteId: number;
  siteCode: string;
  themeCode: string;
  mode: 'builtin' | 'package' | 'unavailable';
  activePackage: CmsThemePackageRow | null;
  list: Array<{ name: string; label: string }>;
  detail: Array<{ name: string; label: string }>;
}

const OPTIONAL_PACKAGE_FALLBACK_TYPES = new Set<CmsTemplateType>(['layout', 'custom_page', 'block', 'interaction']);
const renderOverrideStore = new AsyncLocalStorage<CmsRenderOverride>();

export function packageTemplateOptions(
  pkg: Pick<CmsThemePackageRow, 'manifest'>,
  type: 'list' | 'detail',
): Array<{ name: string; label: string }> {
  return pkg.manifest.templates
    .filter((entry) => entry.type === type)
    .map((entry) => ({ name: entry.code, label: entry.name }));
}

export function resolvePackageTemplateEntry(
  pkg: Pick<CmsThemePackageRow, 'manifest'>,
  type: CmsTemplateType,
  code?: string | null,
) {
  return pkg.manifest.templates.find((entry) => entry.type === type && (!code || entry.code === code)) ?? null;
}

export function withCmsRenderOverride<T>(override: CmsRenderOverride, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(renderOverrideStore.run(override, fn));
}

export async function getActiveCmsThemePackage(siteId: number): Promise<CmsThemePackageRow | null> {
  const deployment = await db.query.cmsThemeDeployments.findFirst({
    where: and(
      eq(cmsThemeDeployments.siteId, siteId),
      eq(cmsThemeDeployments.status, 'active'),
    ),
    with: { themePackage: true, site: { columns: { theme: true } } },
    orderBy: desc(cmsThemeDeployments.activatedAt),
  });
  const pkg = deployment?.themePackage;
  if (
    !pkg
    || deployment.themeCode !== pkg.code
    || deployment.site.theme !== pkg.code
    || pkg.status !== 'validated'
    || !pkg.validationReport.valid
  ) return null;
  return pkg;
}

async function activeManualTemplates(siteId: number, themeCode: string, types: CmsTemplateType[]) {
  const rows = await db.select().from(cmsTemplates).where(and(
    or(isNull(cmsTemplates.siteId), eq(cmsTemplates.siteId, siteId)),
    eq(cmsTemplates.themeCode, themeCode),
    inArray(cmsTemplates.type, types),
    eq(cmsTemplates.source, 'manual'),
    eq(cmsTemplates.status, 'enabled'),
    isNotNull(cmsTemplates.activeVersion),
  )).orderBy(asc(cmsTemplates.id));
  return [
    ...rows.filter((row) => row.siteId == null),
    ...rows.filter((row) => row.siteId === siteId),
  ];
}

export async function resolveCmsTemplateCatalog(
  siteId: number,
  themeCode: string,
  options?: { ignoreActivePackage?: boolean },
): Promise<CmsTemplateCatalog> {
  const [site] = await db.select({ code: cmsSites.code }).from(cmsSites).where(eq(cmsSites.id, siteId)).limit(1);
  if (!site) throw new HTTPException(404, { message: '站点不存在' });
  const activePackage = options?.ignoreActivePackage ? null : await getActiveCmsThemePackage(siteId);
  if (activePackage && activePackage.code === themeCode) {
    return {
      siteId,
      siteCode: site.code,
      themeCode,
      mode: 'package',
      activePackage,
      list: packageTemplateOptions(activePackage, 'list'),
      detail: packageTemplateOptions(activePackage, 'detail'),
    };
  }
  if (!isThemeRegistered(themeCode)) {
    return { siteId, siteCode: site.code, themeCode, mode: 'unavailable', activePackage: null, list: [], detail: [] };
  }
  const builtin = listBuiltinThemeTemplates(themeCode);
  const manual = await activeManualTemplates(siteId, themeCode, ['list', 'detail']);
  const list = new Map(builtin.list.map((item) => [item.name, item]));
  const detail = new Map(builtin.detail.map((item) => [item.name, item]));
  for (const template of manual) {
    const target = template.type === 'list' ? list : detail;
    target.set(template.code, { name: template.code, label: template.name });
  }
  return {
    siteId,
    siteCode: site.code,
    themeCode,
    mode: 'builtin',
    activePackage: null,
    list: [...list.values()],
    detail: [...detail.values()],
  };
}

export async function resolveAvailableCmsTemplateNames(
  siteId: number,
  themeCode: string,
  options?: { ignoreActivePackage?: boolean },
) {
  const catalog = await resolveCmsTemplateCatalog(siteId, themeCode, options);
  return {
    themeAvailable: catalog.mode !== 'unavailable',
    list: new Set(catalog.list.map((item) => item.name)),
    detail: new Set(catalog.detail.map((item) => item.name)),
  };
}

async function packageDslTemplate(
  pkg: CmsThemePackageRow,
  siteId: number,
  type: CmsTemplateType,
  code?: string | null,
  assetBaseUrl?: string,
): Promise<CmsResolvedDslTemplate | null> {
  const entry = resolvePackageTemplateEntry(pkg, type, code);
  if (!entry) {
    if (!code && OPTIONAL_PACKAGE_FALLBACK_TYPES.has(type)) return null;
    throw new HTTPException(500, { message: `主题包「${pkg.code}@${pkg.version}」缺少 ${type}${code ? `:${code}` : ''} 模板` });
  }
  const [row] = await db.select({ dsl: cmsTemplateVersions.dsl })
    .from(cmsTemplateVersions)
    .innerJoin(cmsTemplates, eq(cmsTemplateVersions.templateId, cmsTemplates.id))
    .where(and(
      eq(cmsTemplateVersions.themePackageId, pkg.id),
      eq(cmsTemplates.themeCode, pkg.code),
      eq(cmsTemplates.type, type),
      eq(cmsTemplates.code, entry.code),
    ))
    .limit(1);
  if (!row) throw new HTTPException(500, { message: `主题包模板「${entry.code}」版本记录缺失` });
  return {
    dsl: row.dsl,
    assetBaseUrl: assetBaseUrl ?? `/api/public/cms/theme-assets/${siteId}/${encodeURIComponent(pkg.code)}/${encodeURIComponent(pkg.version)}/assets`,
  };
}

async function manualDslTemplate(
  siteId: number,
  themeCode: string,
  type: CmsTemplateType,
  code?: string | null,
): Promise<CmsResolvedDslTemplate | null> {
  const findForScope = async (scopeSiteId: number | null) => {
    const scope: SQL = scopeSiteId == null ? isNull(cmsTemplates.siteId) : eq(cmsTemplates.siteId, scopeSiteId);
    const conditions: SQL[] = [
      scope,
      eq(cmsTemplates.themeCode, themeCode),
      eq(cmsTemplates.type, type),
      eq(cmsTemplates.source, 'manual'),
      eq(cmsTemplates.status, 'enabled'),
      isNotNull(cmsTemplates.activeVersion),
    ];
    if (code) conditions.push(eq(cmsTemplates.code, code));
    const [row] = await db.select({ dsl: cmsTemplateVersions.dsl })
      .from(cmsTemplates)
      .innerJoin(cmsTemplateVersions, and(
        eq(cmsTemplateVersions.templateId, cmsTemplates.id),
        eq(cmsTemplateVersions.version, cmsTemplates.activeVersion),
      ))
      .where(and(...conditions))
      .orderBy(desc(cmsTemplates.id))
      .limit(1);
    return row ?? null;
  };
  const row = (await findForScope(siteId)) ?? await findForScope(null);
  return row ? { dsl: row.dsl, assetBaseUrl: null } : null;
}

export async function resolveActiveCmsDslTemplate(input: {
  siteId: number;
  themeCode: string;
  type: CmsTemplateType;
  templateCode?: string | null;
}): Promise<CmsResolvedDslTemplate | null> {
  const override = renderOverrideStore.getStore();
  if (override?.templateId) {
    const [template] = await db.select().from(cmsTemplates).where(eq(cmsTemplates.id, override.templateId)).limit(1);
    if (!template) throw new HTTPException(404, { message: '模板不存在' });
    if (template.type !== input.type) throw new HTTPException(400, { message: `所选模板类型为 ${template.type}，不能预览 ${input.type} 页面` });
    const versionNo = override.templateVersion ?? template.currentVersion;
    const [version] = await db.select({ dsl: cmsTemplateVersions.dsl }).from(cmsTemplateVersions).where(and(
      eq(cmsTemplateVersions.templateId, template.id),
      eq(cmsTemplateVersions.version, versionNo),
    )).limit(1);
    if (!version) throw new HTTPException(404, { message: `模板版本 v${versionNo} 不存在` });
    return { dsl: version.dsl, assetBaseUrl: null };
  }
  if (override?.packageId) {
    const [pkg] = await db.select().from(cmsThemePackages).where(eq(cmsThemePackages.id, override.packageId)).limit(1);
    if (!pkg || pkg.status !== 'validated' || !pkg.validationReport.valid) {
      throw new HTTPException(400, { message: '预览主题包未通过可信校验或已停用' });
    }
    return packageDslTemplate(pkg, input.siteId, input.type, input.templateCode, override.assetBaseUrl);
  }

  const catalog = await resolveCmsTemplateCatalog(input.siteId, input.themeCode);
  if (catalog.mode === 'package' && catalog.activePackage) {
    return packageDslTemplate(catalog.activePackage, input.siteId, input.type, input.templateCode);
  }
  if (catalog.mode === 'unavailable') {
    throw new HTTPException(500, { message: `站点主题「${input.themeCode}」没有活动的可信主题包，拒绝静默回退` });
  }
  if (input.templateCode) {
    const options = input.type === 'list' ? catalog.list : input.type === 'detail' ? catalog.detail : [];
    if (!options.some((item) => item.name === input.templateCode)) {
      throw new HTTPException(500, { message: `活动主题中不存在 ${input.type}:${input.templateCode}，拒绝与健康检查不一致的静默回退` });
    }
    return manualDslTemplate(input.siteId, input.themeCode, input.type, input.templateCode);
  }
  if (!['list', 'detail'].includes(input.type)) return manualDslTemplate(input.siteId, input.themeCode, input.type);
  return null;
}
