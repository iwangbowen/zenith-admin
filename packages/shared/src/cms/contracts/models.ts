import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { CMS_FIELD_OPTION_SOURCES, CMS_FIELD_TYPES } from '../constants';
import { createCmsModelSchema, updateCmsModelSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

const cmsFieldOptionSchema = z.object({ label: z.string(), value: z.string() });

export const cmsModelFieldViewSchema = z.object({
  id: z.int(),
  modelId: z.int(),
  name: z.string().meta({ example: 'video_url' }),
  label: z.string().meta({ example: '视频地址' }),
  fieldType: z.enum(CMS_FIELD_TYPES),
  required: z.boolean(),
  searchable: z.boolean(),
  showInList: z.boolean(),
  showInDetail: z.boolean().meta({ description: '是否在前台详情页「模型字段表」中展示' }),
  detailGroup: z.string().nullable().meta({ description: '详情展示分组标题（如「文件信息」）' }),
  detailSort: z.int().meta({ description: '详情展示排序（组内）' }),
  placeholder: z.string().nullable(),
  defaultValue: z.string().nullable(),
  optionSource: z.enum(CMS_FIELD_OPTION_SOURCES).meta({ description: '选项来源：manual=手工维护，dict=引用系统字典' }),
  dictCode: z.string().nullable().meta({ description: 'optionSource=dict 时引用的字典编码' }),
  options: z.array(cmsFieldOptionSchema).nullable().meta({ description: '手工维护的原始选项（optionSource=manual 时有效）' }),
  resolvedOptions: z.array(cmsFieldOptionSchema).optional()
    .meta({ description: '解析后的最终选项（manual 取 options，dict 取字典项）；表单渲染消费本字段' }),
  sort: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsModelField' });

export type CmsModelField = z.infer<typeof cmsModelFieldViewSchema>;

export const cmsModelSchema = z.object({
  id: z.int(),
  ownerSiteId: z.int().nullable().meta({ description: '归属站点：null = 平台共享（全部站点可用）' }),
  ownerSiteName: z.string().nullable(),
  name: z.string().meta({ example: '文章' }),
  code: z.string().meta({ example: 'article' }),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  status: entityStatusSchema,
  sort: z.int(),
  fields: z.array(cmsModelFieldViewSchema).optional().meta({ description: '详情 / 下拉源返回；分页列表省略' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsModel' });

export type CmsModel = z.infer<typeof cmsModelSchema>;

/** 模型引用统计（删除阻断明细与「使用中」列消费） */
export const cmsModelRefsSchema = z.object({
  channels: z.array(z.object({
    id: z.int(),
    siteId: z.int(),
    siteName: z.string(),
    name: z.string(),
  })),
  contentCount: z.int(),
  siteExtendCount: z.int(),
}).meta({ id: 'CmsModelRefs' });

export type CmsModelRefs = z.infer<typeof cmsModelRefsSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

/** 普通用户读写模型必须限定站点；平台管理员省略即全局视角 */
export const cmsModelScopeQuery = z.object({
  siteId: z.coerce.number().int().positive().optional(),
});

export const cmsModelListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  status: entityStatusSchema.optional(),
  siteId: z.coerce.number().int().positive().optional().meta({ description: '站群可见性过滤：返回平台共享 + 该站点专属的模型' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsModelContract = defineContract('/api/cms/models', {
  list: op.get('/', { query: cmsModelListQuery, response: paginated(cmsModelSchema), summary: '模型分页列表' }),
  all: op.get('/all', { query: cmsModelScopeQuery, response: z.array(cmsModelSchema), summary: '全部启用模型（栏目绑定下拉；普通请求必须提供 siteId）' }),
  detail: op.get('/{id}', { params: idParam, query: cmsModelScopeQuery, response: cmsModelSchema, summary: '模型详情（含字段）' }),
  refs: op.get('/{id}/refs', { params: idParam, query: cmsModelScopeQuery, response: cmsModelRefsSchema, summary: '模型引用统计（被哪些栏目绑定、内容/站点扩展使用量）' }),
  create: op.post('/', { body: createCmsModelSchema, response: cmsModelSchema, summary: '创建模型' }),
  update: op.put('/{id}', { params: idParam, query: cmsModelScopeQuery, body: updateCmsModelSchema, response: cmsModelSchema, summary: '更新模型（fields 提供时整组替换）' }),
  remove: op.delete('/{id}', { params: idParam, query: cmsModelScopeQuery, summary: '删除模型' }),
}, { tags: ['CMS-内容模型'] });
