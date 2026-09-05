import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { REPORT_ENVIRONMENT_KINDS, REPORT_PROMOTION_STATUSES, REPORT_RESOURCE_TYPES } from '../types';
import {
  createReportEnvironmentPromotionSchema,
  createReportEnvironmentSchema,
  reportEnvironmentPromotionActionSchema,
  reportPromotionStatusSchema,
  reportResourceTypeSchema,
  updateReportEnvironmentSchema,
} from '../validation';
import { reportStatusSchema } from './_common';

const resourceTypeSchema = z.enum(REPORT_RESOURCE_TYPES);

// ─── 环境与资源发布 ─────────────────────────────────────────────────────────

export const reportEnvironmentSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(REPORT_ENVIRONMENT_KINDS),
  description: z.string().nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()),
  isDefault: z.boolean(),
  status: reportStatusSchema,
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportEnvironment' });

export type ReportEnvironment = z.infer<typeof reportEnvironmentSchema>;

export const reportEnvironmentPromotionSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  resourceType: resourceTypeSchema,
  resourceId: z.int(),
  resourceName: z.string().nullable().optional(),
  sourceEnvironmentId: z.int(),
  sourceEnvironmentName: z.string().nullable().optional(),
  targetEnvironmentId: z.int(),
  targetEnvironmentName: z.string().nullable().optional(),
  sourceRevision: z.int(),
  sourceSnapshot: z.record(z.string(), z.unknown()),
  targetSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.enum(REPORT_PROMOTION_STATUSES),
  requestedBy: z.int().nullable(),
  approvedBy: z.int().nullable().optional(),
  deployedBy: z.int().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  rollbackSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  schemaSignature: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportEnvironmentPromotion' });

export type ReportEnvironmentPromotion = z.infer<typeof reportEnvironmentPromotionSchema>;

export const reportPromotionListQuery = paginationQuery.extend({
  status: reportPromotionStatusSchema.optional(),
  resourceType: reportResourceTypeSchema.optional(),
});

export const reportEnvironmentContract = defineContract('/api/report/environments', {
  promotions: op.get('/promotions', { query: reportPromotionListQuery, response: paginated(reportEnvironmentPromotionSchema), summary: '资源发布历史' }),
  createPromotion: op.post('/promotions', { body: createReportEnvironmentPromotionSchema, response: reportEnvironmentPromotionSchema, summary: '创建资源发布' }),
  transitionPromotion: op.post('/promotions/{id}/transition', { params: idParam, body: reportEnvironmentPromotionActionSchema, response: reportEnvironmentPromotionSchema, summary: '审批、部署、取消或回滚资源发布' }),
  list: op.get('/', { response: z.array(reportEnvironmentSchema), summary: '环境列表' }),
  create: op.post('/', { body: createReportEnvironmentSchema, response: reportEnvironmentSchema, summary: '创建环境' }),
  update: op.put('/{id}', { params: idParam, body: updateReportEnvironmentSchema, response: reportEnvironmentSchema, summary: '更新环境' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除环境' }),
}, { tags: ['报表环境治理'] });
