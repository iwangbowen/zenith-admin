import { and, eq, isNotNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  CMS_SECRET_MASK,
  CMS_SITE_INHERITABLE_FIELDS,
  CMS_SITE_MAX_DEPTH,
  type CmsSiteEffectiveConfig,
  type CmsSiteInheritableField,
  type CmsSiteInheritanceFlags,
  type CmsTemplateType,
} from '@zenith/shared';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import {
  cmsSiteInheritances,
  cmsSites,
  cmsThemeDeployments,
  cmsTemplates,
  type CmsSiteInheritanceRow,
  type CmsSiteRow,
} from '../../db/schema';

export const DEFAULT_CMS_SITE_INHERITANCE: CmsSiteInheritanceFlags = {
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

type CmsInheritanceSourceIds = Record<CmsSiteInheritableField, number>;

export interface CmsResolvedSiteSnapshot {
  raw: CmsSiteRow;
  site: CmsSiteRow;
  chain: CmsSiteRow[];
  inheritance: CmsSiteInheritanceFlags;
  sourceSiteIds: CmsInheritanceSourceIds;
}

function flagsFromRow(row: CmsSiteInheritanceRow | undefined): CmsSiteInheritanceFlags {
  if (!row) return { ...DEFAULT_CMS_SITE_INHERITANCE };
  return {
    seoTitle: row.seoTitle,
    seoKeywords: row.seoKeywords,
    seoDescription: row.seoDescription,
    staticMode: row.staticMode,
    reviewMode: row.reviewMode,
    webhook: row.webhook,
    cdn: row.cdn,
    theme: row.theme,
    themeConfig: row.themeConfig,
    templates: row.templates,
  };
}

function cloneSettings(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return structuredClone(value ?? {});
}

function replaceSettingKeys(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    delete target[key];
    if (Object.hasOwn(source, key)) target[key] = structuredClone(source[key]);
  }
}

export function buildCmsSiteChain(rows: readonly CmsSiteRow[], siteId: number): CmsSiteRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const chain: CmsSiteRow[] = [];
  const seen = new Set<number>();
  let current = byId.get(siteId);
  if (!current) throw new HTTPException(404, { message: '站点不存在' });
  while (current) {
    if (seen.has(current.id)) throw new Error(`CMS 站点层级数据存在环：#${current.id}`);
    seen.add(current.id);
    chain.push(current);
    if (chain.length > CMS_SITE_MAX_DEPTH) throw new Error(`CMS 站点层级超过上限 ${CMS_SITE_MAX_DEPTH}`);
    current = current.parentId == null ? undefined : byId.get(current.parentId);
    if (chain.at(-1)?.parentId != null && !current) {
      throw new Error(`CMS 站点 #${chain.at(-1)!.id} 的父站点不存在`);
    }
  }
  return chain;
}

function sourceSiteForField(
  chain: readonly CmsSiteRow[],
  flags: ReadonlyMap<number, CmsSiteInheritanceFlags>,
  field: CmsSiteInheritableField,
): CmsSiteRow {
  let index = 0;
  while (index < chain.length - 1 && (flags.get(chain[index].id) ?? DEFAULT_CMS_SITE_INHERITANCE)[field]) {
    index += 1;
  }
  return chain[index];
}

export function resolveCmsSiteSnapshot(
  rows: readonly CmsSiteRow[],
  inheritanceRows: readonly CmsSiteInheritanceRow[],
  siteId: number,
): CmsResolvedSiteSnapshot {
  const chain = buildCmsSiteChain(rows, siteId);
  const flagMap = new Map(inheritanceRows.map((row) => [row.siteId, flagsFromRow(row)]));
  const inheritance = flagMap.get(siteId) ?? { ...DEFAULT_CMS_SITE_INHERITANCE };
  const sourceSiteIds = Object.fromEntries(CMS_SITE_INHERITABLE_FIELDS.map((field) => [
    field,
    sourceSiteForField(chain, flagMap, field).id,
  ])) as CmsInheritanceSourceIds;
  const sourceByField = Object.fromEntries(CMS_SITE_INHERITABLE_FIELDS.map((field) => [
    field,
    chain.find((row) => row.id === sourceSiteIds[field])!,
  ])) as Record<CmsSiteInheritableField, CmsSiteRow>;

  const settings = cloneSettings(chain[0].settings);
  replaceSettingKeys(settings, cloneSettings(sourceByField.reviewMode.settings), [
    'auditMode',
    'auditWorkflowDefinitionId',
  ]);
  replaceSettingKeys(settings, cloneSettings(sourceByField.webhook.settings), [
    'webhookUrl',
    'webhookSecret',
  ]);
  replaceSettingKeys(settings, cloneSettings(sourceByField.cdn.settings), [
    'cdnPurgeUrl',
    'cdnPurgeToken',
  ]);
  replaceSettingKeys(settings, cloneSettings(sourceByField.themeConfig.settings), [
    'themeConfig',
    'themePrimary',
    'themeDark',
  ]);
  replaceSettingKeys(settings, cloneSettings(sourceByField.templates.settings), ['defaultTemplates']);

  return {
    raw: chain[0],
    site: {
      ...chain[0],
      title: sourceByField.seoTitle.title,
      keywords: sourceByField.seoKeywords.keywords,
      description: sourceByField.seoDescription.description,
      staticMode: sourceByField.staticMode.staticMode,
      theme: sourceByField.theme.theme,
      settings,
    },
    chain,
    inheritance,
    sourceSiteIds,
  };
}

export function buildCmsTemplateScopeChain(
  rows: readonly CmsSiteRow[],
  inheritanceRows: readonly CmsSiteInheritanceRow[],
  siteId: number,
): number[] {
  const chain = buildCmsSiteChain(rows, siteId);
  const flagMap = new Map(inheritanceRows.map((row) => [row.siteId, flagsFromRow(row)]));
  const result = [chain[0].id];
  let index = 0;
  while (index < chain.length - 1 && (flagMap.get(chain[index].id) ?? DEFAULT_CMS_SITE_INHERITANCE).templates) {
    index += 1;
    result.push(chain[index].id);
  }
  return result;
}

export function listCmsSubtreeIds(rows: readonly Pick<CmsSiteRow, 'id' | 'parentId'>[], rootId: number): number[] {
  const children = new Map<number, number[]>();
  for (const row of rows) {
    if (row.parentId == null) continue;
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
  }
  const result: number[] = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    result.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return result;
}

export async function loadCmsInheritanceState(executor: DbExecutor = db) {
  const [sites, inheritances] = await Promise.all([
    executor.select().from(cmsSites),
    executor.select().from(cmsSiteInheritances),
  ]);
  return { sites, inheritances };
}

export async function resolveEffectiveCmsSite(
  siteId: number,
  executor: DbExecutor = db,
): Promise<CmsResolvedSiteSnapshot> {
  const state = await loadCmsInheritanceState(executor);
  return resolveCmsSiteSnapshot(state.sites, state.inheritances, siteId);
}

export async function resolveEffectiveCmsSiteRow(
  siteId: number,
  executor: DbExecutor = db,
): Promise<CmsSiteRow> {
  return (await resolveEffectiveCmsSite(siteId, executor)).site;
}

export async function getCmsEffectiveThemeDeployment(siteId: number, executor: DbExecutor = db) {
  const resolved = await resolveEffectiveCmsSite(siteId, executor);
  const themeSourceSiteId = resolved.sourceSiteIds.theme;
  const deployment = await executor.query.cmsThemeDeployments.findFirst({
    where: and(
      eq(cmsThemeDeployments.siteId, themeSourceSiteId),
      eq(cmsThemeDeployments.status, 'active'),
    ),
    with: { themePackage: true },
  });
  return { resolved, themeSourceSiteId, deployment: deployment ?? null };
}

export async function listCmsInheritanceAffectedSiteIds(
  sourceSiteId: number,
  field: CmsSiteInheritableField,
  executor: DbExecutor = db,
  options: { includeSource?: boolean; enabledOnly?: boolean } = {},
): Promise<number[]> {
  const state = await loadCmsInheritanceState(executor);
  const ids = state.sites
    .filter((row) => options.enabledOnly === false || row.status === 'enabled')
    .filter((row) => {
      const snapshot = resolveCmsSiteSnapshot(state.sites, state.inheritances, row.id);
      return snapshot.sourceSiteIds[field] === sourceSiteId
        && (options.includeSource !== false || row.id !== sourceSiteId);
    })
    .map((row) => row.id);
  return [...new Set(ids)].sort((a, b) => a - b);
}

export async function listCmsTemplateAffectedSiteIds(
  scopeSiteId: number | null,
  themeCode: string,
  executor: DbExecutor = db,
  template?: { type: CmsTemplateType; code: string },
): Promise<number[]> {
  const state = await loadCmsInheritanceState(executor);
  const matchingSiteIds = template
    ? new Set((await executor.select({ siteId: cmsTemplates.siteId }).from(cmsTemplates).where(and(
        eq(cmsTemplates.themeCode, themeCode),
        eq(cmsTemplates.type, template.type),
        eq(cmsTemplates.code, template.code),
        eq(cmsTemplates.source, 'manual'),
        eq(cmsTemplates.status, 'enabled'),
        isNotNull(cmsTemplates.activeVersion),
      ))).map((row) => row.siteId))
    : null;
  return state.sites
    .filter((row) => row.status === 'enabled')
    .filter((row) => {
      const snapshot = resolveCmsSiteSnapshot(state.sites, state.inheritances, row.id);
      if (snapshot.site.theme !== themeCode) return false;
      const scopeChain = buildCmsTemplateScopeChain(state.sites, state.inheritances, row.id);
      const scopeIndex = scopeSiteId == null ? scopeChain.length : scopeChain.indexOf(scopeSiteId);
      if (scopeIndex < 0) return false;
      if (matchingSiteIds && scopeChain.slice(0, scopeIndex).some((siteId) => matchingSiteIds.has(siteId))) {
        return false;
      }
      return true;
    })
    .map((row) => row.id)
    .sort((a, b) => a - b);
}

function secretMask(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? CMS_SECRET_MASK : null;
}

export async function getCmsSiteEffectiveConfig(
  siteId: number,
  visibleSiteIds: number[] | null,
): Promise<CmsSiteEffectiveConfig> {
  const snapshot = await resolveEffectiveCmsSite(siteId);
  const visible = visibleSiteIds == null ? null : new Set(visibleSiteIds);
  const sourceRows = new Map(snapshot.chain.map((row) => [row.id, row]));
  const visibleSource = (field: CmsSiteInheritableField) => {
    const sourceId = snapshot.sourceSiteIds[field];
    const source = sourceRows.get(sourceId)!;
    const allowed = visible == null || visible.has(sourceId);
    return {
      kind: sourceId === siteId ? 'own' as const : 'inherited' as const,
      siteId: allowed ? sourceId : null,
      siteName: allowed ? source.name : null,
    };
  };
  const settings = snapshot.site.settings as Record<string, unknown>;
  const { deployment, themeSourceSiteId } = await getCmsEffectiveThemeDeployment(siteId);
  const chainRootFirst = [...snapshot.chain].reverse();
  return {
    siteId,
    chain: chainRootFirst
      .filter((row) => visible == null || visible.has(row.id))
      .map((row, index) => ({ id: row.id, name: row.name, code: row.code, depth: index + 1 })),
    inheritance: snapshot.inheritance,
    resolved: {
      title: snapshot.site.title,
      keywords: snapshot.site.keywords,
      description: snapshot.site.description,
      staticMode: snapshot.site.staticMode,
      auditMode: settings.auditMode === 'workflow' ? 'workflow' : 'simple',
      auditWorkflowDefinitionId: Number.isInteger(Number(settings.auditWorkflowDefinitionId))
        ? Number(settings.auditWorkflowDefinitionId)
        : null,
      webhookUrl: typeof settings.webhookUrl === 'string' && settings.webhookUrl ? settings.webhookUrl : null,
      webhookSecret: secretMask(settings.webhookSecret),
      cdnPurgeUrl: typeof settings.cdnPurgeUrl === 'string' && settings.cdnPurgeUrl ? settings.cdnPurgeUrl : null,
      cdnPurgeToken: secretMask(settings.cdnPurgeToken),
      theme: snapshot.site.theme,
      themeSourceSiteId: visible == null || visible.has(themeSourceSiteId) ? themeSourceSiteId : null,
      activeThemeDeploymentId: deployment?.id ?? null,
      activeThemePackageId: deployment?.themePackageId ?? null,
      activeThemePackageVersion: deployment?.themePackage.version ?? null,
      themeConfig: settings.themeConfig && typeof settings.themeConfig === 'object'
        ? structuredClone(settings.themeConfig as Record<string, unknown>)
        : {},
      defaultTemplates: settings.defaultTemplates && typeof settings.defaultTemplates === 'object'
        ? structuredClone(settings.defaultTemplates as Record<string, never>)
        : {},
    },
    sources: Object.fromEntries(CMS_SITE_INHERITABLE_FIELDS.map((field) => [
      field,
      visibleSource(field),
    ])) as CmsSiteEffectiveConfig['sources'],
  };
}
