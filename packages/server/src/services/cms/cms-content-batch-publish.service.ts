import { HTTPException } from 'hono/http-exception';
import type { CmsContentBatchStatusResult } from '@zenith/shared/cms';
import { db } from '../../db';
import { APP_TIME_ZONE, formatDateTime } from '../../lib/datetime';
import { loadCmsPublishableRevision } from './cms-content-revisions.service';
import { prepareCmsContentPublication } from './cms-contents-write.service';
import { createCmsRelease, buildCmsRelease } from './cms-releases.service';

/** One deployment per site and activation instant, rather than N competing baselines. */
export async function publishCmsContentBatch(ids: number[], expectedVersions?: Record<string, number>): Promise<CmsContentBatchStatusResult> {
  const result: CmsContentBatchStatusResult = { okIds: [], approvedIds: [], releases: [], failed: [] };
  const groups = new Map<string, { siteId: number; activateAt: string | null; revisions: number[]; contents: number[] }>();
  for (const id of [...new Set(ids)]) {
    try {
      const prepared = await prepareCmsContentPublication(id, { expectedVersion: expectedVersions?.[String(id)] });
      result.approvedIds.push(id);
      const revision = await loadCmsPublishableRevision(db, prepared.revisionId);
      const activateAt = revision.payload.scheduledAt ? formatDateTime(revision.payload.scheduledAt) : null;
      const key = JSON.stringify([revision.siteId, activateAt]);
      const group = groups.get(key) ?? { siteId: revision.siteId, activateAt, revisions: [], contents: [] };
      group.revisions.push(revision.id); group.contents.push(id); groups.set(key, group);
    } catch (error) {
      result.failed.push({ id, reason: error instanceof HTTPException ? error.message : '修订批准失败' });
    }
  }
  for (const group of groups.values()) {
    let releaseId: number | undefined;
    try {
      const release = await createCmsRelease({ siteId: group.siteId, name: `批量发布 ${group.contents.length} 条内容`, revisionIds: group.revisions, withdrawContentIds: [],
        pageIds: [], widgetIds: [], includeSiteConfiguration: false, activateAt: group.activateAt, timeZone: APP_TIME_ZONE, autoActivate: true }, undefined, 'content');
      releaseId = release.id;
      const submitted = await buildCmsRelease(release.id);
      result.releases.push({ id: release.id, siteId: group.siteId, status: submitted.status, contentIds: group.contents });
      result.okIds.push(...group.contents);
    } catch (error) {
      if (releaseId) result.releases.push({ id: releaseId, siteId: group.siteId, status: 'draft', contentIds: group.contents });
      const reason = `${releaseId ? `发布单 #${releaseId} 已保存，构建未提交：` : '修订已批准，发布单未创建：'}${error instanceof Error ? error.message : '请重试'}`;
      result.failed.push(...group.contents.map((id) => ({ id, reason })));
    }
  }
  return result;
}
