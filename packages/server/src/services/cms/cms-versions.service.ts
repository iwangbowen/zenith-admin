import { eq, desc, getTableColumns } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { cmsContentRevisions, cmsModelVersions, users } from '../../db/schema';
import { cmsContentContract, cmsContentVersionSchema, cmsContentVersionSummarySchema } from '@zenith/shared/cms';
import type { QueryOutputOf } from '@zenith/shared/core';
import { buildListResult } from '../../lib/list-query';
import { withPagination } from '../../lib/where-helpers';
import { resolveUserNames } from '../../lib/user-nicknames';
import { pickEntity } from '../../lib/entity-map';
import { requireCmsContentAccess } from './cms-content-access.service';
import { canonicalCmsJson, loadCmsRevision, requireCmsWorkingCopy } from './cms-content-revisions.service';
import { resolveCmsResourcePayload } from './cms-resource-refs.service';

/** Milestone history is append-only; autosave checkpoints do not evict approved or published revisions. */
export async function listContentVersions(contentId: number, query: QueryOutputOf<typeof cmsContentContract.versions>) {
  await requireCmsContentAccess(contentId);
  const { snapshot: _snapshot, ...columns } = getTableColumns(cmsContentRevisions);
  const where = eq(cmsContentRevisions.contentId, contentId);
  return buildListResult({ page: query.page, pageSize: query.pageSize,
    count: () => db.$count(cmsContentRevisions, where),
    rows: () => withPagination(db.select({ revision: columns, author: users.nickname }).from(cmsContentRevisions)
      .leftJoin(users, eq(users.id, cmsContentRevisions.createdBy)).where(where).orderBy(desc(cmsContentRevisions.version)).$dynamic(), query.page, query.pageSize),
    map: ({ revision, author }) => pickEntity(cmsContentVersionSummarySchema, revision, { createdByName: author }),
  });
}

export async function getContentVersion(contentId: number, versionId: number) {
  const revision = await ensureVersionExists(contentId, versionId);
  const [model] = revision.snapshot.modelVersionId ? await db.select({ fields: cmsModelVersions.fields }).from(cmsModelVersions).where(eq(cmsModelVersions.id, revision.snapshot.modelVersionId)).limit(1) : [];
  const names = await resolveUserNames(revision.createdBy ? [revision.createdBy] : []);
  return resolveCmsResourcePayload(pickEntity(cmsContentVersionSchema, revision, { snapshot: { ...revision.snapshot, modelFields: model?.fields ?? [] }, createdByName: revision.createdBy ? names.get(revision.createdBy) ?? null : null }), revision.siteId);
}

export async function ensureVersionExists(contentId: number, versionId: number) {
  await requireCmsContentAccess(contentId);
  const revision = await loadCmsRevision(db, versionId);
  if (revision.contentId !== contentId) throw new HTTPException(404, { message: '版本不存在' });
  return revision;
}

const LABELS: Record<string, string> = {
  channelId: '所属栏目', modelId: '内容类型', modelVersionId: '类型版本', title: '标题', titleStyle: '标题样式',
  subTitle: '副标题', shortTitle: '短标题', slug: 'URL 标识', summary: '摘要', coverImage: '封面', author: '作者', editor: '责任编辑',
  source: '来源', sourceUrl: '来源链接', isOriginal: '原创', body: '正文', bodyDocument: '结构化正文', extend: '模型字段', mediaData: '媒体',
  attachments: '附件', tagIds: '标签', extraChannelIds: '副栏目', relatedIds: '关联内容', externalLink: '链接', detailTemplate: '详情模板', staticPath: '静态路径',
  isTop: '置顶', topWeight: '置顶权重', topExpireAt: '置顶到期', isRecommend: '推荐', isHot: '热门', sort: '排序',
  scheduledAt: '计划发布', expireAt: '到期时间', seoTitle: 'SEO 标题', seoKeywords: 'SEO 关键词', seoDescription: 'SEO 描述',
  socialImageAlt: '分享图片说明', twitterCreator: '社交作者', assetVersions: '素材版本', contentType: '内容形态',
};

export async function diffContentVersion(contentId: number, versionId: number) {
  const revision = await ensureVersionExists(contentId, versionId);
  const working = await requireCmsWorkingCopy(db, contentId);
  const before = revision.snapshot as Record<string, unknown>;
  const after = working.snapshot as Record<string, unknown>;
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => field !== 'bodyDocument')
    .filter((field) => canonicalCmsJson(before[field]) !== canonicalCmsJson(after[field]))
    .map((field) => ({ field, label: LABELS[field] ?? field, before: before[field] ?? null, after: after[field] ?? null }));
}
