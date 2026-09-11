import * as z from 'zod';
import { idParam, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { WORKFLOW_INSTANCE_STATUSES } from '../../workflow/constants';
import { BIZ_LEAVE_STATUSES } from '../constants';
import { createBizLeaveSchema, updateBizLeaveSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 业务接入示例：请假单（业务模块自有实体，通过 businessKey 关联工作流） */
export const bizLeaveSchema = z.object({
  id: z.int(),
  leaveType: z.string().meta({ description: '请假类型：annual=年假, sick=病假, personal=事假, marriage=婚假, other=其他', example: 'annual' }),
  startDate: z.string().meta({ description: '开始日期 YYYY-MM-DD' }),
  endDate: z.string().meta({ description: '结束日期 YYYY-MM-DD' }),
  days: z.number(),
  reason: z.string().nullable(),
  status: z.enum(BIZ_LEAVE_STATUSES),
  workflowInstanceId: z.int().nullable().meta({ description: '关联的工作流实例 ID（提交审批后回填）' }),
  workflowStatus: z.enum(WORKFLOW_INSTANCE_STATUSES).nullable().meta({ description: '冗余的工作流状态，便于列表展示' }),
  applicantId: z.int().nullable().meta({ description: '申请人（= createdBy）' }),
  applicantName: z.string().nullable().optional(),
  tenantId: z.int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'BizLeave' });

export type BizLeave = z.infer<typeof bizLeaveSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const bizLeaveListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按事由模糊匹配' }),
  status: queryEnum(BIZ_LEAVE_STATUSES).meta({ description: '按业务状态过滤' }),
});

export const bizLeaveContract = defineContract('/api/biz/leaves', {
  list: op.get('/', { query: bizLeaveListQuery, response: paginated(bizLeaveSchema), summary: '我的请假列表' }),
  detail: op.get('/{id}', { params: idParam, response: bizLeaveSchema, summary: '请假详情' }),
  approvalDetail: op.get('/{id}/detail', { params: idParam, response: bizLeaveSchema, summary: '请假详情（供工作流参与者/审批人查看）' }),
  create: op.post('/', { body: createBizLeaveSchema, response: bizLeaveSchema, summary: '新建请假单（草稿）' }),
  update: op.put('/{id}', { params: idParam, body: updateBizLeaveSchema, response: bizLeaveSchema, summary: '编辑请假单（仅草稿）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除请假单（仅草稿）' }),
  submit: op.post('/{id}/submit', { params: idParam, response: bizLeaveSchema, summary: '提交审批（发起并关联工作流）' }),
  reopen: op.post('/{id}/reopen', { params: idParam, response: bizLeaveSchema, summary: '重新编辑（驳回/取消后转回草稿，可修改后再次提交）' }),
}, { tags: ['BizLeave'] });
