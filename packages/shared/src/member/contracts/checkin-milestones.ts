import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { CHECKIN_MILESTONE_REWARD_TYPES } from '../constants';
import { createCheckinMilestoneSchema, updateCheckinMilestoneSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 累计签到天数达标奖励 */
export const checkinMilestoneSchema = z.object({
  id: z.int(),
  title: z.string(),
  cumulativeDays: z.int(),
  rewardType: z.enum(CHECKIN_MILESTONE_REWARD_TYPES),
  rewardPoints: z.int(),
  couponId: z.int().nullable(),
  couponName: z.string().nullable(),
  enabled: z.boolean(),
  remark: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'CheckinMilestone' });

export type CheckinMilestone = z.infer<typeof checkinMilestoneSchema>;

// ─── 契约（后台） ────────────────────────────────────────────────────────────

export const checkinMilestoneContract = defineContract('/api/checkin-milestones', {
  list: op.get('/', { response: z.array(checkinMilestoneSchema), summary: '签到里程碑列表' }),
  create: op.post('/', { body: createCheckinMilestoneSchema, response: checkinMilestoneSchema, summary: '创建签到里程碑' }),
  update: op.put('/{id}', { params: idParam, body: updateCheckinMilestoneSchema, response: checkinMilestoneSchema, summary: '更新签到里程碑' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除签到里程碑' }),
}, { tags: ['会员签到'] });
