import { asc, eq, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type * as z from 'zod';
import { cmsReleaseFieldDiffs, type CmsReleaseChange, type CmsReleaseReview, recreateCmsReleaseSchema } from '@zenith/shared/cms';
import { db, readSnapshot, withDbExecutor } from '../../db';
import { asyncTasks, cmsChannels, cmsContents, cmsDeployments } from '../../db/schema';
import { createCmsRelease, getCmsReleaseDetail, requireRelease } from './cms-releases.service';
import { loadCmsRevision } from './cms-content-revisions.service';
import { cmsReleaseInputFingerprint } from './cms-release-fingerprint';
import { cmsGenerationSchemaName } from './cms-generation-storage.service';
import { CMS_CONFIGURATION_TABLES, CMS_PUBLIC_SITE_SETTINGS } from './cms-public-settings';
import { isCmsRevisionAssetVisible } from './cms-asset-rights.service';
import { validateCmsModelExtend } from './cms-model-extend';
import { channelUrl, contentUrl, customPagePath } from './cms-urls';

const CONFIGURATION_KINDS: Record<string, CmsReleaseChange['kind']> = { cms_sites: 'site', cms_channels: 'channel', cms_pages: 'page', cms_widgets: 'widget', cms_resources: 'resource' };
const kindOf = (table: string): CmsReleaseChange['kind'] => CONFIGURATION_KINDS[table] ?? 'navigation';
const hrefOf = (kind: CmsReleaseChange['kind'], siteId: number, id: number) => {
  if (kind === 'content') return `/cms/contents/edit?id=${id}&siteId=${siteId}`;
  if (kind === 'channel') return `/cms/channels?site=${siteId}&channel=${id}`;
  const pages = { site: 'sites', page: 'pages', widget: 'widgets', resource: 'resources', navigation: 'sites' };
  return `/cms/${pages[kind]}?siteId=${siteId}`;
};
function rowPath(table: string, row: Record<string, unknown> | null): string[] {
  if (!row) return [];
  if (table === 'cms_pages') return [row.is_home ? '/' : `/${customPagePath({ slug: String(row.slug), path: typeof row.path === 'string' ? row.path : null })}`];
  if (table === 'cms_channels' && row.path) return [channelUrl('', String(row.path), 1)];
  return [];
}

export async function getCmsReleaseReview(id: number): Promise<CmsReleaseReview> {
  await requireRelease(id);
  return readSnapshot((tx) => withDbExecutor(tx, async () => {
    const release = await requireRelease(id);
    const detail = await getCmsReleaseDetail(id);
    const historical = ['active', 'superseded'].includes(release.status);
    const comparisonGenerationId = historical ? release.baseGenerationId : detail.activeGenerationId;
    const [current] = comparisonGenerationId ? await tx.select({ snapshot: cmsDeployments.snapshot }).from(cmsDeployments).where(eq(cmsDeployments.id, comparisonGenerationId)).limit(1) : [];
    const oldRevisions = new Map(current?.snapshot?.revisions.map((entry) => [entry.contentId, entry.revisionId]) ?? []);
    const report: CmsReleaseReview = { releaseId: id, fingerprint: cmsReleaseInputFingerprint(release), baseGenerationId: release.baseGenerationId,
      currentGenerationId: detail.activeGenerationId, comparisonGenerationId, stale: !historical && detail.activeGenerationId !== release.baseGenerationId,
      changes: [], checks: [], affectedPaths: [], wholeSiteAffected: false, tasks: [] };
    for (const message of detail.blockingChecks) report.checks.push({ severity: release.status === 'draft' && message.includes('尚未成功构建') ? 'warning' : 'error', code: 'release', message, objectTitle: release.name, editPath: null });
    const channels = comparisonGenerationId
      ? await tx.execute<{ id: number; path: string; detailPathRule: typeof cmsChannels.$inferSelect.detailPathRule }>(sql.raw(`SELECT id,path,detail_path_rule AS "detailPathRule" FROM "${cmsGenerationSchemaName(comparisonGenerationId)}".cms_channels`))
      : await tx.select({ id: cmsChannels.id, path: cmsChannels.path, detailPathRule: cmsChannels.detailPathRule }).from(cmsChannels).where(eq(cmsChannels.siteId, release.siteId));
    const beforeChannels = new Map(channels.map((channel) => [channel.id, channel]));
    const afterChannels = new Map(beforeChannels);
    for (const row of release.configurationSnapshot.tables.cms_channels ?? []) afterChannels.set(Number(row.id), { id: Number(row.id), path: String(row.path), detailPathRule: row.detail_path_rule as typeof cmsChannels.$inferSelect.detailPathRule });
    const contentDates = await tx.select({ id: cmsContents.id, createdAt: cmsContents.createdAt }).from(cmsContents).where(eq(cmsContents.siteId, release.siteId));
    const dates = new Map(contentDates.map((row) => [row.id, row.createdAt]));
    for (const item of release.items) {
      const beforeRevision = oldRevisions.get(item.contentId);
      const before = beforeRevision ? (await loadCmsRevision(tx, beforeRevision)).snapshot : null;
      const after = item.revisionId ? (await loadCmsRevision(tx, item.revisionId)).snapshot : null;
      const fields = cmsReleaseFieldDiffs(before, after);
      const [oldContent] = comparisonGenerationId ? await tx.execute<{ publishedAt: string | null }>(sql`SELECT published_at AS "publishedAt" FROM ${sql.raw(`"${cmsGenerationSchemaName(comparisonGenerationId)}".cms_contents`)} WHERE id=${item.contentId}`) : [];
      const paths = [before, after].flatMap((snapshot, index) => {
        const channel = snapshot ? (index === 0 ? beforeChannels : afterChannels).get(snapshot.channelId) : undefined;
        const publishedAt = index === 0 ? oldContent?.publishedAt ? new Date(oldContent.publishedAt) : null : release.activateAt ?? new Date();
        return snapshot && channel ? [contentUrl('', channel, { id: item.contentId, slug: snapshot.slug ?? null, staticPath: snapshot.staticPath ?? null, publishedAt, createdAt: dates.get(item.contentId) ?? null }), channelUrl('', channel.path, 1)] : [];
      });
      if (fields.length) report.changes.push({ kind: 'content', id: item.contentId, title: item.title,
        operation: after ? before ? 'update' : 'create' : 'remove', fields, paths: [...new Set(paths)], editPath: hrefOf('content', release.siteId, item.contentId) });
      if (after) {
        try {
          await validateCmsModelExtend(after.modelId, after.extend, 'publish', after.modelVersionId);
          if (!await isCmsRevisionAssetVisible(after, tx)) throw new HTTPException(409, { message: '固定修订包含已撤权或过期素材' });
        } catch (error) {
          if (!(error instanceof HTTPException)) throw error;
          report.checks.push({ severity: 'error', code: 'content-dependency', message: error.message, objectTitle: item.title, editPath: hrefOf('content', release.siteId, item.contentId) });
        }
        if (!after.summary) report.checks.push({ severity: 'warning', code: 'summary', message: '建议填写摘要，便于检索和分享', objectTitle: item.title, editPath: hrefOf('content', release.siteId, item.contentId) });
      }
    }
    for (const table of CMS_CONFIGURATION_TABLES) {
      const incoming = release.configurationSnapshot.tables[table];
      if (!incoming) continue;
      const scopeRows = (rows: Record<string, unknown>[]) => rows
        .filter((row) => table === 'cms_sites' ? Number(row.id) === release.siteId : table === 'cms_site_inheritances' ? Number(row.site_id) === release.siteId : true)
        .map((row) => table !== 'cms_sites' ? row : { ...row, settings: Object.fromEntries(CMS_PUBLIC_SITE_SETTINGS.flatMap((key) => {
          const value = (row.settings as Record<string, unknown> | null)?.[key];
          return value == null ? [] : [[key, value]];
        })) });
      const after = scopeRows(incoming);
      const previous = comparisonGenerationId ? await tx.execute<{ row: Record<string, unknown> }>(sql.raw(`SELECT to_jsonb(t) AS row FROM "${cmsGenerationSchemaName(comparisonGenerationId)}"."${table}" t`)) : [];
      const before = scopeRows(previous.map((entry) => entry.row));
      const rowKey = (row: Record<string, unknown>) => String(row.id ?? `${row.site_id}:${row.component}`);
      const beforeMap = new Map(before.map((row) => [rowKey(row), row])); const afterMap = new Map(after.map((row) => [rowKey(row), row]));
      const keys = new Set([...afterMap.keys(), ...(release.configurationSnapshot.deleteIds?.[table] ?? []).map(String), ...(release.configurationSnapshot.replaceAll.includes(table) ? beforeMap.keys() : [])]);
      for (const key of keys) {
        const left = beforeMap.get(key) ?? null; const right = afterMap.get(key) ?? null;
        const fields = cmsReleaseFieldDiffs(left, right);
        if (!fields.length) continue;
        const kind = kindOf(table); const target = right ?? left!; const objectId = Number(target.id ?? target.site_id);
        report.changes.push({ kind, id: objectId, title: String(target.name ?? target.title ?? target.code ?? `${table} #${key}`),
          operation: right ? left ? 'update' : 'create' : 'remove', fields, editPath: hrefOf(kind, release.siteId, objectId), paths: [...new Set([...rowPath(table, left), ...rowPath(table, right)])] });
        if (['site', 'channel', 'widget', 'navigation'].includes(kind)) report.wholeSiteAffected = true;
      }
    }
    if (!await isCmsRevisionAssetVisible(release.configurationSnapshot, tx)) report.checks.push({ severity: 'error', code: 'configuration-assets', message: '候选配置素材已撤权或过期', objectTitle: '站点配置', editPath: hrefOf('site', release.siteId, release.siteId) });
    report.affectedPaths = [...new Set(['/', ...report.changes.flatMap((change) => change.paths)])].sort();
    const deployments = await tx.select({ taskIds: cmsDeployments.taskIds }).from(cmsDeployments).where(eq(cmsDeployments.releaseId, id));
    const taskIds = [...new Set(deployments.flatMap((deployment) => deployment.taskIds))];
    if (taskIds.length) report.tasks = await tx.select({ id: asyncTasks.id, taskType: asyncTasks.taskType, title: asyncTasks.title, status: asyncTasks.status,
      processedCount: asyncTasks.processedCount, totalCount: asyncTasks.totalCount, progressNote: asyncTasks.progressNote, errorMessage: asyncTasks.errorMessage,
    }).from(asyncTasks).where(inArray(asyncTasks.id, taskIds)).orderBy(asc(asyncTasks.id));
    return report;
  }));
}

export async function recreateCmsRelease(id: number, input: z.output<typeof recreateCmsReleaseSchema>) {
  const release = await requireRelease(id);
  if (cmsReleaseInputFingerprint(release) !== input.expectedFingerprint) throw new HTTPException(409, { message: '发布草稿已有变化，请重新审阅后再准备' });
  return createCmsRelease({ siteId: release.siteId, name: `${release.name.slice(0, 180)}（重新审阅）`,
    revisionIds: release.items.flatMap((item) => item.revisionId ? [item.revisionId] : []), withdrawContentIds: release.items.filter((item) => item.action === 'withdraw').map((item) => item.contentId),
    pageIds: release.configurationItems.filter((item) => item.kind === 'page').map((item) => item.id), widgetIds: release.configurationItems.filter((item) => item.kind === 'widget').map((item) => item.id),
    includeSiteConfiguration: release.configurationItems.some((item) => item.kind === 'site'), autoActivate: false, timeZone: release.timeZone,
  }, undefined, 'manual', input.expectedGenerationId, { id, fingerprint: input.expectedFingerprint });
}
