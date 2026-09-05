import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import { MP_MATERIAL_TYPES } from '../constants';
import { createMpMaterialSchema, mpAccountIdBody, updateMpMaterialSchema } from '../validation';
import { mpAccountIdQuery, mpSyncResultSchema } from './common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const mpMaterialSchema = z.object({
  id: z.int(),
  accountId: z.int(),
  type: z.enum(MP_MATERIAL_TYPES),
  name: z.string(),
  wechatMediaId: z.string().nullable().meta({ description: '微信永久素材 media_id，未上传到微信为 null' }),
  url: z.string().nullable(),
  fileSize: z.int().nullable(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'MpMaterial' });

export type MpMaterial = z.infer<typeof mpMaterialSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const mpMaterialListQuery = paginationQuery.extend({
  ...mpAccountIdQuery.shape,
  type: z.enum(MP_MATERIAL_TYPES).optional(),
  keyword: z.string().optional().meta({ description: '按素材名模糊匹配' }),
});

/** 二进制素材上传表单：字段以字符串提交，服务端解析后校验 */
export const uploadMpMaterialBody = multipart(z.object({
  accountId: z.string().meta({ description: '公众号 ID' }),
  type: z.string().meta({ description: '素材类型：image / voice / video / thumb' }),
  name: z.string().optional().meta({ description: '素材名称，缺省取文件名' }),
  title: z.string().optional().meta({ description: '视频标题（type=video）' }),
  introduction: z.string().optional().meta({ description: '视频描述（type=video）' }),
  file: fileField('素材文件'),
}));

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpMaterialContract = defineContract('/api/mp/materials', {
  list: op.get('/', { query: mpMaterialListQuery, response: paginated(mpMaterialSchema), summary: '素材列表' }),
  sync: op.post('/sync', { body: mpAccountIdBody, response: mpSyncResultSchema, summary: '从微信同步永久素材' }),
  upload: op.post('/upload', {
    body: uploadMpMaterialBody,
    response: mpMaterialSchema,
    summary: '上传二进制素材到微信',
    description: '上传图片/语音/视频/缩略图文件到微信永久素材库，成功后登记本地素材。',
  }),
  create: op.post('/', { body: createMpMaterialSchema, response: mpMaterialSchema, summary: '新增素材' }),
  update: op.put('/{id}', { params: idParam, body: updateMpMaterialSchema, response: mpMaterialSchema, summary: '重命名素材' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除素材' }),
}, { tags: ['公众号素材'] });
