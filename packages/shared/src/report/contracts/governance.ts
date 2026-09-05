import * as z from 'zod';
import { auditFieldsSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { REPORT_APPROVAL_ACTIONS } from '../constants';
import { REPORT_ACL_ROLES, REPORT_ACL_SUBJECT_TYPES, REPORT_APPROVAL_STATUSES, REPORT_RESOURCE_TYPES, REPORT_TRANSFER_STATUSES } from '../types';
import {
  cancelReportPublishApprovalSchema,
  cancelReportResourceTransferSchema,
  checkReportResourceAccessSchema,
  createReportPublishApprovalSchema,
  createReportResourceTransferSchema,
  decideReportPublishApprovalSchema,
  decideReportResourceTransferSchema,
  grantReportResourceAclSchema,
  reportApprovalStatusSchema,
  reportResourceTypeSchema,
  reportTransferStatusSchema,
  updateReportResourceAclSchema,
} from '../validation';

const resourceTypeSchema = z.enum(REPORT_RESOURCE_TYPES);

// ─── 资源权限 / 审批 / 转移 ─────────────────────────────────────────────────

export const reportResourceAclSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  resourceType: resourceTypeSchema,
  resourceId: z.int(),
  subjectType: z.enum(REPORT_ACL_SUBJECT_TYPES),
  subjectId: z.int(),
  role: z.enum(REPORT_ACL_ROLES),
  inheritFromFolder: z.boolean(),
  expiresAt: z.string().nullable().optional(),
  grantedBy: z.int().nullable(),
  grantedByName: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportResourceAcl' });

export type ReportResourceAcl = z.infer<typeof reportResourceAclSchema>;

export const reportResourceAccessResultSchema = z.object({
  allowed: z.boolean(),
  requiredRole: z.enum(REPORT_ACL_ROLES),
}).meta({ id: 'ReportResourceAccessResult' });

export type ReportResourceAccessResult = z.infer<typeof reportResourceAccessResultSchema>;

export const reportPublishApprovalSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  resourceType: resourceTypeSchema,
  resourceId: z.int(),
  resourceName: z.string().nullable().optional(),
  action: z.enum(REPORT_APPROVAL_ACTIONS),
  requestedRevision: z.int(),
  snapshot: z.record(z.string(), z.unknown()),
  status: z.enum(REPORT_APPROVAL_STATUSES),
  requestedBy: z.int().nullable(),
  requestedByName: z.string().nullable().optional(),
  requestedAt: z.string(),
  decidedBy: z.int().nullable().optional(),
  decidedByName: z.string().nullable().optional(),
  decidedAt: z.string().nullable().optional(),
  decisionNote: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportPublishApproval' });

export type ReportPublishApproval = z.infer<typeof reportPublishApprovalSchema>;

export const reportResourceTransferSchema = z.object({
  id: z.int(),
  tenantId: z.int().nullable(),
  resourceType: resourceTypeSchema,
  resourceId: z.int(),
  resourceName: z.string().nullable().optional(),
  fromOwnerId: z.int().nullable(),
  fromOwnerName: z.string().nullable().optional(),
  toOwnerId: z.int(),
  toOwnerName: z.string().nullable().optional(),
  status: z.enum(REPORT_TRANSFER_STATUSES),
  reason: z.string().nullable().optional(),
  requestedBy: z.int().nullable(),
  decidedBy: z.int().nullable().optional(),
  decidedAt: z.string().nullable().optional(),
  decisionNote: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportResourceTransfer' });

export type ReportResourceTransfer = z.infer<typeof reportResourceTransferSchema>;

export const reportResourceRefQuery = z.object({
  resourceType: reportResourceTypeSchema,
  resourceId: z.coerce.number().int().positive(),
  // 查询串布尔不能用 z.coerce.boolean()（'false' 会变 true）；空串视为未传，缺省回落 false
  inheritFromFolder: z
    .preprocess((v) => (v === '' ? undefined : v), z.stringbool().default(false))
    .meta({ type: 'boolean', default: false, description: '是否包含从目录继承的权限' }),
});

export const reportApprovalListQuery = paginationQuery.extend({
  status: reportApprovalStatusSchema.optional(),
  resourceType: reportResourceTypeSchema.optional(),
});

export const reportTransferListQuery = paginationQuery.extend({
  status: reportTransferStatusSchema.optional(),
  resourceType: reportResourceTypeSchema.optional(),
});

export const reportGovernanceContract = defineContract('/api/report/governance', {
  acls: op.get('/acls', { query: reportResourceRefQuery, response: z.array(reportResourceAclSchema), summary: '资源权限列表' }),
  grantAcl: op.post('/acls', { body: grantReportResourceAclSchema, response: reportResourceAclSchema, summary: '授予资源权限' }),
  updateAcl: op.put('/acls/{id}', { params: idParam, body: updateReportResourceAclSchema, response: reportResourceAclSchema, summary: '更新资源权限' }),
  revokeAcl: op.delete('/acls/{id}', { params: idParam, summary: '撤销资源权限' }),
  checkAccess: op.post('/access/check', { body: checkReportResourceAccessSchema, response: reportResourceAccessResultSchema, summary: '检查资源权限' }),
  transfers: op.get('/transfers', { query: reportTransferListQuery, response: paginated(reportResourceTransferSchema), summary: '资源转移列表' }),
  createTransfer: op.post('/transfers', { body: createReportResourceTransferSchema, response: reportResourceTransferSchema, summary: '申请资源转移' }),
  decideTransfer: op.post('/transfers/{id}/decision', { params: idParam, body: decideReportResourceTransferSchema, response: reportResourceTransferSchema, summary: '接受或拒绝资源转移' }),
  cancelTransfer: op.post('/transfers/{id}/cancel', { params: idParam, body: cancelReportResourceTransferSchema, response: reportResourceTransferSchema, summary: '取消资源转移' }),
  approvals: op.get('/approvals', { query: reportApprovalListQuery, response: paginated(reportPublishApprovalSchema), summary: '发布审批列表' }),
  createApproval: op.post('/approvals', { body: createReportPublishApprovalSchema, response: reportPublishApprovalSchema, summary: '申请发布审批' }),
  decideApproval: op.post('/approvals/{id}/decision', { params: idParam, body: decideReportPublishApprovalSchema, response: reportPublishApprovalSchema, summary: '通过或拒绝发布审批' }),
  cancelApproval: op.post('/approvals/{id}/cancel', { params: idParam, body: cancelReportPublishApprovalSchema, response: reportPublishApprovalSchema, summary: '取消发布审批' }),
}, { tags: ['报表资源治理'] });
