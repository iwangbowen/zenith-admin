import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { saveCmsWidgetSlotSchema } from '../../report/validation';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import {
  CMS_WIDGET_LIVE_SOURCE_TYPES,
  CMS_WIDGET_REF_OWNER_TYPES,
  CMS_WIDGET_RENDERER_KEYS,
  CMS_WIDGET_SLOT_KEYS,
  CMS_WIDGET_SOURCE_TYPES,
  CMS_WIDGET_STATUSES,
  CMS_WIDGET_TYPES,
} from '../constants';
import { batchCmsWidgetSchema, createCmsWidgetSchema, updateCmsWidgetSchema } from '../validation';
import { cmsSiteScopeQuery } from './tags';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsWidgetTypeSchema = z.enum(CMS_WIDGET_TYPES);

export const cmsWidgetRendererKeySchema = z.enum(CMS_WIDGET_RENDERER_KEYS);

export const cmsWidgetItemViewSchema = z.object({
  id: z.string(),
  sourceType: z.enum(CMS_WIDGET_SOURCE_TYPES),
  sourceId: z.int().nullable().optional(),
  title: z.string().nullable().optional().meta({ description: '来源字段的人工覆盖；空值表示跟随实时来源。手工条目至少填写 title' }),
  summary: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  displayDate: z.string().nullable().optional(),
}).meta({ id: 'CmsWidgetItem' });

export type CmsWidgetItem = z.infer<typeof cmsWidgetItemViewSchema>;

export const cmsWidgetDataViewSchema = z.object({
  items: z.array(cmsWidgetItemViewSchema),
}).meta({ id: 'CmsWidgetData' });

export type CmsWidgetData = z.infer<typeof cmsWidgetDataViewSchema>;

export const cmsWidgetSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  name: z.string(),
  code: z.string(),
  type: cmsWidgetTypeSchema,
  schemaVersion: z.int(),
  draftData: cmsWidgetDataViewSchema,
  publishedData: cmsWidgetDataViewSchema.nullable(),
  publishedName: z.string().nullable(),
  draftRevision: z.int(),
  publishedRevision: z.int(),
  status: z.enum(CMS_WIDGET_STATUSES),
  defaultRendererKey: cmsWidgetRendererKeySchema,
  remark: z.string().nullable(),
  referenceCount: z.int(),
  impactCount: z.int(),
  highFanout: z.boolean(),
  hasUnpublishedChanges: z.boolean(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsWidget' });

export type CmsWidget = z.infer<typeof cmsWidgetSchema>;

export const cmsWidgetRefSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  widgetId: z.int(),
  ownerType: z.enum(CMS_WIDGET_REF_OWNER_TYPES),
  ownerId: z.int(),
  field: z.string(),
  rendererKey: cmsWidgetRendererKeySchema,
  styleProps: z.record(z.string(), z.unknown()),
  ownerName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsWidgetRef' });

export type CmsWidgetRef = z.infer<typeof cmsWidgetRefSchema>;

export const cmsWidgetSourceReferenceSchema = z.object({
  widgetId: z.int(),
  widgetName: z.string(),
  widgetCode: z.string(),
  itemId: z.string(),
  sourceType: z.enum(CMS_WIDGET_LIVE_SOURCE_TYPES),
  sourceId: z.int(),
  referenceCount: z.int(),
  impactCount: z.int(),
  highFanout: z.boolean(),
}).meta({ id: 'CmsWidgetSourceReference' });

export type CmsWidgetSourceReference = z.infer<typeof cmsWidgetSourceReferenceSchema>;

export const cmsResolvedWidgetItemSchema = z.object({
  id: z.string(),
  sourceType: z.enum(CMS_WIDGET_SOURCE_TYPES),
  sourceId: z.int().nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  url: z.string().nullable(),
  image: z.string().nullable(),
  displayDate: z.string().nullable(),
}).meta({ id: 'CmsResolvedWidgetItem' });

export type CmsResolvedWidgetItem = z.infer<typeof cmsResolvedWidgetItemSchema>;

export const cmsResolvedWidgetSchema = z.object({
  id: z.int(),
  name: z.string(),
  type: cmsWidgetTypeSchema,
  rendererKey: cmsWidgetRendererKeySchema,
  items: z.array(cmsResolvedWidgetItemSchema),
}).meta({ id: 'CmsResolvedWidget' });

export type CmsResolvedWidget = z.infer<typeof cmsResolvedWidgetSchema>;

export const cmsWidgetRendererOptionSchema = z.object({
  key: cmsWidgetRendererKeySchema,
  label: z.string(),
}).meta({ id: 'CmsWidgetRendererOption' });

export type CmsWidgetRendererOption = z.infer<typeof cmsWidgetRendererOptionSchema>;

export const cmsWidgetPreviewSchema = z.object({
  siteId: z.int(),
  widget: cmsResolvedWidgetSchema,
  html: z.string(),
  documentHtml: z.string(),
  renderers: z.array(cmsWidgetRendererOptionSchema),
}).meta({ id: 'CmsWidgetPreview' });

export type CmsWidgetPreview = z.infer<typeof cmsWidgetPreviewSchema>;

export const cmsWidgetSlotSchema = z.object({
  key: z.enum(CMS_WIDGET_SLOT_KEYS),
  label: z.string(),
  allowedTypes: z.array(cmsWidgetTypeSchema),
  rendererKeys: z.array(cmsWidgetRendererKeySchema),
  binding: cmsWidgetRefSchema.nullable(),
}).meta({ id: 'CmsWidgetSlot' });

export type CmsWidgetSlot = z.infer<typeof cmsWidgetSlotSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsWidgetListQuery = paginationQuery.extend({
  siteId: z.coerce.number().int().positive(),
  keyword: z.string().max(100).optional(),
  status: z.enum(CMS_WIDGET_STATUSES).optional(),
  type: cmsWidgetTypeSchema.optional(),
});

export const cmsWidgetRenderersQuery = z.object({
  siteId: z.coerce.number().int().positive(),
  type: cmsWidgetTypeSchema.default('manual-list'),
});

export const cmsWidgetSlotKeyParam = z.object({
  slotKey: z.enum(CMS_WIDGET_SLOT_KEYS).meta({ description: '主题插槽键', example: 'home.sidebar' }),
});

export const cmsWidgetSourceRefsQuery = z.object({
  sourceType: z.enum(CMS_WIDGET_LIVE_SOURCE_TYPES),
  sourceId: z.coerce.number().int().positive(),
});

export const cmsWidgetPreviewQuery = z.object({
  rendererKey: cmsWidgetRendererKeySchema.optional(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsWidgetContract = defineContract('/api/cms/widgets', {
  list: op.get('/', { query: cmsWidgetListQuery, response: paginated(cmsWidgetSchema), summary: '页面部件分页列表' }),
  options: op.get('/options', { query: cmsSiteScopeQuery, response: z.array(cmsWidgetSchema), summary: '已发布页面部件选项' }),
  renderers: op.get('/renderers', { query: cmsWidgetRenderersQuery, response: z.array(cmsWidgetRendererOptionSchema), summary: '当前站点主题支持的部件展示模板' }),
  slots: op.get('/slots', { query: cmsSiteScopeQuery, response: z.array(cmsWidgetSlotSchema), summary: '当前站点主题部件插槽' }),
  saveSlot: op.put('/slots/{slotKey}', { params: cmsWidgetSlotKeyParam, body: saveCmsWidgetSlotSchema, response: z.array(cmsWidgetSlotSchema), summary: '绑定或清空主题部件插槽' }),
  batch: op.post('/batch', { body: batchCmsWidgetSchema, response: asyncTaskSchema, summary: '提交页面部件批量发布/下线/删除任务' }),
  sourceRefs: op.get('/source-refs', { query: cmsWidgetSourceRefsQuery, response: z.array(cmsWidgetSourceReferenceSchema), summary: '查看内容或栏目被哪些已发布页面部件引用' }),
  refs: op.get('/{id}/refs', { params: idParam, response: z.array(cmsWidgetRefSchema), summary: '查看页面部件引用位置' }),
  preview: op.get('/{id}/preview', { params: idParam, query: cmsWidgetPreviewQuery, response: cmsWidgetPreviewSchema, summary: '按当前草稿生成页面部件 SSR 预览' }),
  publish: op.post('/{id}/publish', { params: idParam, response: cmsWidgetSchema, summary: '发布页面部件' }),
  offline: op.post('/{id}/offline', { params: idParam, response: cmsWidgetSchema, summary: '下线页面部件' }),
  detail: op.get('/{id}', { params: idParam, response: cmsWidgetSchema, summary: '页面部件详情' }),
  create: op.post('/', { body: createCmsWidgetSchema, response: cmsWidgetSchema, summary: '创建页面部件草稿' }),
  update: op.put('/{id}', { params: idParam, body: updateCmsWidgetSchema, response: cmsWidgetSchema, summary: '保存页面部件草稿' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除未被引用的页面部件' }),
}, { tags: ['CMS-页面部件'] });
