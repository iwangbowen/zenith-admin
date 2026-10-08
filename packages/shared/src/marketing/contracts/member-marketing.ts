import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { MARKETING_CAMPAIGN_TYPES, MARKETING_PRIZE_TYPES } from '../constants';
import { marketingParticipationSchema } from './marketing-campaigns';

// ─── C 端视图 ────────────────────────────────────────────────────────────────

/** 会员端活动信息：仅暴露展示所需字段，不泄露权重与剩余库存 */
export const marketingPublicCampaignSchema = z.object({
  id: z.int(),
  name: z.string(),
  type: z.enum(MARKETING_CAMPAIGN_TYPES),
  startAt: z.string().meta({ description: 'YYYY-MM-DD HH:mm:ss' }),
  endAt: z.string().meta({ description: 'YYYY-MM-DD HH:mm:ss' }),
  perMemberLimit: z.int(),
  dailyPerMemberLimit: z.int().nullable(),
  description: z.string().nullable(),
  prizes: z.array(z.object({
    id: z.int(),
    name: z.string(),
    prizeType: z.enum(MARKETING_PRIZE_TYPES),
  })),
}).meta({ id: 'MarketingPublicCampaign' });

export type MarketingPublicCampaign = z.infer<typeof marketingPublicCampaignSchema>;

export const marketingDrawResultSchema = z.object({
  won: z.boolean().meta({ description: '是否中奖' }),
  prizeId: z.int().nullable(),
  prizeName: z.string().nullable(),
  prizeType: z.enum(MARKETING_PRIZE_TYPES).nullable(),
  remainingTimes: z.int().meta({ description: '剩余可参与次数（总限制口径）' }),
}).meta({ id: 'MarketingDrawResult' });

export type MarketingDrawResult = z.infer<typeof marketingDrawResultSchema>;

// ─── 契约（会员登录态） ──────────────────────────────────────────────────────

export const memberMarketingContract = defineContract('/api/member/marketing', {
  campaign: op.get('/campaigns/{id}', { params: idParam, response: marketingPublicCampaignSchema, summary: '活动信息（含奖品展示，不含权重与库存）' }),
  draw: op.post('/campaigns/{id}/draw', { params: idParam, response: marketingDrawResultSchema, summary: '参与抽奖（次数限制 + 库存原子扣减 + 中奖自动发放）' }),
  myRecords: op.get('/campaigns/{id}/my-records', { params: idParam, response: z.array(marketingParticipationSchema), summary: '我的参与记录（最近 50 条）' }),
}, { tags: ['营销活动（会员端）'], security: 'member-bearer', feature: 'growth' });
