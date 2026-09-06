import * as z from 'zod';
import { auditFieldsSchema, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { sensitive } from '../../core/sensitive';
import { createTenantSchema, updateTenantSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const tenantSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '示例租户' }),
  code: z.string().meta({ example: 'demo' }),
  logo: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactPhone: sensitive(z.string().nullable(), 'phone', '联系电话').optional(),
  status: entityStatusSchema,
  expireAt: z.string().nullable().optional(),
  maxUsers: z.int().nullable().optional(),
  packageId: z.int().nullable().optional(),
  packageName: z.string().nullable().optional(),
  userCount: z.int().optional().meta({ description: '租户当前用户数（列表返回）' }),
  remark: z.string().nullable().optional(),
  initialAdmin: z
    .object({
      username: z.string(),
      email: z.string(),
      password: z.string().meta({ description: '初始密码，仅创建响应中一次性返回' }),
    })
    .nullable()
    .optional()
    .meta({ description: '自动初始化的租户管理员账号（仅创建且指定 adminUsername 时返回）' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'Tenant' });

export type Tenant = z.infer<typeof tenantSchema>;

/** 下拉源精简项（租户切换器 / 身份源配置） */
export const tenantOptionSchema = tenantSchema
  .pick({ id: true, name: true, code: true, status: true })
  .meta({ id: 'TenantOption' });

export type TenantOption = z.infer<typeof tenantOptionSchema>;

export const tenantStatsSchema = z.object({
  id: z.int(),
  name: z.string(),
  code: z.string(),
  status: entityStatusSchema,
  userCount: z.int(),
  maxUsers: z.int().nullable(),
  departmentCount: z.int(),
  roleCount: z.int(),
  positionCount: z.int(),
  packageId: z.int().nullable(),
  packageName: z.string().nullable(),
  packageFeatureCount: z.int().meta({ description: '套餐已分配的可授权功能数量' }),
  expireAt: z.string().nullable(),
  daysToExpire: z.int().nullable().meta({ description: '距到期天数；null=永不过期，负数=已过期' }),
}).meta({ id: 'TenantStats' });

export type TenantStats = z.infer<typeof tenantStatsSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const tenantListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按名称模糊匹配' }),
  status: entityStatusSchema.optional(),
});

export const tenantContract = defineContract('/api/tenants', {
  list: op.get('/', { query: tenantListQuery, response: paginated(tenantSchema), summary: '租户列表' }),
  all: op.get('/all', { response: z.array(tenantOptionSchema), summary: '全部租户' }),
  stats: op.get('/{id}/stats', { params: idParam, response: tenantStatsSchema, summary: '租户用量概览' }),
  detail: op.get('/{id}', { params: idParam, response: tenantSchema, summary: '租户详情' }),
  create: op.post('/', { body: createTenantSchema, response: tenantSchema, summary: '创建租户' }),
  update: op.put('/{id}', { params: idParam, body: updateTenantSchema, response: tenantSchema, summary: '更新租户' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除租户' }),
}, { tags: ['Tenants'] });
