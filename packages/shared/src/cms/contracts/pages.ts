import * as z from 'zod';
import { entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { CMS_PAGE_BLOCK_AUDIENCES, CMS_PAGE_BLOCK_TYPE_VALUES } from '../constants';
import { createCmsPageSchema, setCmsPageBlockAclSchema, updateCmsPageSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsPageBlockDisplayConditionViewSchema = z.object({
  audience: z.enum(CMS_PAGE_BLOCK_AUDIENCES),
  startAt: z.string().nullable().optional(),
  endAt: z.string().nullable().optional(),
}).meta({ id: 'CmsPageBlockDisplayCondition' });

export type CmsPageBlockDisplayCondition = z.infer<typeof cmsPageBlockDisplayConditionViewSchema>;

export const cmsPageBlockViewSchema = z.object({
  id: z.string(),
  type: z.enum(CMS_PAGE_BLOCK_TYPE_VALUES),
  props: z.record(z.string(), z.unknown()),
  displayCondition: cmsPageBlockDisplayConditionViewSchema.optional(),
  canManage: z.boolean().optional().meta({ description: '管理端详情按当前用户计算；写入时忽略' }),
  aclConfigured: z.boolean().optional(),
  disabledReason: z.string().nullable().optional(),
}).meta({ id: 'CmsPageBlock' });

export type CmsPageBlock = z.infer<typeof cmsPageBlockViewSchema>;

export const cmsPageBlockAclSchema = z.object({
  id: z.int(),
  pageId: z.int(),
  blockId: z.string(),
  subjectType: z.enum(['user', 'role']),
  subjectId: z.int(),
  subjectName: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'CmsPageBlockAcl' });

export type CmsPageBlockAcl = z.infer<typeof cmsPageBlockAclSchema>;

export const cmsPageSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  name: z.string(),
  slug: z.string(),
  path: z.string().nullable().meta({ example: 'about', description: '自定义访问路径（已归一，无前后斜杠）；为空时回落 /p/{slug}/' }),
  isHome: z.boolean(),
  blocks: z.array(cmsPageBlockViewSchema),
  requiresDynamic: z.boolean().meta({ description: 'guest / member 展示条件存在时强制动态渲染，禁止静态输出' }),
  seoTitle: z.string().nullable(),
  seoKeywords: z.string().nullable(),
  seoDescription: z.string().nullable(),
  status: entityStatusSchema,
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsPage' });

export type CmsPage = z.infer<typeof cmsPageSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsPageListQuery = paginationQuery.extend({
  siteId: z.coerce.number().int().positive(),
  keyword: z.string().optional(),
});

export const cmsPageBlockAclQuery = z.object({
  blockId: z.string().min(1).max(100).optional(),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsPageContract = defineContract('/api/cms/pages', {
  list: op.get('/', { query: cmsPageListQuery, response: paginated(cmsPageSchema), summary: '页面分页列表' }),
  blockAcls: op.get('/{id}/block-acls', { params: idParam, query: cmsPageBlockAclQuery, response: z.array(cmsPageBlockAclSchema), summary: '查看页面区块 ACL' }),
  setBlockAcls: op.put('/{id}/block-acls', { params: idParam, body: setCmsPageBlockAclSchema, response: z.array(cmsPageBlockAclSchema), summary: '批量设置页面区块 ACL（用户/角色）' }),
  detail: op.get('/{id}', { params: idParam, response: cmsPageSchema, summary: '页面详情' }),
  create: op.post('/', { body: createCmsPageSchema, response: cmsPageSchema, summary: '创建页面' }),
  update: op.put('/{id}', { params: idParam, body: updateCmsPageSchema, response: cmsPageSchema, summary: '更新页面' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除页面' }),
}, { tags: ['CMS-页面搭建'] });
