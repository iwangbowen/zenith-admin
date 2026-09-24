import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type * as z from 'zod';
import { CMS_PREVIEW_MODE_LABELS, cmsSiteRelativePath, renderCmsWorkbenchPreviewSchema, type CmsWorkbenchPreview } from '@zenith/shared/cms';
import { db, withDbExecutor } from '../../db';
import { cmsContents, cmsChannels, cmsContentWorkingCopies, cmsContentRevisions, cmsReleases, cmsSiteGenerations } from '../../db/schema';
import { currentUser, hasPermission } from '../../lib/context';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { assertSiteAccess, ensureCmsSiteExists } from './cms-sites.service';
import { requireCmsContentsAccess } from './cms-content-access.service';
import { applyCmsRevisionProjection, canonicalCmsJson, freezeCmsContentRevision, loadCmsRevision, requireCmsWorkingCopy } from './cms-content-revisions.service';
import { captureCmsConfiguration } from './cms-configuration-snapshot.service';
import { createCmsGenerationStorage, cmsGenerationSchemaName, sealCmsGenerationStorage, withCmsPublicGeneration, withCmsGenerationTransaction } from './cms-generation-storage.service';
import { withCmsGenerationContext } from './cms-generation-context';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';
import { renderSearchPage, renderSitePath } from './cms-render.service';
import { cmsReleaseScope } from './cms-release-access.service';
import { getCmsReleaseDetail } from './cms-releases.service';
import { prepareCmsWorkbenchHtml } from './cms-workbench-preview-html';
import { contentUrl } from './cms-urls';

type PreviewInput = z.output<typeof renderCmsWorkbenchPreviewSchema>;
const fingerprint = (value: unknown) => createHash('sha256').update(canonicalCmsJson(value)).digest('hex');
class CompletedPreview extends Error { constructor(readonly result: CmsWorkbenchPreview) { super('CMS preview transaction rolled back'); } }

async function renderPath(siteId: number, requestedPath: string) {
  const site = await resolveEffectiveCmsSiteRow(siteId);
  const baseUrl = `/__cms/${site.code}`;
  let path = requestedPath;
  // A saved draft has no public URL yet. Resolve this private target in the
  // selected projection, using exactly the same date/path rules as publication.
  const target = /^\/@content\/(\d+)$/.exec(path);
  if (target) {
    const [row] = await db.select({ content: cmsContents, channel: cmsChannels }).from(cmsContents)
      .innerJoin(cmsChannels, eq(cmsChannels.id, cmsContents.channelId))
      .where(and(eq(cmsContents.id, Number(target[1])), eq(cmsContents.siteId, siteId), eq(cmsContents.status, 'published'))).limit(1);
    if (!row) throw new HTTPException(404, { message: '所选预览来源中没有这篇内容' });
    path = contentUrl('', row.channel, row.content);
  }
  for (let hop = 0; hop < 5; hop++) {
    const url = new URL(path, 'https://cms-preview.invalid');
    const result = url.pathname === '/search'
      ? await renderSearchPage(site, baseUrl, url.searchParams.get('q') ?? '', Math.max(1, Number(url.searchParams.get('page')) || 1))
      : await renderSitePath(site, baseUrl, url.pathname);
    if (result.status !== 302) return { html: prepareCmsWorkbenchHtml(result.html, baseUrl), status: result.status, path };
    const relative = result.location?.startsWith('/') ? cmsSiteRelativePath(result.location, site.code) : null;
    if (!relative) throw new HTTPException(400, { message: '预览中的外部跳转已禁用，请选择本站页面' });
    path = relative;
  }
  throw new HTTPException(400, { message: '预览链接存在循环跳转' });
}

function assertFingerprint(input: PreviewInput, value: string) {
  if (input.expectedFingerprint && input.expectedFingerprint !== value) throw new HTTPException(409, { message: '预览来源已变化，请刷新预览后继续，避免混合不同版本' });
}

/** Authenticated rendering only: no public page request, task, activation, counter or lasting projection is created. */
export async function renderCmsWorkbenchPreview(input: PreviewInput): Promise<CmsWorkbenchPreview> {
  await assertSiteAccess(input.siteId);
  await ensureCmsSiteExists(input.siteId);
  if (input.mode === 'candidate') {
    if (!await hasPermission('cms:publish:view')) throw new HTTPException(403, { message: '缺少发布单查看权限' });
    const release = await getCmsReleaseDetail(input.releaseId!);
    if (release.siteId !== input.siteId) throw new HTTPException(404, { message: '发布单不属于本站' });
    if (!release.deploymentId || !release.deployment?.manifestHash || !['ready', 'scheduled', 'active', 'superseded'].includes(release.status)) throw new HTTPException(409, { message: '请先成功构建候选部署' });
    const key = fingerprint({ mode: 'candidate', id: release.id, manifest: release.deployment.manifestHash });
    assertFingerprint(input, key);
    return withCmsGenerationTransaction(input.siteId, release.deploymentId, true, async () => ({
      ...await renderPath(input.siteId, input.path), mode: input.mode, sourceLabel: `${CMS_PREVIEW_MODE_LABELS.candidate} #${release.id}`,
      fingerprint: key, generationId: release.deploymentId, contentVersions: [],
    }));
  }
  if (input.mode === 'online') return withCmsPublicGeneration(input.siteId, async () => {
    const [pointer] = await db.select({ id: cmsSiteGenerations.activeGenerationId }).from(cmsSiteGenerations).where(eq(cmsSiteGenerations.siteId, input.siteId)).limit(1);
    const key = fingerprint({ mode: 'online', siteId: input.siteId, generation: pointer?.id ?? null });
    assertFingerprint(input, key);
    return { ...await renderPath(input.siteId, input.path), mode: input.mode, sourceLabel: CMS_PREVIEW_MODE_LABELS.online,
      fingerprint: key, generationId: pointer?.id ?? null, contentVersions: [] };
  });

  if (input.includeSiteConfiguration && !await hasPermission('cms:publish:view')) throw new HTTPException(403, { message: '整站工作配置预览需要发布单查看权限' });
  if (input.pageIds.length && !await hasPermission('cms:page:list')) throw new HTTPException(403, { message: '缺少页面查看权限' });
  if (input.widgetIds.length && !await hasPermission('cms:widget:list')) throw new HTTPException(403, { message: '缺少部件查看权限' });
  if (input.includeSiteConfiguration || input.pageIds.length || input.widgetIds.length) await assertAllCmsSiteChannelsAccess(input.siteId);
  if (input.contentIds.length && !await hasPermission('cms:content:list')) throw new HTTPException(403, { message: '缺少内容查看权限' });
  const identities = await requireCmsContentsAccess([...new Set(input.contentIds)]);
  if (identities.some((row) => row.siteId !== input.siteId || row.deletedAt || row.archivedAt)) throw new HTTPException(404, { message: '工作稿不存在或不属于本站可编辑内容' });
  try {
    return await db.transaction(async (tx) => {
      const [pointer] = await tx.select().from(cmsSiteGenerations).where(eq(cmsSiteGenerations.siteId, input.siteId)).limit(1);
      const configuration = await captureCmsConfiguration(tx, input.siteId, input);
      for (const widget of configuration.snapshot.tables.cms_widgets ?? []) {
        if (input.widgetIds.includes(Number(widget.id))) Object.assign(widget, { published_data: widget.draft_data, published_name: widget.name, published_revision: widget.draft_revision, status: 'published' });
      }
      const working = await Promise.all(identities.map(async (identity) => ({ identity, copy: await requireCmsWorkingCopy(tx, identity.id) })));
      const key = fingerprint({ mode: 'working', base: pointer?.activeGenerationId ?? null, configuration: configuration.snapshot,
        contents: working.map(({ identity, copy }) => ({ id: identity.id, version: copy.version, snapshot: copy.snapshot })) });
      assertFingerprint(input, key);
      const revisions = [];
      for (const { identity, copy } of working) {
        const revision = await freezeCmsContentRevision(tx, identity, copy, 'preview', '工作区组合预览');
        revisions.push(await loadCmsRevision(tx, revision.id));
      }
      const existing = await tx.select({ contentId: cmsContentWorkingCopies.contentId, revisionId: cmsContentRevisions.id, hash: cmsContentRevisions.hash })
        .from(cmsContentWorkingCopies).innerJoin(cmsContents, eq(cmsContents.id, cmsContentWorkingCopies.contentId))
        .innerJoin(cmsContentRevisions, eq(cmsContentRevisions.id, cmsContentWorkingCopies.publishedRevisionId)).where(eq(cmsContents.siteId, input.siteId));
      const refs = new Map(existing.map((row) => [row.contentId, row]));
      for (const revision of revisions) refs.set(revision.contentId, { contentId: revision.contentId, revisionId: revision.id, hash: revision.hash });
      // Reserve a collision-free namespace. The sequence may have gaps; no deployment row is created.
      const [namespace] = await tx.execute<{ id: number }>(sql`SELECT nextval(pg_get_serial_sequence('public.cms_deployments','id'))::integer AS id`);
      await createCmsGenerationStorage(tx, input.siteId, namespace.id, pointer?.activeGenerationId ?? null, configuration.snapshot);
      await tx.execute(sql`SELECT set_config('search_path', ${`${cmsGenerationSchemaName(namespace.id)},public`}, true)`);
      await tx.execute(sql`SELECT set_config('cms.preview', 'true', true)`);
      const result = await withDbExecutor(tx, () => withCmsGenerationContext({ siteId: input.siteId, generationId: namespace.id, candidate: true }, async () => {
        for (const revision of revisions) await applyCmsRevisionProjection(tx, revision, { generationId: namespace.id, candidate: true, publishedAt: new Date() });
        await sealCmsGenerationStorage(tx, namespace.id, [...refs.values()]);
        return { ...await renderPath(input.siteId, input.path), mode: input.mode, sourceLabel: CMS_PREVIEW_MODE_LABELS.working,
          fingerprint: key, generationId: pointer?.activeGenerationId ?? null, contentVersions: working.map(({ identity, copy }) => ({ id: identity.id, version: copy.version })) };
      }));
      throw new CompletedPreview(result);
    }, { isolationLevel: 'repeatable read' });
  } catch (error) { if (error instanceof CompletedPreview) return error.result; throw error; }
}

export async function getCmsConfigurationDraftLink(siteId: number) {
  await assertSiteAccess(siteId);
  if (!await hasPermission('cms:publish:view')) return null;
  const scope = await cmsReleaseScope(siteId);
  const [draft] = await db.select({ id: cmsReleases.id, name: cmsReleases.name }).from(cmsReleases).where(and(
    eq(cmsReleases.siteId, siteId), eq(cmsReleases.source, 'configuration'), eq(cmsReleases.status, 'draft'), eq(cmsReleases.createdBy, currentUser().userId), scope,
  )).limit(1);
  return draft ? { ...draft, href: `/cms/publishing?site=${siteId}&release=${draft.id}` } : null;
}
