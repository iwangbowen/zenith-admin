import * as z from 'zod';
import { batchIdsBody, idParam, idQuery, paginated, paginationQuery, queryEnum, keywordQuery, requiredIdQuery } from '../../core/api-schemas';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { CMS_RESOURCE_OWNER_TYPES, CMS_RESOURCE_TYPES } from '../constants';
import {
  cmsResourceGovernanceSchema,
  cmsSiteIdBodySchema,
  createCmsResourceFolderSchema,
  cropCmsResourceSchema,
  submitMoveCmsResourcesSchema,
  updateCmsResourceFolderSchema,
  updateCmsResourceSchema,
} from '../validation';
import { cmsSiteScopeQuery } from './tags';
import { updateCmsAssetRightsSchema } from '../design-validation';

export const cmsAssetVersionSchema = z.object({ id: z.int(), resourceId: z.int(), version: z.int(), url: z.string(), thumbUrl: z.string().nullable(), fileId: z.string().nullable(), mimeType: z.string().nullable(), size: z.int(), width: z.int().nullable(), height: z.int().nullable(), contentHash: z.string(), createdAt: z.string() }).meta({ id: 'CmsAssetVersion' });
export const cmsAssetRightsSchema = z.object({ resourceId: z.int(), source: z.string().nullable(), license: z.string().nullable(), expiresAt: z.string().nullable(), revoked: z.boolean(), tags: z.array(z.string()), alt: z.string().nullable() }).meta({ id: 'CmsAssetRights' });

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const cmsResourceTypeSchema = z.enum(CMS_RESOURCE_TYPES);

export const cmsResourceSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  folderId: z.int().nullable(),
  folderName: z.string().nullable().optional(),
  type: cmsResourceTypeSchema,
  name: z.string(),
  url: z.string(),
  thumbUrl: z.string().nullable(),
  fileId: z.string().nullable(),
  size: z.int(),
  width: z.int().nullable(),
  height: z.int().nullable(),
  mimeType: z.string().nullable(),
  remark: z.string().nullable(),
  ownsFile: z.boolean().meta({ description: 'false = 仅引用登记（文件由文件中心/来源站点持有），删除素材不会删除物理文件' }),
  refCount: z.int().optional().meta({ description: '站内引用数（列表返回；0 = 孤立素材）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CmsResource' });

export type CmsResource = z.infer<typeof cmsResourceSchema>;

/** 素材引用位置（删除前校验 / 引用查询） */
export const cmsResourceReferenceSchema = z.object({
  kind: z.enum(CMS_RESOURCE_OWNER_TYPES),
  id: z.int(),
  title: z.string(),
  field: z.string(),
  href: z.string().optional(),
}).meta({ id: 'CmsResourceReference' });

export type CmsResourceReference = z.infer<typeof cmsResourceReferenceSchema>;

/** 素材文件夹节点字段（不含子树）；文件夹树在此基础上递归挂 children */
export const cmsResourceFolderFieldsSchema = z.object({
  id: z.int(),
  siteId: z.int(),
  parentId: z.int().nullable(),
  name: z.string(),
  sort: z.int(),
  resourceCount: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** 递归类型需要显式命名，声明文件才能保留 children 的元素类型 */
export interface CmsResourceFolder extends z.infer<typeof cmsResourceFolderFieldsSchema> {
  children?: CmsResourceFolder[];
}

export const cmsResourceFolderSchema: z.ZodType<CmsResourceFolder> = cmsResourceFolderFieldsSchema
  .extend({
    get children() {
      return z.array(cmsResourceFolderSchema).optional();
    },
  })
  .meta({ id: 'CmsResourceFolder' });

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const cmsResourceListQuery = paginationQuery.extend({
  siteId: requiredIdQuery(),
  type: queryEnum(CMS_RESOURCE_TYPES),
  keyword: keywordQuery(undefined, { max: 100 }),
  folderId: z.coerce.number().int().min(0).optional().meta({ description: '0 = 仅根目录' }),
});

export const cmsResourceUploadQuery = z.object({
  siteId: requiredIdQuery(),
  folderId: idQuery(),
});

export const cmsResourceSelectionQuery = z.object({
  siteId: requiredIdQuery(),
  value: z.string().trim().min(1).max(500),
  type: queryEnum(CMS_RESOURCE_TYPES),
});

const cmsResourceFileBody = multipart(z.object({
  file: fileField(),
}));

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsResourceContract = defineContract('/api/cms/resources', {
  selection: op.get('/selection', { access: { permission: 'cms:resource:list' }, query: cmsResourceSelectionQuery, response: cmsResourceSchema.nullable(), summary: '按本站素材句柄或已登记地址精确回显素材' }),
  versions: op.get('/{id}/versions', { access: { permission: 'cms:resource:list' }, params: idParam, response: z.array(cmsAssetVersionSchema), summary: '素材不可变文件版本' }),
  rights: op.get('/{id}/rights', { access: { permission: 'cms:resource:list' }, params: idParam, response: cmsAssetRightsSchema, summary: '素材来源与版权' }),
  updateRights: op.put('/{id}/rights', { access: { permission: 'cms:resource:update' }, params: idParam, body: updateCmsAssetRightsSchema, response: cmsAssetRightsSchema, audit: '更新 CMS 素材版权', summary: '维护素材授权与替代文本' }),
  list: op.get('/', { access: { permission: 'cms:resource:list' }, query: cmsResourceListQuery, response: paginated(cmsResourceSchema), summary: '素材分页列表' }),
  folders: op.get('/folders', { access: { permission: 'cms:resource:list' }, query: cmsSiteScopeQuery, response: z.array(cmsResourceFolderSchema), summary: '素材文件夹树' }),
  folderCreate: op.post('/folders', { access: { permission: 'cms:resource:update' }, audit: '创建 CMS 素材文件夹', body: createCmsResourceFolderSchema, response: cmsResourceFolderSchema, summary: '创建素材文件夹' }),
  folderUpdate: op.put('/folders/{id}', { access: { permission: 'cms:resource:update' }, audit: '更新 CMS 素材文件夹', params: idParam, body: updateCmsResourceFolderSchema, response: cmsResourceFolderSchema, summary: '移动或重命名素材文件夹' }),
  folderRemove: op.delete('/folders/{id}', { access: { permission: 'cms:resource:delete' }, audit: '删除 CMS 素材文件夹', params: idParam, summary: '删除空素材文件夹' }),
  upload: op.post('/upload', { access: { permission: 'cms:resource:upload' }, audit: { description: 'CMS 上传素材', recordBody: false }, query: cmsResourceUploadQuery, body: cmsResourceFileBody, response: cmsResourceSchema, summary: '上传素材（图片按站点配置压缩/水印/缩略图）' }),
  update: op.put('/{id}', { access: { permission: 'cms:resource:update' }, audit: 'CMS 编辑素材', params: idParam, body: updateCmsResourceSchema, response: cmsResourceSchema, summary: '编辑素材（重命名/备注）' }),
  references: op.get('/{id}/references', { access: { permission: 'cms:resource:list' }, params: idParam, response: z.array(cmsResourceReferenceSchema), summary: '素材站内引用（内容/栏目/广告等）' }),
  crop: op.post('/{id}/crop', { access: { permission: 'cms:resource:update' }, audit: 'CMS 裁剪素材', params: idParam, body: cropCmsResourceSchema, response: cmsResourceSchema, summary: '裁剪图片（非破坏，另存为新素材）' }),
  replace: op.post('/{id}/replace', { access: { permission: 'cms:resource:update' }, audit: { description: 'CMS 替换素材', recordBody: false }, params: idParam, body: cmsResourceFileBody, response: cmsResourceSchema, summary: '创建素材新版本（已发布修订固定原文件）' }),
  batchDelete: op.post('/delete', { access: { permission: 'cms:resource:delete' }, audit: 'CMS 删除素材', body: batchIdsBody, summary: '批量删除素材（存在站内引用则拒绝）' }),
  governance: op.post('/governance', { access: { permission: 'cms:resource:delete' }, audit: '提交 CMS 素材治理任务', body: cmsResourceGovernanceSchema, response: asyncTaskSchema, summary: '提交孤立素材扫描/清理任务' }),
  rebuildRefs: op.post('/rebuild-refs', { access: { permission: 'cms:resource:update' }, audit: '重建 CMS 素材引用索引', body: cmsSiteIdBodySchema, response: asyncTaskSchema, summary: '提交素材引用索引重建任务（存量回填 / 索引修复）' }),
  move: op.post('/move', { access: { permission: 'cms:resource:update' }, audit: '批量移动 CMS 素材', body: submitMoveCmsResourcesSchema, response: asyncTaskSchema, summary: '提交批量移动素材任务' }),
}, { auditModule: 'CMS内容管理', tags: ['CMS-素材中心'] });
