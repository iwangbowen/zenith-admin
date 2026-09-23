import * as z from 'zod';
import { idParam, requiredIdQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createCmsEditorialNoteSchema, createCmsTranslationSchema, resolveCmsEditorialNoteSchema } from '../design-validation';
import { cmsQualityIssueSchema } from '../model-design';

export const cmsEditorialNoteSchema = z.object({
  id: z.int(), contentId: z.int(), revisionId: z.int().nullable(), fieldPath: z.string().nullable(), message: z.string(),
  mentionedUserIds: z.array(z.int()), resolved: z.boolean(), createdBy: z.int().nullable(), createdByName: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
}).meta({ id: 'CmsEditorialNote' });
export type CmsEditorialNote = z.infer<typeof cmsEditorialNoteSchema>;
export const cmsTranslationSchema = z.object({ id: z.int(), title: z.string(), locale: z.string(), status: z.string(), sourceRevisionId: z.int().nullable(), sourceChanged: z.boolean() }).meta({ id: 'CmsTranslation' });
export const cmsEditorialMetricsSchema = z.object({ total: z.int(), working: z.int(), pending: z.int(), overdue: z.int(), scheduled: z.int(), unpublishedChanges: z.int(), unresolvedNotes: z.int() }).meta({ id: 'CmsEditorialMetrics' });

export const cmsEditorialContract = defineContract('/api/cms/editorial', {
  notes: op.get('/{id}/notes', { access: { permission: 'cms:content:list' }, params: idParam, response: z.array(cmsEditorialNoteSchema), summary: '内容审稿批注' }),
  addNote: op.post('/{id}/notes', { access: { permission: ['cms:content:update', 'cms:content:audit'] }, params: idParam, body: createCmsEditorialNoteSchema, response: cmsEditorialNoteSchema, audit: '添加 CMS 审稿批注', summary: '添加字段或修订批注' }),
  resolveNote: op.put('/{id}/notes/{noteId}', { access: { permission: ['cms:content:update', 'cms:content:audit'] }, params: idParam.extend({ noteId: z.coerce.number().int().positive() }), body: resolveCmsEditorialNoteSchema, response: cmsEditorialNoteSchema, audit: '处理 CMS 审稿批注', summary: '处理或重新打开批注' }),
  quality: op.get('/{id}/quality', { access: { permission: 'cms:content:list' }, params: idParam, response: z.object({ version: z.int(), issues: z.array(cmsQualityIssueSchema) }), summary: '当前工作稿质量检查' }),
  translations: op.get('/{id}/translations', { access: { permission: 'cms:content:list' }, params: idParam, response: z.array(cmsTranslationSchema), summary: '人工语言变体与源稿变化' }),
  createTranslation: op.post('/{id}/translations', { access: { permission: 'cms:content:create' }, params: idParam, body: createCmsTranslationSchema, response: z.object({ id: z.int() }), audit: '创建 CMS 人工翻译稿', summary: '创建独立审核发布的语言变体' }),
  metrics: op.get('/metrics', { access: { permission: 'cms:content:list' }, query: z.object({ siteId: requiredIdQuery() }), response: cmsEditorialMetricsSchema, summary: '内容生产指标' }),
}, { tags: ['CMS-编辑协作'], auditModule: 'CMS内容管理' });
