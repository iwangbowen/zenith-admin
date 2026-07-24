import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, rename, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CmsThemePackageManifest, CmsThemePackageValidationReport } from '@zenith/shared';
import { CMS_PUBLISH_TASK_TYPES } from '@zenith/shared';
import { db } from '../../db';
import {
  asyncTasks,
  cmsChannels,
  cmsContents,
  cmsPages,
  cmsSites,
  cmsTemplateVersions,
  cmsTemplates,
  cmsThemeDeployments,
  cmsThemePackages,
  type CmsThemePackageRow,
} from '../../db/schema';
import { config } from '../../config';
import { formatDateTime } from '../../lib/datetime';
import { escapeLike, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { mapAsyncTask, registerTaskHandler, submitAsyncTask } from '../../lib/task-center';
import { currentUser, hasPermission, runWithCurrentUser } from '../../lib/context';
import { assertSiteAccess, assertSitesAccess } from './cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { getSiteTemplateHealth } from './cms-template-refs.service';
import { renderSearchPage, renderSitePath } from './cms-render.service';
import { withCmsRenderOverride } from './cms-templates.service';
import {
  assertCmsThemeTrustedKeysConfigured,
  CMS_THEME_PACKAGE_LIMITS,
  normalizeCmsThemePackagePath,
  isCmsThemeAssetDeploymentMatch,
  signCmsThemePackageManifest,
  validateCmsThemeAsset,
  validateCmsThemePackageArchive,
} from './cms-theme-package-security';
import { validateCmsTemplateDsl } from '../../cms/templates/dsl';
import { packageTemplateOptions } from './cms-template-resolution.service';
import {
  getCmsEffectiveThemeDeployment,
  listCmsInheritanceAffectedSiteIds,
  resolveEffectiveCmsSite,
  resolveEffectiveCmsSiteRow,
} from './cms-site-inheritance.service';
import {
  createCmsThemePreviewAssetBaseUrl,
  verifyCmsThemePreviewAssetToken,
} from './cms-theme-preview-token';

export const CMS_THEME_STORAGE_ROOT = config.cmsThemes.storageRoot
  ? path.resolve(config.cmsThemes.storageRoot)
  : path.resolve(process.cwd(), 'storage/cms-themes');
const INBOX_ROOT = path.resolve(CMS_THEME_STORAGE_ROOT, '.inbox');

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolveThemeStoragePath(...segments: string[]): string {
  const target = path.resolve(CMS_THEME_STORAGE_ROOT, ...segments);
  if (!isWithin(CMS_THEME_STORAGE_ROOT, target)) throw new Error('CMS 主题存储路径越界');
  return target;
}

function packageStorageKey(code: string, version: string): string {
  if (!/^[a-z][a-z0-9-]{0,49}$/.test(code) || !/^[0-9A-Za-z.-]{1,64}$/.test(version)) {
    throw new Error('主题 code/version 存储路径格式无效');
  }
  return `${code}/${version}`;
}

function mapThemePackage(row: CmsThemePackageRow, activeSiteIds: number[]) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    version: row.version,
    engineMin: row.engineMin,
    engineMax: row.engineMax,
    signingKeyId: row.signingKeyId,
    archiveChecksum: row.archiveChecksum,
    status: row.status,
    manifest: row.manifest,
    validationReport: row.validationReport,
    activeSiteIds,
    exportAvailable: Boolean(config.cmsThemes.signingKeyId && config.cmsThemes.signingPrivateKey),
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function activeSiteIdsByPackage(ids: number[]): Promise<Map<number, number[]>> {
  if (!ids.length) return new Map();
  const rows = await db.select({
    packageId: cmsThemeDeployments.themePackageId,
    siteId: cmsThemeDeployments.siteId,
  }).from(cmsThemeDeployments).where(and(
    inArray(cmsThemeDeployments.themePackageId, ids),
    eq(cmsThemeDeployments.status, 'active'),
  ));
  const result = new Map<number, number[]>();
  for (const row of rows) {
    const affected = await listCmsInheritanceAffectedSiteIds(row.siteId, 'theme');
    result.set(row.packageId, [...new Set([...(result.get(row.packageId) ?? []), ...affected])]);
  }
  return result;
}

export interface ListCmsThemePackagesQuery {
  page: number;
  pageSize: number;
  keyword?: string;
  code?: string;
  status?: 'validated' | 'disabled';
}

export async function listCmsThemePackages(query: ListCmsThemePackagesQuery) {
  const conditions: SQL[] = [];
  if (query.code) conditions.push(eq(cmsThemePackages.code, query.code));
  if (query.status) conditions.push(eq(cmsThemePackages.status, query.status));
  if (query.keyword?.trim()) {
    const keyword = `%${escapeLike(query.keyword.trim())}%`;
    conditions.push(sql`(${cmsThemePackages.code} ilike ${keyword} or ${cmsThemePackages.name} ilike ${keyword} or ${cmsThemePackages.version} ilike ${keyword})`);
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(cmsThemePackages, where),
    withPagination(
      db.select().from(cmsThemePackages).where(where)
        .orderBy(asc(cmsThemePackages.code), desc(cmsThemePackages.createdAt)).$dynamic(),
      query.page,
      query.pageSize,
    ),
  ]);
  const active = await activeSiteIdsByPackage(rows.map((row) => row.id));
  return {
    list: rows.map((row) => mapThemePackage(row, active.get(row.id) ?? [])),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function ensureCmsThemePackageExists(id: number): Promise<CmsThemePackageRow> {
  const [row] = await db.select().from(cmsThemePackages).where(eq(cmsThemePackages.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '主题包版本不存在' });
  return row;
}

export async function getCmsThemePackage(id: number) {
  const row = await ensureCmsThemePackageExists(id);
  const active = await activeSiteIdsByPackage([id]);
  return mapThemePackage(row, active.get(id) ?? []);
}

export function validateCmsThemePackage(buffer: Buffer): CmsThemePackageValidationReport {
  return validateCmsThemePackageArchive(
    buffer,
    config.cmsThemes.trustedPublicKeys,
    config.cmsThemes.engineVersion,
  ).report;
}

async function writePackageFiles(root: string, files: Map<string, Buffer>): Promise<void> {
  for (const [name, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const normalized = normalizeCmsThemePackagePath(name);
    const target = path.resolve(root, normalized);
    if (!isWithin(root, target)) throw new Error(`主题文件路径越界：${normalized}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { flag: 'wx' });
  }
}

async function importValidatedPackage(buffer: Buffer) {
  const parsed = validateCmsThemePackageArchive(
    buffer,
    config.cmsThemes.trustedPublicKeys,
    config.cmsThemes.engineVersion,
  );
  if (!parsed.report.valid || !parsed.report.manifest) {
    throw new HTTPException(400, { message: parsed.report.issues[0]?.message ?? '主题包校验失败' });
  }
  const manifest = parsed.report.manifest;
  const [existing] = await db.select().from(cmsThemePackages)
    .where(and(eq(cmsThemePackages.code, manifest.code), eq(cmsThemePackages.version, manifest.version)))
    .limit(1);
  if (existing) {
    if (existing.archiveChecksum !== parsed.report.archiveChecksum) {
      throw new HTTPException(400, { message: `主题 ${manifest.code}@${manifest.version} 已存在且内容校验和不同` });
    }
    return existing;
  }

  const storageKey = packageStorageKey(manifest.code, manifest.version);
  const finalDir = resolveThemeStoragePath(...storageKey.split('/'));
  const stagingDir = resolveThemeStoragePath(`.staging-${randomUUID()}`);
  let moved = false;
  try {
    await mkdir(stagingDir, { recursive: false });
    await writePackageFiles(stagingDir, parsed.files);
    try {
      await stat(finalDir);
      throw new HTTPException(409, { message: '主题存储目录已存在，请清理孤立目录后重试' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const codeDir = path.dirname(finalDir);
    await mkdir(codeDir, { recursive: true });
    const codeDirStat = await lstat(codeDir);
    if (!codeDirStat.isDirectory() || codeDirStat.isSymbolicLink()) {
      throw new HTTPException(409, { message: '主题存储 code 目录不是安全的普通目录' });
    }
    await rename(stagingDir, finalDir);
    moved = true;

    return await db.transaction(async (tx) => {
      const [pkg] = await tx.insert(cmsThemePackages).values({
        code: manifest.code,
        name: manifest.name,
        version: manifest.version,
        engineMin: manifest.engine.min,
        engineMax: manifest.engine.max,
        signingKeyId: manifest.signingKeyId,
        archiveChecksum: parsed.report.archiveChecksum,
        manifest,
        validationReport: parsed.report,
        storageKey,
        status: 'validated',
      }).returning();

      for (const entry of manifest.templates) {
        const [current] = await tx.select().from(cmsTemplates).where(and(
          isNull(cmsTemplates.siteId),
          eq(cmsTemplates.themeCode, manifest.code),
          eq(cmsTemplates.type, entry.type),
          eq(cmsTemplates.code, entry.code),
        )).limit(1);
        if (current?.source === 'manual') {
          throw new HTTPException(409, { message: `主题包模板 ${entry.type}:${entry.code} 与手工模板冲突` });
        }
        let template = current;
        if (template) {
          [template] = await tx.update(cmsTemplates).set({
            name: entry.name,
            source: 'package',
            status: 'disabled',
            activeVersion: null,
            currentVersion: sql`${cmsTemplates.currentVersion} + 1`,
          }).where(eq(cmsTemplates.id, template.id)).returning();
        } else {
          [template] = await tx.insert(cmsTemplates).values({
            siteId: null,
            themeCode: manifest.code,
            type: entry.type,
            code: entry.code,
            name: entry.name,
            source: 'package',
            status: 'disabled',
            currentVersion: 1,
            activeVersion: null,
            description: `${manifest.name} ${manifest.version} 导入模板`,
          }).returning();
        }
        const dsl = JSON.parse(parsed.files.get(entry.path)!.toString('utf8'));
        await tx.insert(cmsTemplateVersions).values({
          templateId: template.id,
          version: template.currentVersion,
          dsl,
          checksum: manifest.checksums[entry.path],
          changeNote: `主题包 ${manifest.code}@${manifest.version}`,
          themePackageId: pkg.id,
        });
      }
      return pkg;
    });
  } catch (error) {
    if (moved) await rm(finalDir, { recursive: true, force: true }).catch(() => undefined);
    rethrowPgUniqueViolation(error, '主题包 code/version 或内容校验和已存在');
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function inboxPath(uploadId: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/.test(uploadId)) throw new Error('主题包上传标识无效');
  await mkdir(INBOX_ROOT, { recursive: true });
  const target = path.resolve(INBOX_ROOT, `${uploadId}.zip`);
  if (!isWithin(CMS_THEME_STORAGE_ROOT, target) || !isWithin(INBOX_ROOT, target)) throw new Error('主题包上传路径越界');
  return target;
}

export async function submitCmsThemeImport(file: File) {
  try {
    assertCmsThemeTrustedKeysConfigured(config.cmsThemes.trustedPublicKeys);
  } catch (error) {
    throw new HTTPException(503, { message: error instanceof Error ? error.message : '主题包导入未配置' });
  }
  if (file.size <= 0 || file.size > CMS_THEME_PACKAGE_LIMITS.maxArchiveBytes) {
    throw new HTTPException(400, { message: '主题包必须是 1B-10MB 的 ZIP 文件' });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const report = validateCmsThemePackage(buffer);
  if (!report.valid || !report.manifest) {
    throw new HTTPException(400, { message: report.issues[0]?.message ?? '主题包校验失败' });
  }
  const baseIdempotencyKey = `cms-theme-import:${report.archiveChecksum}`;
  const [latest] = await db.select().from(asyncTasks).where(and(
    eq(asyncTasks.taskType, 'cms-theme-import'),
    or(
      eq(asyncTasks.idempotencyKey, baseIdempotencyKey),
      sql`${asyncTasks.payload}->>'archiveChecksum' = ${report.archiveChecksum}`,
    ),
  )).orderBy(desc(asyncTasks.id)).limit(1);
  if (latest && ['pending', 'running', 'success'].includes(latest.status)) {
    return mapAsyncTask(latest);
  }
  const uploadId = randomUUID();
  const target = await inboxPath(uploadId);
  await writeFile(target, buffer, { flag: 'wx' });
  const user = currentUser();
  let task: Awaited<ReturnType<typeof submitAsyncTask>>;
  try {
    task = await runWithCurrentUser({ ...user, tenantId: null, viewingTenantId: undefined }, () =>
      submitAsyncTask({
        taskType: 'cms-theme-import',
        title: `导入 CMS 主题包（${report.manifest!.code}@${report.manifest!.version}）`,
        payload: {
          uploadId,
          code: report.manifest!.code,
          version: report.manifest!.version,
          archiveChecksum: report.archiveChecksum,
        },
        idempotencyKey: latest ? `${baseIdempotencyKey}:retry:${latest.id}` : baseIdempotencyKey,
      }));
  } catch (error) {
    await rm(target, { force: true }).catch(() => undefined);
    throw error;
  }
  if ((task.payload as { uploadId?: string }).uploadId !== uploadId) {
    await rm(target, { force: true }).catch(() => undefined);
  }
  return mapAsyncTask(task);
}

export function registerCmsThemeTaskHandler(): void {
  registerTaskHandler({
    taskType: 'cms-theme-import',
    title: 'CMS 签名主题包导入',
    module: 'CMS内容管理',
    description: '校验 Ed25519 签名、ZIP 安全边界、DSL 与静态资源后原子导入主题版本。',
    allowConcurrent: true,
    maxAttempts: 2,
    retryDelayMs: 5000,
    async run(ctx) {
      if (!(await hasPermission('cms:theme:import'))) {
        throw new Error('主题包导入任务创建者的 cms:theme:import 权限已失效');
      }
      const uploadId = String((ctx.payload as { uploadId?: string }).uploadId ?? '');
      const target = await inboxPath(uploadId);
      try {
        await ctx.progress({ processed: 0, total: 3, note: '读取并校验签名主题包', checkpoint: { phase: 'validate' } });
        const buffer = await readFile(target);
        const parsed = validateCmsThemePackageArchive(buffer, config.cmsThemes.trustedPublicKeys, config.cmsThemes.engineVersion);
        await ctx.reportItems(parsed.report.issues.length
          ? parsed.report.issues.map((item, index) => ({ key: `validation-${index}`, label: item.path, status: 'failed' as const, message: item.message }))
          : [{ key: 'signature', label: 'Ed25519 签名与完整性', status: 'success', message: '验证通过' }]);
        if (!parsed.report.valid || !parsed.report.manifest) {
          await rm(target, { force: true }).catch(() => undefined);
          throw new Error(parsed.report.issues[0]?.message ?? '主题包校验失败');
        }
        await ctx.progress({ processed: 1, total: 3, note: '写入受限主题存储', checkpoint: { phase: 'storage' } });
        const pkg = await importValidatedPackage(buffer);
        for (const template of parsed.report.manifest.templates) {
          await ctx.reportItems([{ key: `template:${template.type}:${template.code}`, label: template.name, status: 'success', message: 'DSL 模板已导入' }]);
        }
        await ctx.progress({ processed: 3, total: 3, note: '主题包导入完成', checkpoint: { phase: 'done', packageId: pkg.id } });
        await rm(target, { force: true }).catch(() => undefined);
        return { packageId: pkg.id, code: pkg.code, version: pkg.version };
      } catch (error) {
        if (ctx.attempt >= 2) await rm(target, { force: true }).catch(() => undefined);
        throw error;
      }
    },
  });
}

export async function previewCmsThemePackage(packageId: number, siteId: number, rawPath: string) {
  await assertSiteAccess(siteId);
  await assertAllCmsSiteChannelsAccess(siteId);
  const pkg = await ensureCmsThemePackageExists(packageId);
  if (pkg.status !== 'validated' || !pkg.validationReport.valid) {
    throw new HTTPException(400, { message: '主题包未通过可信校验或已停用，不能预览' });
  }
  const site = await resolveEffectiveCmsSiteRow(siteId);
  const assetBaseUrl = createCmsThemePreviewAssetBaseUrl(siteId, packageId, config.jwtSecret);
  const result = await withCmsRenderOverride({ packageId, assetBaseUrl }, () => renderSitePath(site, `/__cms/${site.code}`, rawPath));
  if (result.status === 302) throw new HTTPException(400, { message: '该预览路径返回重定向，无法内嵌预览' });
  return { html: result.html, status: result.status };
}

export async function previewCmsTemplate(templateId: number, siteId: number, rawPath: string, version?: number) {
  await assertSiteAccess(siteId);
  await assertAllCmsSiteChannelsAccess(siteId);
  const [template] = await db.select({ siteId: cmsTemplates.siteId, type: cmsTemplates.type, source: cmsTemplates.source }).from(cmsTemplates)
    .where(eq(cmsTemplates.id, templateId)).limit(1);
  if (!template) throw new HTTPException(404, { message: '模板不存在' });
  if (template.source === 'package') {
    throw new HTTPException(400, { message: '主题包模板必须通过对应主题包版本预览，不能脱离 deployment/package 上下文单独预览' });
  }
  if (template.siteId != null) {
    await assertSiteAccess(template.siteId);
    if (template.siteId !== siteId) throw new HTTPException(400, { message: '站点级模板只能在所属站点预览' });
  }
  const site = await resolveEffectiveCmsSiteRow(siteId);
  if (template.type === 'layout' || template.type === 'block') {
    throw new HTTPException(400, { message: `${template.type} 模板没有独立页面上下文，请通过引用它的页面预览` });
  }
  const result = await withCmsRenderOverride({ templateId, templateVersion: version }, () =>
    template.type === 'search'
      ? renderSearchPage(site, `/__cms/${site.code}`, '模板预览', 1)
      : renderSitePath(site, `/__cms/${site.code}`, rawPath));
  if (result.status === 302) throw new HTTPException(400, { message: '该预览路径返回重定向，无法内嵌预览' });
  return { html: result.html, status: result.status };
}

export async function getCmsThemeImpact(siteId: number, themeCode?: string, packageId?: number) {
  const site = await resolveEffectiveCmsSiteRow(siteId);
  await assertSiteAccess(siteId);
  const inheritanceSnapshot = await resolveEffectiveCmsSite(siteId);
  const affectedSiteIds = inheritanceSnapshot.sourceSiteIds.theme === siteId
    ? await listCmsInheritanceAffectedSiteIds(siteId, 'theme')
    : [siteId];
  await assertSitesAccess(affectedSiteIds);
  for (const affectedId of affectedSiteIds) await assertAllCmsSiteChannelsAccess(affectedId);
  const targetPackage = packageId ? await ensureCmsThemePackageExists(packageId) : null;
  const code = targetPackage?.code ?? themeCode ?? site.theme;
  const healthReports = await Promise.all(affectedSiteIds.map((affectedId) => targetPackage
    ? getSiteTemplateHealth(affectedId, code, {
      list: packageTemplateOptions(targetPackage, 'list').map((item) => item.name),
      detail: packageTemplateOptions(targetPackage, 'detail').map((item) => item.name),
      themeAvailable: targetPackage.status === 'validated' && targetPackage.validationReport.valid,
    })
    : getSiteTemplateHealth(affectedId, code)));
  const { deployment: active } = await getCmsEffectiveThemeDeployment(siteId);
  const [siteRows, affectedChannels, affectedContents, affectedPages, pendingRebuildTasks] = await Promise.all([
    db.select({ id: cmsSites.id, name: cmsSites.name }).from(cmsSites).where(inArray(cmsSites.id, affectedSiteIds)),
    db.$count(cmsChannels, and(inArray(cmsChannels.siteId, affectedSiteIds), eq(cmsChannels.status, 'enabled'))),
    db.$count(cmsContents, and(
      inArray(cmsContents.siteId, affectedSiteIds),
      eq(cmsContents.status, 'published'),
      isNull(cmsContents.deletedAt),
    )),
    db.$count(cmsPages, and(inArray(cmsPages.siteId, affectedSiteIds), eq(cmsPages.status, 'enabled'))),
    db.$count(asyncTasks, and(
      inArray(asyncTasks.taskType, [...CMS_PUBLISH_TASK_TYPES]),
      inArray(asyncTasks.status, ['pending', 'running']),
      sql`(
        ${asyncTasks.payload}->>'siteId' in (${sql.join(affectedSiteIds.map((id) => sql`${String(id)}`), sql`, `)})
        or exists (
          select 1 from jsonb_array_elements_text(coalesce(${asyncTasks.payload}->'siteIds', '[]'::jsonb)) value
          where value in (${sql.join(affectedSiteIds.map((id) => sql`${String(id)}`), sql`, `)})
        )
      )`,
    )),
  ]);
  const invalidRefs = healthReports.flatMap((health, index) => health.invalidRefs.map((ref) => ({
    ...ref,
    location: affectedSiteIds.length > 1 ? `站点 #${affectedSiteIds[index]} ${ref.location}` : ref.location,
  })));
  return {
    siteId,
    affectedSiteIds,
    affectedSiteNames: affectedSiteIds.map((id) => siteRows.find((row) => row.id === id)?.name ?? `#${id}`),
    themeCode: code,
    themeAvailable: healthReports.every((health) => health.themeRegistered),
    activePackageId: active?.themePackageId ?? null,
    activePackageVersion: active?.themePackage.version ?? null,
    evaluatedPackageId: targetPackage?.id ?? active?.themePackageId ?? null,
    evaluatedPackageVersion: targetPackage?.version ?? active?.themePackage.version ?? null,
    invalidRefs,
    affectedChannels,
    affectedContents,
    affectedPages,
    pendingRebuildTasks,
    estimatedPaths: 1 + affectedChannels + affectedContents + affectedPages + 3,
    ranges: ['/', '/{channel}/', '/{channel}/{content}.html', '/p/{page}/', '/sitemap.xml', '/rss.xml', '/robots.txt'],
  };
}

async function readDeclaredStoredFiles(pkg: CmsThemePackageRow): Promise<Map<string, Buffer>> {
  const root = resolveThemeStoragePath(...pkg.storageKey.split('/'));
  const result = new Map<string, Buffer>();
  const declared = [
    ...pkg.manifest.templates.map((entry) => entry.path),
    ...pkg.manifest.assets,
  ];
  const declaredAssets = new Set(pkg.manifest.assets);
  for (const rawName of declared) {
    const name = normalizeCmsThemePackagePath(rawName);
    const target = path.resolve(root, name);
    if (!isWithin(root, target)) throw new Error('主题存储读取越界');
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`主题存储文件类型无效：${name}`);
    const content = await readFile(target);
    if (name.startsWith('templates/')) {
      let dsl: unknown;
      try {
        dsl = JSON.parse(content.toString('utf8'));
      } catch {
        throw new Error(`存储模板 ${name} 不是有效 JSON`);
      }
      const report = validateCmsTemplateDsl(dsl);
      if (!report.valid) throw new Error(`存储模板 ${name} 校验失败：${report.issues[0]?.message ?? '未知错误'}`);
    } else {
      validateCmsThemeAsset(name, content, declaredAssets);
    }
    result.set(name, content);
  }
  return result;
}

export async function exportSignedCmsThemePackage(id: number): Promise<{ buffer: Buffer; filename: string }> {
  const pkg = await ensureCmsThemePackageExists(id);
  if (!pkg.validationReport.valid) {
    throw new HTTPException(400, { message: '主题包没有可信的成功校验报告，拒绝签名导出' });
  }
  if (!config.cmsThemes.signingKeyId || !config.cmsThemes.signingPrivateKey) {
    throw new HTTPException(503, { message: '未配置 CMS_THEME_SIGNING_KEY_ID/CMS_THEME_SIGNING_PRIVATE_KEY，签名导出不可用' });
  }
  const files = await readDeclaredStoredFiles(pkg);
  const checksums = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, content]) => [
    name,
    createHash('sha256').update(content).digest('hex'),
  ]));
  const unsigned: Omit<CmsThemePackageManifest, 'signature' | 'signingKeyId'> = {
    ...pkg.manifest,
    checksums,
  };
  const manifest = signCmsThemePackageManifest(
    unsigned,
    config.cmsThemes.signingKeyId,
    config.cmsThemes.signingPrivateKey,
  );
  const { ZipArchive } = await import('archiver');
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<void>((resolve, reject) => {
    output.on('end', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(output);
  archive.append(Buffer.from(JSON.stringify(manifest, null, 2)), { name: 'manifest.json' });
  for (const [name, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    archive.append(content, { name });
  }
  await archive.finalize();
  await completed;
  return { buffer: Buffer.concat(chunks), filename: `${pkg.code}-${pkg.version}.zip` };
}

export async function readCmsThemeAsset(siteId: number, code: string, version: string, assetPath: string) {
  if (!Number.isInteger(siteId) || siteId <= 0) throw new HTTPException(404, { message: '主题资源不存在' });
  let normalized: string;
  try {
    normalized = normalizeCmsThemePackagePath(`assets/${assetPath}`).slice('assets/'.length);
  } catch {
    throw new HTTPException(400, { message: '主题资源路径格式无效' });
  }
  const { resolved, deployment } = await getCmsEffectiveThemeDeployment(siteId);
  const pkg = deployment?.themePackage;
  if (!resolved.chain.every((site) => site.status === 'enabled') || !deployment || !pkg || !isCmsThemeAssetDeploymentMatch({
    siteId: deployment.siteId,
    siteTheme: resolved.site.theme,
    deploymentSiteId: deployment.siteId,
    deploymentThemeCode: deployment.themeCode,
    deploymentStatus: deployment.status,
    packageCode: pkg.code,
    packageVersion: pkg.version,
    packageStatus: pkg.status,
    packageValidationPassed: pkg.validationReport.valid,
    requestedCode: code,
    requestedVersion: version,
  }) || !pkg.manifest.assets.includes(`assets/${normalized}`)) {
    throw new HTTPException(404, { message: '主题资源不存在' });
  }
  const root = resolveThemeStoragePath(...pkg.storageKey.split('/'));
  const target = path.resolve(root, 'assets', normalized);
  if (!isWithin(root, target)) throw new HTTPException(400, { message: '主题资源路径越界' });
  const content = await readFile(target).catch(() => null);
  if (!content) throw new HTTPException(404, { message: '主题资源不存在' });
  const ext = path.extname(normalized).toLowerCase();
  const contentType = {
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }[ext] ?? 'application/octet-stream';
  return { content, contentType };
}

export async function readCmsThemePreviewAsset(
  siteId: number,
  packageId: number,
  expiresAt: number,
  token: string,
  assetPath: string,
) {
  if (!verifyCmsThemePreviewAssetToken(siteId, packageId, expiresAt, token, config.jwtSecret)) {
    throw new HTTPException(404, { message: '主题预览资源不存在或已过期' });
  }
  const [pkg] = await db.select().from(cmsThemePackages).where(eq(cmsThemePackages.id, packageId)).limit(1);
  if (!pkg || pkg.status !== 'validated' || !pkg.validationReport.valid) {
    throw new HTTPException(404, { message: '主题预览资源不存在或已过期' });
  }
  let normalized: string;
  try {
    normalized = normalizeCmsThemePackagePath(`assets/${assetPath}`).slice('assets/'.length);
  } catch {
    throw new HTTPException(400, { message: '主题预览资源路径格式无效' });
  }
  if (!pkg.manifest.assets.includes(`assets/${normalized}`)) {
    throw new HTTPException(404, { message: '主题预览资源不存在或已过期' });
  }
  const root = resolveThemeStoragePath(...pkg.storageKey.split('/'));
  const target = path.resolve(root, 'assets', normalized);
  if (!isWithin(root, target)) throw new HTTPException(400, { message: '主题预览资源路径越界' });
  const content = await readFile(target).catch(() => null);
  if (!content) throw new HTTPException(404, { message: '主题预览资源不存在或已过期' });
  const ext = path.extname(normalized).toLowerCase();
  const contentType = {
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }[ext] ?? 'application/octet-stream';
  return { content, contentType };
}
