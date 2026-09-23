import type { CmsContent, CmsContentVersion } from '@zenith/shared/cms';
import { mockCmsContents, mockCmsContentVersions, mockCmsModels, mockCmsTags, mockCmsChannels } from '../data/cms';
import { MockHttpError } from './contract';
import { conflict, locked, notFound } from './handlers';
import { mockDateTime } from './date';

const publicContents = new Map<number, CmsContent>();
const reviewRevisions = new Map<number, number>();
const distributionBases = new Map<number, Record<string, unknown>>();
const distributionPending = new Map<number, { sourceVersion: number; incoming: Record<string, unknown>; conflicts: { field: string; base: unknown; target: unknown; incoming: unknown }[] }>();
let initialized = false;
function initialize() {
  if (initialized) return;
  initialized = true;
  for (const content of mockCmsContents) {
    content.editorialStatus ??= content.status === 'published' ? 'clean' : content.status === 'pending' ? 'pending' : content.status === 'rejected' ? 'rejected' : 'draft';
    if (content.status === 'pending' || content.status === 'rejected') content.status = 'draft';
    content.ownerId ??= null;
    content.locale ||= 'zh-CN';
    content.translationOfId ??= null;
    content.sourceRevisionId ??= null;
    content.dueAt ??= null;
    content.publishedRevisionId ??= null;
    content.submittedRevisionId ??= null;
    content.approvedRevisionId ??= null;
    content.hasUnpublishedChanges ??= content.status !== 'published';
    content.modelFields ??= structuredClone(mockCmsModels.find((model) => model.id === content.modelId)?.fields ?? []);
    if (content.status === 'published') {
      const revision = freezeMockCmsRevision(content.id, 'publication');
      content.publishedRevisionId = revision.id;
      content.approvedRevisionId = revision.id;
      publicContents.set(content.id, structuredClone(content));
    }
  }
}
export function getMockCmsWorkingContent(id: number): CmsContent {
  initialize();
  const content = mockCmsContents.find((item) => item.id === id);
  if (!content) throw new MockHttpError(notFound('内容不存在', { status: 404 }));
  content.channelName = mockCmsChannels.find((channel) => channel.id === content.channelId)?.name ?? null;
  content.tags = mockCmsTags.filter((tag) => content.tagIds.includes(tag.id));
  return content;
}
export function assertMockCmsCas(id: number, expectedVersion: number): CmsContent {
  const content = getMockCmsWorkingContent(id);
  if (!Number.isInteger(expectedVersion) || content.version !== expectedVersion) throw new MockHttpError(conflict('内容已被修改，请刷新版本后重试', { status: 409 }));
  return content;
}
export function freezeMockCmsRevision(contentId: number, kind = 'checkpoint'): CmsContentVersion {
  const content = getMockCmsWorkingContent(contentId);
  const revision: CmsContentVersion = {
    id: Math.max(0, ...mockCmsContentVersions.map((item) => item.id)) + 1,
    contentId, version: content.version, sourceVersion: content.version, title: content.title,
    snapshot: structuredClone(content), kind, hash: `demo-${contentId}-${content.version}-${crypto.randomUUID()}`,
    remark: kind === 'checkpoint' ? '手动保存' : kind, createdByName: 'admin', createdAt: mockDateTime(),
  };
  mockCmsContentVersions.unshift(revision);
  return revision;
}
export function getMockCmsRevision(id: number): CmsContentVersion | undefined {
  initialize();
  return mockCmsContentVersions.find((revision) => revision.id === id);
}
export function getMockCmsRevisionContent(id: number): CmsContent {
  const revision = getMockCmsRevision(id);
  if (!revision) throw new MockHttpError(notFound('修订不存在', { status: 404 }));
  return { ...getMockCmsWorkingContent(revision.contentId), ...structuredClone(revision.snapshot), revisionId: revision.id, contentHash: revision.hash } as CmsContent;
}
export function bindMockCmsReview(instanceId: number | null, revisionId: number) { if (instanceId) reviewRevisions.set(instanceId, revisionId); }
export function getMockCmsReviewContent(contentId: number, instanceId: number): CmsContent {
  getMockCmsWorkingContent(contentId);
  const revisionId = reviewRevisions.get(instanceId);
  if (!revisionId) throw new MockHttpError(notFound('该审批轮次没有冻结稿件', { status: 404 }));
  return getMockCmsRevisionContent(revisionId);
}
export function activateMockCmsRevision(revisionId: number): CmsContent {
  const revision = getMockCmsRevision(revisionId);
  if (!revision) throw new MockHttpError(notFound('修订不存在', { status: 404 }));
  const content = getMockCmsWorkingContent(revision.contentId);
  const published = getMockCmsRevisionContent(revisionId);
  published.status = 'published';
  published.publishedAt = mockDateTime();
  published.publishedRevisionId = revisionId;
  publicContents.set(content.id, published);
  content.status = 'published';
  content.publishedRevisionId = revisionId;
  content.publishedAt = published.publishedAt;
  content.hasUnpublishedChanges = content.version !== revision.sourceVersion;
  if (!content.hasUnpublishedChanges) content.editorialStatus = 'clean';
  return content;
}
export function getMockCmsPublishedContent(contentId: number): CmsContent | undefined { initialize(); const work = mockCmsContents.find((item) => item.id === contentId); if (!work || work.status !== 'published' || (work as CmsContent & { deleted?: boolean }).deleted) return undefined; return publicContents.get(contentId); }
export function withdrawMockCmsContent(contentId: number) { const content = getMockCmsWorkingContent(contentId); content.status = 'offline'; publicContents.delete(contentId); }
export function saveMockCmsWorkingContent(contentId: number, values: Record<string, unknown>, expectedVersion: number, mode = 'manual'): CmsContent {
  const content = assertMockCmsCas(contentId, expectedVersion);
  if (content.lockedAt) throw new MockHttpError(locked('内容已被持久锁定', { status: 423 }));
  const { expectedVersion: _version, saveMode: _mode, status: _status, editorialStatus: _editorialStatus, ...patch } = values;
  Object.assign(content, structuredClone(patch), { version: content.version + 1, editorialStatus: 'draft', hasUnpublishedChanges: true, updatedAt: mockDateTime() });
  if (mode === 'manual') freezeMockCmsRevision(contentId);
  return content;
}
export function restoreMockCmsRevision(contentId: number, revisionId: number, expectedVersion: number): CmsContent {
  const content = assertMockCmsCas(contentId, expectedVersion);
  const revision = getMockCmsRevision(revisionId);
  if (!revision || revision.contentId !== contentId) throw new MockHttpError(notFound('版本不存在', { status: 404 }));
  const { id: _id, siteId: _site, version: _version, status: _status, editorialStatus: _editorial, publishedAt: _publishedAt, publishedRevisionId: _published, submittedRevisionId: _submitted, approvedRevisionId: _approved, ...snapshot } = revision.snapshot;
  return saveMockCmsWorkingContent(content.id, snapshot, expectedVersion);
}

const DISTRIBUTED_FIELDS = ['title', 'subTitle', 'shortTitle', 'summary', 'body', 'bodyDocument', 'extend', 'mediaData', 'attachments', 'coverImage', 'titleStyle', 'seoTitle', 'seoKeywords', 'seoDescription'] as const;
const distributionValues = (source: CmsContent) => Object.fromEntries(DISTRIBUTED_FIELDS.map((field) => [field, structuredClone(source[field] ?? null)]));
export function setMockCmsDistributionBase(contentId: number, source: CmsContent) { distributionBases.set(contentId, distributionValues(source)); }
export function mergeMockCmsDistribution(contentId: number, source: CmsContent): boolean {
  const target = getMockCmsWorkingContent(contentId);
  const baseline = distributionBases.get(contentId) ?? distributionValues(target);
  const incoming = distributionValues(source);
  const current = distributionValues(target);
  const changes: Record<string, unknown> = {};
  const conflicts: { field: string; base: unknown; target: unknown; incoming: unknown }[] = [];
  for (const field of DISTRIBUTED_FIELDS) {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (same(baseline[field], incoming[field])) continue;
    if (same(current[field], baseline[field]) || same(current[field], incoming[field])) changes[field] = incoming[field];
    else conflicts.push({ field, base: baseline[field], target: current[field], incoming: incoming[field] });
  }
  if (Object.keys(changes).length) saveMockCmsWorkingContent(contentId, changes, target.version, 'autosave');
  if (conflicts.length) {
    distributionPending.set(contentId, { sourceVersion: source.version, incoming, conflicts });
    return false;
  }
  distributionBases.set(contentId, incoming);
  distributionPending.delete(contentId);
  target.distributionSourceVersion = source.version;
  return true;
}
export function getMockCmsDistributionConflict(contentId: number) {
  const target = getMockCmsWorkingContent(contentId);
  const pending = distributionPending.get(contentId);
  if (!pending) return null;
  return { version: target.version, sourceVersion: pending.sourceVersion, targetOwnedFields: ['channelId', 'locale', 'ownerId', 'slug'], conflicts: pending.conflicts };
}
export function resolveMockCmsDistribution(contentId: number, expectedVersion: number, choices: Record<string, 'source' | 'target'>) {
  const target = assertMockCmsCas(contentId, expectedVersion);
  const pending = distributionPending.get(contentId);
  if (!pending || pending.conflicts.some((item) => !choices[item.field])) throw new MockHttpError(conflict('请为所有冲突选择来源或目标', { status: 409 }));
  const patch = Object.fromEntries(pending.conflicts.map((item) => [item.field, choices[item.field] === 'source' ? item.incoming : item.target]));
  saveMockCmsWorkingContent(contentId, patch, expectedVersion);
  target.distributionSourceVersion = pending.sourceVersion;
  distributionBases.set(contentId, pending.incoming);
  distributionPending.delete(contentId);
  return { version: target.version };
}

export function resetMockCmsRevisions() { publicContents.clear(); reviewRevisions.clear(); distributionBases.clear(); distributionPending.clear(); initialized = false; }
