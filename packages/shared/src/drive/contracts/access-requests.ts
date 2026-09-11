import * as z from 'zod';
import { idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { DRIVE_ACCESS_REQUEST_BOXES, DRIVE_ACCESS_REQUEST_STATUSES, DRIVE_NODE_TYPES, DRIVE_REQUESTABLE_ROLES, DRIVE_ROLES } from '../constants';
import { createDriveAccessRequestSchema, decideDriveAccessRequestSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const driveAccessRequestSchema = z.object({
  id: z.int(),
  nodeId: z.int(),
  nodeName: z.string(),
  nodeType: z.enum(DRIVE_NODE_TYPES),
  spaceId: z.int(),
  spaceName: z.string(),
  requesterId: z.int(),
  requesterName: z.string().nullable(),
  role: z.enum(DRIVE_REQUESTABLE_ROLES),
  reason: z.string().nullable(),
  status: z.enum(DRIVE_ACCESS_REQUEST_STATUSES),
  /** 审批通过时实际授予的角色 */
  grantedRole: z.enum(DRIVE_ROLES).nullable(),
  grantedExpireAt: z.string().nullable(),
  decidedBy: z.int().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'DriveAccessRequest' });

export type DriveAccessRequest = z.infer<typeof driveAccessRequestSchema>;

/** 无权访问节点时对申请人暴露的最小信息 */
export const driveAccessTargetSchema = z.object({
  nodeId: z.int(),
  nodeName: z.string(),
  nodeType: z.enum(DRIVE_NODE_TYPES),
  spaceName: z.string(),
  /** 我尚未处理的申请（避免重复提交） */
  pendingRequestId: z.int().nullable(),
}).meta({ id: 'DriveAccessTarget' });

export type DriveAccessTarget = z.infer<typeof driveAccessTargetSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const driveAccessRequestListQuery = paginationQuery.extend({
  /** inbox = 待我审批（我是节点管理者）；outbox = 我提交的 */
  box: queryEnum(DRIVE_ACCESS_REQUEST_BOXES).default('inbox'),
  status: queryEnum(DRIVE_ACCESS_REQUEST_STATUSES),
});

export const driveAccessRequestContract = defineContract('/api/drive/access-requests', {
  list: op.get('/', { query: driveAccessRequestListQuery, response: paginated(driveAccessRequestSchema), summary: '访问申请列表（待我审批 / 我提交的）' }),
  pendingCount: op.get('/pending-count', { response: z.int(), summary: '待我审批的申请数' }),
  target: op.get('/targets/{id}', { params: idParam, response: driveAccessTargetSchema, summary: '无权访问节点的最小信息（用于发起申请）' }),
  create: op.post('/', { body: createDriveAccessRequestSchema, response: driveAccessRequestSchema, summary: '申请访问文件或文件夹' }),
  decide: op.post('/{id}/decide', { params: idParam, body: decideDriveAccessRequestSchema, response: driveAccessRequestSchema, summary: '审批通过 / 拒绝（节点 manager）' }),
  cancel: op.post('/{id}/cancel', { params: idParam, response: driveAccessRequestSchema, summary: '撤回我的申请' }),
}, { tags: ['企业网盘-访问申请'] });
