import * as z from 'zod';
import { dateRangeBound, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { CHECKIN_MILESTONE_REWARD_TYPES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 签到记录 */
export const memberCheckinSchema = z.object({
  id: z.int(),
  memberId: z.int(),
  memberNickname: z.string().nullable(),
  checkinDate: z.string().meta({ description: 'YYYY-MM-DD' }),
  consecutiveDays: z.int(),
  pointsAwarded: z.int(),
  experienceAwarded: z.int(),
  isMakeup: z.boolean(),
  remark: z.string().nullable().meta({ description: '备注（管理端补签原因）' }),
  createdAt: z.string(),
}).meta({ id: 'MemberCheckin' });

export type MemberCheckin = z.infer<typeof memberCheckinSchema>;

/** 签到日历单日聚合（管理端日历视图） */
export const memberCheckinCalendarDaySchema = z.object({
  date: z.string().meta({ example: '2026-08-01' }),
  count: z.int(),
  makeupCount: z.int(),
}).meta({ id: 'MemberCheckinCalendarDay' });

export type MemberCheckinCalendarDay = z.infer<typeof memberCheckinCalendarDaySchema>;

/** 会员端今日签到状态 */
export const memberCheckinStatusSchema = z.object({
  checkedToday: z.boolean(),
  consecutiveDays: z.int(),
  totalDays: z.int(),
  todayPoints: z.int(),
  todayExperience: z.int(),
  nextDayPoints: z.int(),
  nextDayExperience: z.int(),
  thisMonthDates: z.array(z.string()),
}).meta({ id: 'MemberCheckinStatus' });

export type MemberCheckinStatus = z.infer<typeof memberCheckinStatusSchema>;

/** 会员端签到结果 */
export const memberCheckinResultSchema = z.object({
  consecutiveDays: z.int(),
  points: z.int(),
  experience: z.int(),
  checkinDate: z.string(),
}).meta({ id: 'MemberCheckinResult' });

export type MemberCheckinResult = z.infer<typeof memberCheckinResultSchema>;

/** 补签结果（后台代补与会员自助补签共用） */
export const makeupCheckinResultSchema = z.object({
  checkinDate: z.string(),
  pointsAwarded: z.int(),
  experienceAwarded: z.int(),
  costPoints: z.int().meta({ description: '自助补签消耗的积分；后台代补为 0' }),
  consecutiveDays: z.int(),
}).meta({ id: 'MakeupCheckinResult' });

export type MakeupCheckinResult = z.infer<typeof makeupCheckinResultSchema>;

export const memberMilestoneStatusItemSchema = z.object({
  id: z.int(),
  title: z.string(),
  cumulativeDays: z.int(),
  rewardType: z.enum(CHECKIN_MILESTONE_REWARD_TYPES),
  rewardPoints: z.int(),
  couponName: z.string().nullable(),
  achieved: z.boolean(),
  achievedAt: z.string().nullable(),
}).meta({ id: 'MemberMilestoneStatusItem' });

export type MemberMilestoneStatusItem = z.infer<typeof memberMilestoneStatusItemSchema>;

/** 会员端里程碑达成情况 */
export const memberMilestoneStatusSchema = z.object({
  totalDays: z.int(),
  milestones: z.array(memberMilestoneStatusItemSchema),
}).meta({ id: 'MemberMilestoneStatus' });

export type MemberMilestoneStatus = z.infer<typeof memberMilestoneStatusSchema>;

// ─── 契约（后台签到记录） ────────────────────────────────────────────────────

export const memberCheckinListQuery = paginationQuery.extend({
  memberKeyword: z.string().optional().meta({ description: '会员昵称 / 手机号 / 用户名模糊匹配；纯数字额外按会员 ID 精确匹配' }),
  dateStart: dateRangeBound('起始日期'),
  dateEnd: dateRangeBound('结束日期'),
});

export const memberCheckinCalendarQuery = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, '月份格式为 YYYY-MM').meta({ example: '2026-08' }),
});

export const memberCheckinContract = defineContract('/api/member-checkins', {
  list: op.get('/', { query: memberCheckinListQuery, response: paginated(memberCheckinSchema), summary: '签到记录列表' }),
  calendar: op.get('/calendar', { query: memberCheckinCalendarQuery, response: z.array(memberCheckinCalendarDaySchema), summary: '签到日历（按月聚合）' }),
}, { tags: ['会员签到'] });
