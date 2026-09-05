import * as z from 'zod';
import { batchIdsBody, idParam, paginated, paginationQuery } from '../../core/api-schemas';
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
  siteId: z.coerce.number().int().positive(),
  type: cmsResourceTypeSchema.optional(),
  keyword: z.string().max(100).optional(),
  folderId: z.coerce.number().int().min(0).optional().meta({ description: '0 = 仅根目录' }),
});

export const cmsResourceUploadQuery = z.object({
  siteId: z.coerce.number().int().positive(),
  folderId: z.coerce.number().int().positive().optional(),
});

const cmsResourceFileBody = multipart(z.object({
  file: fileField(),
}));

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const cmsResourceContract = defineContract('/api/cms/resources', {
  list: op.get('/', { query: cmsResourceListQuery, response: paginated(cmsResourceSchema), summary: '素材分页列表' }),
  folders: op.get('/folders', { query: cmsSiteScopeQuery, response: z.array(cmsResourceFolderSchema), summary: '素材文件夹树' }),
  folderCreate: op.post('/folders', { body: createCmsResourceFolderSchema, response: cmsResourceFolderSchema, summary: '创建素材文件夹' }),
  folderUpdate: op.put('/folders/{id}', { params: idParam, body: updateCmsResourceFolderSchema, response: cmsResourceFolderSchema, summary: '移动或重命名素材文件夹' }),
  folderRemove: op.delete('/folders/{id}', { params: idParam, summary: '删除空素材文件夹' }),
  upload: op.post('/upload', { query: cmsResourceUploadQuery, body: cmsResourceFileBody, response: cmsResourceSchema, summary: '上传素材（图片按站点配置压缩/水印/缩略图）' }),
  update: op.put('/{id}', { params: idParam, body: updateCmsResourceSchema, response: cmsResourceSchema, summary: '编辑素材（重命名/备注）' }),
  references: op.get('/{id}/references', { params: idParam, response: z.array(cmsResourceReferenceSchema), summary: '素材站内引用（内容/栏目/广告等）' }),
  crop: op.post('/{id}/crop', { params: idParam, body: cropCmsResourceSchema, response: cmsResourceSchema, summary: '裁剪图片（非破坏，另存为新素材）' }),
  replace: op.post('/{id}/replace', { params: idParam, body: cmsResourceFileBody, response: cmsResourceSchema, summary: '替换素材文件（保留素材 id，全站引用自动跟随）' }),
  batchDelete: op.post('/delete', { body: batchIdsBody, summary: '批量删除素材（存在站内引用则拒绝）' }),
  governance: op.post('/governance', { body: cmsResourceGovernanceSchema, response: asyncTaskSchema, summary: '提交孤立素材扫描/清理任务' }),
  rebuildRefs: op.post('/rebuild-refs', { body: cmsSiteIdBodySchema, response: asyncTaskSchema, summary: '提交素材引用索引重建任务（存量回填 / 索引修复）' }),
  move: op.post('/move', { body: submitMoveCmsResourcesSchema, response: asyncTaskSchema, summary: '提交批量移动素材任务' }),
}, { tags: ['CMS-素材中心'] });
