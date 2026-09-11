import * as z from 'zod';
import { auditFieldsSchema, entityStatusQuery, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createRatePlanSchema, updateRatePlanSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 限流套餐（Rate Plan / Tier） */
export const ratePlanSchema = z.object({
  id: z.int(),
  code: z.string().meta({ example: 'free' }),
  name: z.string(),
  description: z.string().nullable(),
  qpsLimit: z.int().meta({ description: '每秒请求上限（QPS），0 = 不限' }),
  dailyQuota: z.int().meta({ description: '每日调用配额，0 = 不限' }),
  monthlyQuota: z.int().meta({ description: '每月调用配额，0 = 不限' }),
  isDefault: z.boolean(),
  status: entityStatusSchema,
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'RatePlan' });

export type RatePlan = z.infer<typeof ratePlanSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const ratePlanListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按编码 / 名称模糊匹配' }),
  status: entityStatusQuery,
});

export const ratePlanContract = defineContract('/api/rate-plans', {
  list: op.get('/', { query: ratePlanListQuery, response: paginated(ratePlanSchema), summary: '获取限流套餐列表' }),
  options: op.get('/options', { response: z.array(ratePlanSchema), summary: '获取全部启用的套餐（供应用配置下拉）' }),
  detail: op.get('/{id}', { params: idParam, response: ratePlanSchema, summary: '获取限流套餐详情' }),
  create: op.post('/', { body: createRatePlanSchema, response: ratePlanSchema, summary: '创建限流套餐' }),
  update: op.put('/{id}', { params: idParam, body: updateRatePlanSchema, response: ratePlanSchema, summary: '更新限流套餐' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除限流套餐' }),
}, { tags: ['RatePlans'] });
