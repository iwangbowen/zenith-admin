import * as z from 'zod';
import { defineContract, op } from '../../core/contract';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const memberStatsOverviewSchema = z.object({
  totalMembers: z.int(),
  todayNewMembers: z.int(),
  monthNewMembers: z.int(),
  activeMembers30d: z.int(),
  totalPoints: z.int(),
  totalWalletBalance: z.int().meta({ description: '钱包余额合计（分）' }),
  todayCheckins: z.int(),
  todayCheckinRate: z.number().meta({ description: '今日签到率（百分比，保留一位小数）' }),
  availableCoupons: z.int(),
}).meta({ id: 'MemberStatsOverview' });

export type MemberStatsOverview = z.infer<typeof memberStatsOverviewSchema>;

const namedValueSchema = z.object({ name: z.string(), value: z.int() });

export const memberStatsChartsSchema = z.object({
  registerTrend: z.array(z.object({ date: z.string(), count: z.int() })),
  levelDistribution: z.array(namedValueSchema),
  pointTrend: z.array(z.object({ date: z.string(), earned: z.int(), spent: z.int() })),
  checkinTrend: z.array(z.object({ date: z.string(), count: z.int() })),
  activitySegments: z.array(namedValueSchema).meta({ description: '活跃分层（按最后登录时间：7天 / 30天 / 90天 / 沉睡 / 从未登录）' }),
  rechargeSegments: z.array(namedValueSchema).meta({ description: '充值能力分层（按累计充值金额分档）' }),
  walletTrend: z.array(z.object({ date: z.string(), income: z.int(), expense: z.int() })).meta({ description: '近 30 天钱包收支（分）' }),
  sourceDistribution: z.array(namedValueSchema).meta({ description: '注册来源分布' }),
  couponStatusDistribution: z.array(namedValueSchema).meta({ description: '卡券状态分布' }),
}).meta({ id: 'MemberStatsCharts' });

export type MemberStatsCharts = z.infer<typeof memberStatsChartsSchema>;

// ─── 契约（后台） ────────────────────────────────────────────────────────────

export const memberStatsContract = defineContract('/api/member-stats', {
  overview: op.get('/overview', { response: memberStatsOverviewSchema, summary: '会员统计概览' }),
  charts: op.get('/charts', { response: memberStatsChartsSchema, summary: '会员统计图表' }),
}, { tags: ['会员看板'] });
