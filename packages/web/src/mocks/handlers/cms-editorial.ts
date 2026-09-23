import type { OutputOf } from '@zenith/shared/core';
import { cmsEditorialContract, cmsModelContract, cmsResourceContract, validateCmsStructuredFields, type CmsEditorialNote, type CmsModelVersion } from '@zenith/shared/cms';
import { mock } from '../utils/contract';
import { requireItem, updateItem } from '../utils/crud';
import { badRequest, conflict, nextIdFrom } from '../utils/handlers';
import { mockDateTime } from '../utils/date';
import { getNextCmsContentId, mockCmsChannels, mockCmsContents, mockCmsContentVersions, mockCmsModels, mockCmsResources } from '../data/cms';
import { getMockCmsWorkingContent, getMockCmsDistributionConflict, resolveMockCmsDistribution, saveMockCmsWorkingContent } from '../utils/cms-revisions';

const notes: CmsEditorialNote[] = [];
const rights: (OutputOf<typeof cmsResourceContract.rights> & { id: number })[] = [];
const modelVersions: CmsModelVersion[] = [];
const content = getMockCmsWorkingContent;
const model = (id: number) => requireItem(mockCmsModels, id, '模型不存在', { status: 404 });
function modelVersion(id: number) {
  const current = model(id);
  let version = modelVersions.filter((item) => item.modelId === id).at(-1);
  if (!version) {
    version = { id: nextIdFrom(modelVersions), modelId: id, version: 1, fields: structuredClone(current.fields ?? []), contentHash: `demo-model-${id}-1`, createdAt: mockDateTime() };
    modelVersions.push(version);
    current.publishedVersionId = version.id;
  }
  return version;
}

export const cmsEditorialHandlers = [
  mock(cmsEditorialContract.metrics, ({ query, ok }) => {
    const rows = mockCmsContents.filter((item) => item.siteId === query.siteId && !(item as typeof item & { deleted?: boolean }).deleted).map((item) => getMockCmsWorkingContent(item.id));
    const ids = new Set(rows.map((item) => item.id));
    const now = mockDateTime();
    return ok({ total: rows.length, working: rows.filter((row) => row.editorialStatus === 'draft').length,
      pending: rows.filter((row) => row.editorialStatus === 'pending').length,
      overdue: rows.filter((row) => row.dueAt && row.dueAt < now && row.editorialStatus !== 'clean').length,
      scheduled: rows.filter((row) => row.scheduledAt && row.scheduledAt > now).length,
      unpublishedChanges: rows.filter((row) => row.hasUnpublishedChanges).length,
      unresolvedNotes: notes.filter((note) => ids.has(note.contentId) && !note.resolved).length });
  }),
  mock(cmsEditorialContract.notes, ({ params, ok }) => { content(params.id); return ok(notes.filter((note) => note.contentId === params.id)); }),
  mock(cmsEditorialContract.addNote, ({ params, body, ok }) => {
    content(params.id);
    if (body.revisionId && !mockCmsContentVersions.some((version) => version.id === body.revisionId && version.contentId === params.id)) return badRequest('修订不属于当前内容', { status: 400 });
    const note: CmsEditorialNote = { id: nextIdFrom(notes), contentId: params.id, revisionId: body.revisionId ?? null, fieldPath: body.fieldPath ?? null, message: body.message,
      mentionedUserIds: body.mentionedUserIds ?? [], resolved: false, createdBy: 1, createdByName: '演示管理员', createdAt: mockDateTime(), updatedAt: mockDateTime() };
    notes.push(note);
    return ok(note);
  }),
  mock(cmsEditorialContract.resolveNote, ({ params, body, ok }) => {
    content(params.id);
    const note = requireItem(notes, params.noteId, '批注不存在', { status: 404 });
    if (note.contentId !== params.id) return badRequest('批注不属于当前内容', { status: 400 });
    return ok(updateItem(notes, note.id, body, { notFoundMessage: '批注不存在', now: mockDateTime }));
  }),
  mock(cmsEditorialContract.quality, ({ params, ok }) => {
    const row = content(params.id);
    const fields = row.modelId ? modelVersion(row.modelId).fields : [];
    const issues = validateCmsStructuredFields(fields, row.extend, true);
    if (!row.summary) issues.push({ rule: 'summary', fieldPath: 'summary', message: '建议填写摘要', severity: 'warning' });
    if (!row.coverImage) issues.push({ rule: 'cover', fieldPath: 'coverImage', message: '尚未选择封面', severity: 'warning' });
    return ok({ version: row.version, issues });
  }),
  mock(cmsEditorialContract.translations, ({ params, ok }) => {
    const source = content(params.id);
    const sourceId = source.translationOfId ?? source.id;
    const latest = mockCmsContentVersions.filter((version) => version.contentId === sourceId).at(-1)?.id;
    return ok(mockCmsContents.filter((row) => row.siteId === source.siteId && (row.id === sourceId || row.translationOfId === sourceId)).map((row) => ({
      id: row.id, title: row.title, locale: row.locale ?? 'zh-CN', status: row.status, sourceRevisionId: row.sourceRevisionId ?? null,
      sourceChanged: row.id !== sourceId && Boolean(latest && row.sourceRevisionId !== latest),
    })));
  }),
  mock(cmsEditorialContract.createTranslation, ({ params, body, ok }) => {
    const original = content(params.id);
    const source = content(original.translationOfId ?? original.id);
    const channel = requireItem(mockCmsChannels, body.channelId, '栏目不存在', { status: 404 });
    if (channel.siteId !== source.siteId) return badRequest('栏目不属于来源站点', { status: 400 });
    if (source.locale === body.locale || mockCmsContents.some((row) => row.translationOfId === source.id && row.locale === body.locale)) return conflict('该语言的变体已存在', { status: 409 });
    const created = { ...structuredClone(source), tagIds: [...(source.tagIds ?? [])], id: getNextCmsContentId(), ...body, translationOfId: source.id,
      sourceRevisionId: mockCmsContentVersions.filter((version) => version.contentId === source.id).at(-1)?.id ?? null,
      status: 'draft' as const, editorialStatus: 'draft' as const, version: 1, publishedRevisionId: null, approvedRevisionId: null, submittedRevisionId: null, hasUnpublishedChanges: true,
      slug: null, staticPath: null, scheduledAt: null, expireAt: null, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    mockCmsContents.push(created);
    return ok({ id: created.id });
  }),
  mock(cmsEditorialContract.distributionConflict, ({ params, ok }) => ok(getMockCmsDistributionConflict(params.id))),
  mock(cmsEditorialContract.resolveDistribution, ({ params, body, ok }) => ok({ version: resolveMockCmsDistribution(params.id, body.expectedVersion, body.choices).version })),
  mock(cmsEditorialContract.previewConversion, ({ params, body, ok }) => {
    const row = content(params.id);
    const version = modelVersion(body.modelId);
    const values = Object.fromEntries(version.fields.flatMap((field) => {
      const source = body.fieldMapping?.[field.name] ?? field.name;
      return row.extend[source] === undefined ? [] : [[field.name, row.extend[source]]];
    }));
    const used = new Set(version.fields.map((field) => body.fieldMapping?.[field.name] ?? field.name));
    return ok({ version: row.version, modelVersionId: version.id, values, droppedFields: Object.keys(row.extend).filter((name) => !used.has(name)), issues: validateCmsStructuredFields(version.fields, values, false) });
  }),
  mock(cmsEditorialContract.convertType, ({ params, body, ok }) => {
    const row = content(params.id);
    if (row.version !== body.expectedVersion) return conflict('内容版本已变化', { status: 409 });
    const version = modelVersion(body.modelId);
    const values = Object.fromEntries(version.fields.flatMap((field) => row.extend[body.fieldMapping?.[field.name] ?? field.name] === undefined ? [] : [[field.name, row.extend[body.fieldMapping?.[field.name] ?? field.name]]]));
    if (Object.keys(row.extend).some((key) => !version.fields.some((field) => (body.fieldMapping?.[field.name] ?? field.name) === key)) && !body.acknowledgeLoss) return badRequest('请确认未映射字段损失', { status: 400 });
    if (validateCmsStructuredFields(version.fields, values, false).length) return badRequest('字段映射不符合目标模型', { status: 400 });
    const updated = saveMockCmsWorkingContent(params.id, { modelId: body.modelId, modelVersionId: version.id, extend: values }, body.expectedVersion);
    return ok({ version: updated.version });
  }),
  mock(cmsModelContract.versions, ({ params, ok }) => { modelVersion(params.id); return ok(modelVersions.filter((version) => version.modelId === params.id)); }),
  mock(cmsModelContract.publish, ({ params, ok }) => {
    const row = model(params.id);
    const previous = modelVersion(params.id);
    const version = { ...previous, id: nextIdFrom(modelVersions), version: previous.version + 1, fields: structuredClone(row.fields ?? []), createdAt: mockDateTime() };
    modelVersions.push(version);
    return ok(updateItem(mockCmsModels, row.id, { publishedVersionId: version.id, hasUnpublishedChanges: false }, { notFoundMessage: '模型不存在', now: mockDateTime }));
  }),
  mock(cmsResourceContract.versions, ({ params, ok }) => {
    const resource = requireItem(mockCmsResources, params.id, '素材不存在', { status: 404 });
    return ok([{ id: resource.id, resourceId: resource.id, version: 1, url: resource.url, thumbUrl: resource.thumbUrl, fileId: resource.fileId, mimeType: resource.mimeType, size: resource.size,
      width: resource.width, height: resource.height, contentHash: `demo-resource-${resource.id}`, createdAt: resource.createdAt }]);
  }),
  mock(cmsResourceContract.rights, ({ params, ok }) => {
    requireItem(mockCmsResources, params.id, '素材不存在', { status: 404 });
    return ok(rights.find((row) => row.resourceId === params.id) ?? { resourceId: params.id, source: null, license: null, expiresAt: null, revoked: false, tags: [], alt: null });
  }),
  mock(cmsResourceContract.updateRights, ({ params, body, ok }) => {
    requireItem(mockCmsResources, params.id, '素材不存在', { status: 404 });
    if (!rights.some((row) => row.id === params.id)) rights.push({ id: params.id, resourceId: params.id, source: null, license: null, expiresAt: null, revoked: false, tags: [], alt: null });
    return ok(updateItem(rights, params.id, body, { notFoundMessage: '素材授权不存在' }));
  }),
];
