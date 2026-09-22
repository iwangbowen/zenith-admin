import * as z from 'zod';
import { defineContract, op } from '../../core/contract';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 业务记录（公告、知识库文档等）与托管文件的多态关联 */
export const businessFileSchema = z.object({
  id: z.int(),
  businessType: z.string().meta({ example: 'announcement' }),
  businessId: z.int(),
  fileId: z.uuid(),
  name: z.string().nullable(),
  category: z.string().nullable(),
  sortOrder: z.int(),
  file: z.object({
    id: z.uuid(),
    originalName: z.string(),
    size: z.int(),
    mimeType: z.string().nullable(),
    extension: z.string().nullable(),
    url: z.string().meta({ description: '稳定代理路径 /api/files/{id}/content' }),
    directUrl: z.string().nullable().optional().meta({ description: 'public 策略的永久公开直链；仅渲染用' }),
  }),
  createdAt: z.string(),
}).meta({ id: 'BusinessFile' });

export type BusinessFile = z.infer<typeof businessFileSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

const businessFileParams = z.object({
  businessType: z.string().meta({ description: '业务类型', example: 'announcement' }),
  businessId: z.coerce.number().int().meta({ description: '业务记录 ID', example: 1 }),
});

const businessFileItemParams = businessFileParams.extend({
  fileId: z.uuid().meta({ description: '文件 ID', example: '018f6f8a-5f76-7d8c-9a1b-2c3d4e5f6789' }),
});

export const managedBusinessFileSchema = businessFileSchema.shape.file.extend({ createdAt: z.string() })
  .meta({ id: 'ManagedBusinessFile' });
const managedBusinessFileParams = z.object({ fileId: z.uuid() });

export const businessFileContract = defineContract('/api/business-files', {
  managedDetail: op.get('/managed/{fileId}', { access: 'authenticated', params: managedBusinessFileParams, response: managedBusinessFileSchema, summary: '按可见业务引用读取附件详情' }),
  managedContent: op.get('/managed/{fileId}/content', { access: 'authenticated', params: managedBusinessFileParams, kind: 'file', summary: '按可见业务引用读取附件内容' }),
  list: op.get('/{businessType}/{businessId}', { access: 'authenticated', params: businessFileParams, response: z.array(businessFileSchema), summary: '获取业务附件列表' }),
  remove: op.delete('/{businessType}/{businessId}/{fileId}', { access: { permission: 'system:file:delete' }, audit: '移除业务附件', params: businessFileItemParams, summary: '移除业务附件' }),
}, { auditModule: '文件管理', tags: ['Business Files'] });
