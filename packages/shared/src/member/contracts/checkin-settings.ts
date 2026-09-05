import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { updateCheckinSettingsSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 签到设置（单例）：补签开关 / 补签消耗积分 / 补签可回溯天数 */
export const checkinSettingsSchema = z.object({
  makeupEnabled: z.boolean(),
  makeupCostPoints: z.int(),
  makeupMaxDays: z.int(),
  updatedAt: z.string(),
}).meta({ id: 'CheckinSettings' });

export type CheckinSettings = z.infer<typeof checkinSettingsSchema>;

// ─── 契约（后台） ────────────────────────────────────────────────────────────

export const checkinSettingsContract = defineContract('/api/checkin-settings', {
  get: op.get('/', { response: checkinSettingsSchema, summary: '获取签到设置' }),
  update: op.put('/', { body: updateCheckinSettingsSchema, response: checkinSettingsSchema, summary: '更新签到设置' }),
}, { tags: ['会员签到'] });
