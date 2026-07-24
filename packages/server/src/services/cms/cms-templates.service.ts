import { and, desc, eq, exists, ilike, inArray, isNull, not, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type {
  CmsTemplateDiffItem,
  CmsTemplateDslDocument,
  CmsTemplateType,
  CreateCmsTemplateInput,
  UpdateCmsTemplateInput,
} from '@zenith/shared';
import { db } from '../../db';
import {
  cmsTemplateVersions,
  cmsTemplates,
  type CmsTemplateRow,
  type CmsTemplateVersionRow,
} from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { withPagination, escapeLike } from '../../lib/where-helpers';
import {
  canonicalizeCmsJson,
  collectCmsTemplateDslAssetReferences,
  renderCmsTemplateDsl,
  validateCmsTemplateDsl as validateCmsTemplateDslDocument,
} from '../../cms/templates/dsl';
import { listThemes as listBuiltinThemes } from '../../cms/themes/registry';
import { isCmsPlatformAdmin } from './cms-access';
import {
  assertSiteAccess,
  ensureCmsSiteExists,
  getAccessibleSiteIds,
} from './cms-sites.service';
import {
  getActiveCmsThemePackage,
  resolveActiveCmsDslTemplate,
  resolveCmsTemplateCatalog,
  withCmsRenderOverride,
  type CmsRenderOverride,
} from './cms-template-resolution.service';

type TemplateVersionWithCreator = CmsTemplateVersionRow & {
  createdByUser?: { nickname: string | null; username: string } | null;
};

export function mapCmsTemplate(
  row: CmsTemplateRow,
  effectivePackageVersion?: number | null,
  effectivePackageName?: string,
) {
  const packageSource = row.source === 'package';
  const packageActive = packageSource && Number.isInteger(effectivePackageVersion) && Number(effectivePackageVersion) > 0;
  return {
    id: row.id,
    siteId: row.siteId ?? null,
    themeCode: row.themeCode,
    type: row.type,
    code: row.code,
    name: packageActive && effectivePackageName ? effectivePackageName : row.name,
    source: row.source,
    status: packageSource ? packageActive ? 'enabled' as const : 'disabled' as const : row.status,
    currentVersion: row.currentVersion,
    activeVersion: packageSource ? packageActive ? effectivePackageVersion! : null : row.activeVersion ?? null,
    lifecycleRevision: row.lifecycleRevision,
    description: row.description ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapCmsTemplateVersion(row: TemplateVersionWithCreator) {
  return {
    id: row.id,
    templateId: row.templateId,
    version: row.version,
    dsl: row.dsl,
    checksum: row.checksum,
    changeNote: row.changeNote ?? null,
    themePackageId: row.themePackageId ?? null,
    createdBy: row.createdBy ?? null,
    createdByName: row.createdByUser?.nickname || row.createdByUser?.username || null,
    createdAt: formatDateTime(row.createdAt),
  };
}

async function assertTemplateScopeAccess(siteId: number | null): Promise<void> {
  if (siteId != null) {
    await assertSiteAccess(siteId);
    return;
  }
  if (!isCmsPlatformAdmin()) {
    throw new HTTPException(403, { message: '仅平台超级管理员可管理主题级全局模板' });
  }
}

export async function ensureCmsTemplateExists(id: number): Promise<CmsTemplateRow> {
  const [row] = await db.select().from(cmsTemplates).where(eq(cmsTemplates.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '模板不存在' });
  return row;
}

async function ensureTemplateAccessible(id: number): Promise<CmsTemplateRow> {
  const row = await ensureCmsTemplateExists(id);
  if (row.siteId != null) await assertSiteAccess(row.siteId);
  return row;
}

export interface ListCmsTemplatesQuery {
  page: number;
  pageSize: number;
  siteId?: number;
  themeCode?: string;
  type?: CmsTemplateType;
  status?: 'enabled' | 'disabled';
  keyword?: string;
}

export async function listCmsTemplates(query: ListCmsTemplatesQuery) {
  const conditions: SQL[] = [];
  const activePackage = query.siteId ? await getActiveCmsThemePackage(query.siteId) : null;
  if (query.siteId) {
    await assertSiteAccess(query.siteId);
    conditions.push(or(eq(cmsTemplates.siteId, query.siteId), isNull(cmsTemplates.siteId))!);
  } else if (!isCmsPlatformAdmin()) {
    const accessible = await getAccessibleSiteIds();
    conditions.push(accessible?.length
      ? or(isNull(cmsTemplates.siteId), inArray(cmsTemplates.siteId, accessible))!
      : isNull(cmsTemplates.siteId));
  }
  if (query.themeCode) conditions.push(eq(cmsTemplates.themeCode, query.themeCode));
  if (query.type) conditions.push(eq(cmsTemplates.type, query.type));
  if (query.status) {
    const manualStatus = and(eq(cmsTemplates.source, 'manual'), eq(cmsTemplates.status, query.status))!;
    const packageActive: SQL = activePackage
      ? and(
          eq(cmsTemplates.source, 'package'),
          eq(cmsTemplates.themeCode, activePackage.code),
          exists(
            db.select({ id: cmsTemplateVersions.id }).from(cmsTemplateVersions).where(and(
              eq(cmsTemplateVersions.templateId, cmsTemplates.id),
              eq(cmsTemplateVersions.themePackageId, activePackage.id),
            )),
          ),
        )!
      : sql`false`;
    conditions.push(query.status === 'enabled'
      ? or(manualStatus, packageActive)!
      : or(manualStatus, and(eq(cmsTemplates.source, 'package'), not(packageActive)))!);
  }
  if (query.keyword?.trim()) {
    const keyword = `%${escapeLike(query.keyword.trim())}%`;
    conditions.push(or(ilike(cmsTemplates.name, keyword), ilike(cmsTemplates.code, keyword))!);
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(cmsTemplates, where),
    withPagination(
      db.select().from(cmsTemplates).where(where).orderBy(desc(cmsTemplates.id)).$dynamic(),
      query.page,
      query.pageSize,
    ),
  ]);
  const packageTemplateIds = activePackage
    ? rows.filter((row) => row.source === 'package' && row.themeCode === activePackage.code).map((row) => row.id)
    : [];
  const activePackageVersions = packageTemplateIds.length
    ? await db.select({ templateId: cmsTemplateVersions.templateId, version: cmsTemplateVersions.version })
      .from(cmsTemplateVersions).where(and(
        eq(cmsTemplateVersions.themePackageId, activePackage!.id),
        inArray(cmsTemplateVersions.templateId, packageTemplateIds),
      ))
    : [];
  const packageVersionByTemplate = new Map(activePackageVersions.map((row) => [row.templateId, row.version]));
  const activePackageNameByKey = new Map(
    (activePackage?.manifest.templates ?? []).map((entry) => [`${entry.type}:${entry.code}`, entry.name]),
  );
  return {
    list: rows.map((row) => {
      const packageVersion = packageVersionByTemplate.get(row.id);
      return mapCmsTemplate(row, packageVersion, activePackageNameByKey.get(`${row.type}:${row.code}`));
    }),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getCmsTemplateDetail(id: number) {
  const row = await ensureTemplateAccessible(id);
  const versions = await db.query.cmsTemplateVersions.findMany({
    where: eq(cmsTemplateVersions.templateId, id),
    with: { createdByUser: { columns: { nickname: true, username: true } } },
    orderBy: desc(cmsTemplateVersions.version),
  });
  return { ...mapCmsTemplate(row), versions: versions.map(mapCmsTemplateVersion) };
}

export function validateCmsTemplateDsl(value: unknown) {
  const report = validateCmsTemplateDslDocument(value);
  const assets = report.valid ? [...collectCmsTemplateDslAssetReferences(value)] : [];
  if (!assets.length) return report;
  return {
    ...report,
    valid: false,
    checksum: null,
    issues: [
      ...report.issues,
      {
        path: '$',
        code: 'manual_asset_not_available',
        message: '手工模板没有主题包 asset 上下文；请移除 { asset } 引用，或通过签名主题包导入',
      },
    ],
  };
}

export function ensureValidCmsTemplateDsl(value: unknown): { dsl: CmsTemplateDslDocument; checksum: string } {
  const report = validateCmsTemplateDsl(value);
  if (!report.valid || !report.checksum) {
    throw new HTTPException(400, {
      message: `模板 DSL 校验失败：${report.issues.slice(0, 3).map((item) => `${item.path} ${item.message}`).join('；')}`,
    });
  }
  return { dsl: value as CmsTemplateDslDocument, checksum: report.checksum };
}

export async function createCmsTemplate(data: CreateCmsTemplateInput) {
  const siteId = data.siteId ?? null;
  await assertTemplateScopeAccess(siteId);
  if (siteId != null) await ensureCmsSiteExists(siteId);
  const { dsl, checksum } = ensureValidCmsTemplateDsl(data.dsl);
  try {
    const created = await db.transaction(async (tx) => {
      const [template] = await tx.insert(cmsTemplates).values({
        siteId,
        themeCode: data.themeCode,
        type: data.type,
        code: data.code,
        name: data.name,
        description: data.description ?? null,
        source: 'manual',
        currentVersion: 1,
        activeVersion: null,
      }).returning();
      await tx.insert(cmsTemplateVersions).values({
        templateId: template.id,
        version: 1,
        dsl,
        checksum,
        changeNote: data.changeNote ?? '初始版本',
      });
      return template;
    });
    return getCmsTemplateDetail(created.id);
  } catch (error) {
    rethrowPgUniqueViolation(error, '同一作用域、主题和类型下模板编码已存在');
  }
}

export async function updateCmsTemplate(id: number, data: UpdateCmsTemplateInput) {
  const current = await ensureTemplateAccessible(id);
  await assertTemplateScopeAccess(current.siteId);
  if (current.source === 'package') {
    throw new HTTPException(400, { message: '主题包模板元数据由签名 manifest 管理，禁止手工修改' });
  }
  const [updated] = await db.update(cmsTemplates).set(data).where(eq(cmsTemplates.id, id)).returning();
  return mapCmsTemplate(updated);
}

export async function saveCmsTemplateVersion(id: number, input: { dsl: unknown; changeNote?: string | null }) {
  const current = await ensureTemplateAccessible(id);
  await assertTemplateScopeAccess(current.siteId);
  if (current.source === 'package') {
    throw new HTTPException(400, { message: '主题包模板不可直接编辑，请导入新主题包版本' });
  }
  const { dsl, checksum } = ensureValidCmsTemplateDsl(input.dsl);
  const version = await db.transaction(async (tx) => {
    const [advanced] = await tx.update(cmsTemplates)
      .set({ currentVersion: sql`${cmsTemplates.currentVersion} + 1` })
      .where(eq(cmsTemplates.id, id))
      .returning({ version: cmsTemplates.currentVersion });
    const [created] = await tx.insert(cmsTemplateVersions).values({
      templateId: id,
      version: advanced.version,
      dsl,
      checksum,
      changeNote: input.changeNote ?? null,
    }).returning();
    return created;
  });
  return mapCmsTemplateVersion(version);
}

async function ensureTemplateVersion(templateId: number, version: number): Promise<CmsTemplateVersionRow> {
  const [row] = await db.select().from(cmsTemplateVersions)
    .where(and(eq(cmsTemplateVersions.templateId, templateId), eq(cmsTemplateVersions.version, version)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: `模板版本 v${version} 不存在` });
  return row;
}

function diffJson(before: unknown, after: unknown, path: string, out: CmsTemplateDiffItem[]): void {
  if (canonicalizeCmsJson(before) === canonicalizeCmsJson(after)) return;
  if (
    before && after
    && typeof before === 'object' && typeof after === 'object'
    && !Array.isArray(before) && !Array.isArray(after)
  ) {
    const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
    for (const key of [...keys].sort()) {
      const left = (before as Record<string, unknown>)[key];
      const right = (after as Record<string, unknown>)[key];
      diffJson(left, right, `${path}.${key}`, out);
    }
    return;
  }
  out.push({
    path,
    change: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed',
    before: before ?? null,
    after: after ?? null,
  });
}

export async function diffCmsTemplateVersions(id: number, from: number, to: number) {
  await ensureTemplateAccessible(id);
  const [before, after] = await Promise.all([
    ensureTemplateVersion(id, from),
    ensureTemplateVersion(id, to),
  ]);
  const changes: CmsTemplateDiffItem[] = [];
  diffJson(before.dsl, after.dsl, '$', changes);
  return { templateId: id, from, to, changes };
}


// ─── 运行时模板解析（唯一规则由 cms-template-resolution.service 维护）────────
export async function renderCmsDslTemplateIfConfigured(input: {
  siteId: number;
  themeCode: string;
  type: CmsTemplateType;
  templateCode?: string | null;
  context: Record<string, unknown>;
}): Promise<string | null> {
  const resolved = await resolveActiveCmsDslTemplate(input);
  return resolved
    ? renderCmsTemplateDsl(resolved.dsl, input.context, { assetBaseUrl: resolved.assetBaseUrl })
    : null;
}

export async function isCmsThemeAvailable(themeCode: string, siteId?: number): Promise<boolean> {
  if (!siteId) return false;
  return (await resolveCmsTemplateCatalog(siteId, themeCode)).mode !== 'unavailable';
}

export async function listCmsAvailableThemes(siteId?: number) {
  const merged = new Map(listBuiltinThemes().map((item) => [item.code, item]));
  if (siteId) {
    await assertSiteAccess(siteId);
    const activePackage = await getActiveCmsThemePackage(siteId);
    if (activePackage?.status === 'validated') {
      merged.set(activePackage.code, {
        code: activePackage.code,
        label: `${activePackage.name} ${activePackage.version}`,
      });
    }
  }
  return [...merged.values()];
}

export async function listCmsThemeTemplateOptions(themeCode: string, siteId?: number) {
  if (!siteId) return { list: [], detail: [] };
  await assertSiteAccess(siteId);
  const catalog = await resolveCmsTemplateCatalog(siteId, themeCode);
  return { list: catalog.list, detail: catalog.detail };
}

export {
  getActiveCmsThemePackage,
  resolveCmsTemplateCatalog,
  withCmsRenderOverride,
};
export type { CmsRenderOverride };
