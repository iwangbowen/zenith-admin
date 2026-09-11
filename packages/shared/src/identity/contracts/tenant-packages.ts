import * as z from 'zod';
import { auditFieldsSchema, batchIdsBody, entityStatusQuery, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { assignTenantPackageFeaturesSchema, tenantPackageQuotasSchema } from '../../licensing/validation';
import { createTenantPackageSchema, updateTenantPackageSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const tenantPackageSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '标准版' }),
  status: entityStatusSchema,
  /** 套餐配额（席位等），与 License / 租户级上限取最小值生效 */
  quotas: tenantPackageQuotasSchema.nullable().optional(),
  remark: z.string().nullable().optional(),
  features: z.array(z.string()).optional().meta({ description: '已分配的可授权功能 key（列表与详情返回）' }),
  featureCount: z.int().optional().meta({ description: '已分配功能数量' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'TenantPackage' });

export type TenantPackage = z.infer<typeof tenantPackageSchema>;

/** 下拉源精简项 */
export const tenantPackageOptionSchema = tenantPackageSchema
  .pick({ id: true, name: true, status: true })
  .meta({ id: 'TenantPackageOption' });

export type TenantPackageOption = z.infer<typeof tenantPackageOptionSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const tenantPackageListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称模糊匹配' }),
  status: entityStatusQuery,
});

export const tenantPackageContract = defineContract('/api/tenant-packages', {
  list: op.get('/', { query: tenantPackageListQuery, response: paginated(tenantPackageSchema), summary: '租户套餐列表' }),
  all: op.get('/all', { response: z.array(tenantPackageOptionSchema), summary: '全部租户套餐' }),
  detail: op.get('/{id}', { params: idParam, response: tenantPackageSchema, summary: '租户套餐详情' }),
  create: op.post('/', { body: createTenantPackageSchema, response: tenantPackageSchema, summary: '创建租户套餐' }),
  update: op.put('/{id}', { params: idParam, body: updateTenantPackageSchema, response: tenantPackageSchema, summary: '更新租户套餐' }),
  assignFeatures: op.put('/{id}/features', { params: idParam, body: assignTenantPackageFeaturesSchema, summary: '分配套餐功能' }),
  removeBatch: op.delete('/batch', { body: batchIdsBody, summary: '批量删除租户套餐' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除租户套餐' }),
}, { tags: ['TenantPackages'] });
