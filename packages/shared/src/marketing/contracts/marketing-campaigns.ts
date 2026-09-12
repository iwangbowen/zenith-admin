import * as z from 'zod';
import { auditFieldsSchema, dateRangeQuery, idParam, paginated, paginationQuery, queryBool, queryEnum } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import {
  MARKETING_CAMPAIGN_STATUSES,
  MARKETING_CAMPAIGN_TYPES,
  MARKETING_GRANT_STATUSES,
  MARKETING_PRIZE_TYPES,
} from '../constants';
import { createMarketingCampaignSchema, saveMarketingPrizeSchema, updateMarketingCampaignSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const marketingCampaignSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '新春抽奖 · 天天有礼' }),
  type: z.enum(MARKETING_CAMPAIGN_TYPES),
  status: z.enum(MARKETING_CAMPAIGN_STATUSES),
  startAt: z.string().meta({ description: 'YYYY-MM-DD HH:mm:ss' }),
  endAt: z.string().meta({ description: 'YYYY-MM-DD HH:mm:ss' }),
  perMemberLimit: z.int().meta({ description: '每位会员总参与次数上限' }),
  dailyPerMemberLimit: z.int().nullable().meta({ description: '每位会员每日参与次数上限，null = 不限' }),
  landingUrl: z.string().nullable().meta({ description: 'C 端活动落地页地址（分享短链目标）' }),
  shortUrl: z.string().nullable().meta({ description: '分享短链（配置了落地页且已发布生成时回显）' }),
  description: z.string().nullable(),
  participationCount: z.int().meta({ description: '参与次数（仅列表聚合返回，其余响应为 0）' }),
  awardCount: z.int().meta({ description: '中奖次数（仅列表聚合返回，其余响应为 0）' }),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'MarketingCampaign' });

export type MarketingCampaign = z.infer<typeof marketingCampaignSchema>;

export const marketingPrizeSchema = z.object({
  id: z.int(),
  campaignId: z.int(),
  name: z.string(),
  prizeType: z.enum(MARKETING_PRIZE_TYPES),
  points: z.int().nullable().meta({ description: 'prizeType=points 时的积分数' }),
  couponId: z.int().nullable().meta({ description: 'prizeType=coupon 时的优惠券模板' }),
  couponName: z.string().nullable(),
  stock: z.int().meta({ description: '剩余库存（none 类型不扣减）' }),
  totalStock: z.int(),
  weight: z.int().meta({ description: '抽取权重，越大越易中' }),
  sort: z.int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'MarketingPrize' });

export type MarketingPrize = z.infer<typeof marketingPrizeSchema>;

export const marketingParticipationSchema = z.object({
  id: z.int(),
  campaignId: z.int(),
  memberId: z.int(),
  memberNickname: z.string().nullable().meta({ description: '会员昵称（管理端列表关联返回；会员端为 null）' }),
  prizeId: z.int().nullable().meta({ description: '抽中的奖品；null = 未中奖' }),
  prizeName: z.string().nullable(),
  grantStatus: z.enum(MARKETING_GRANT_STATUSES),
  grantNote: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'MarketingParticipation' });

export type MarketingParticipation = z.infer<typeof marketingParticipationSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const marketingCampaignListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按活动名称 / 说明模糊匹配' }),
  status: queryEnum(MARKETING_CAMPAIGN_STATUSES),
  ...dateRangeQuery('创建时间'),
});

export const marketingParticipationListQuery = paginationQuery.extend({
  memberId: z.coerce.number().int().positive().optional().meta({ description: '按会员筛选' }),
  wonOnly: queryBool('仅中奖记录'),
});

export const campaignIdParam = z.object({
  campaignId: z.coerce.number().int().positive().meta({ description: '活动 ID', example: 1 }),
});

export const marketingPrizeParams = campaignIdParam.extend({
  prizeId: z.coerce.number().int().positive().meta({ description: '奖品 ID', example: 1 }),
});

export const marketingCampaignContract = defineContract('/api/marketing/campaigns', {
  list: op.get('/', { query: marketingCampaignListQuery, response: paginated(marketingCampaignSchema), summary: '营销活动列表（含参与/中奖统计）' }),
  listPrizes: op.get('/{campaignId}/prizes', { params: campaignIdParam, response: z.array(marketingPrizeSchema), summary: '奖品列表' }),
  createPrize: op.post('/{campaignId}/prizes', { params: campaignIdParam, body: saveMarketingPrizeSchema, response: marketingPrizeSchema, summary: '新增奖品' }),
  updatePrize: op.put('/{campaignId}/prizes/{prizeId}', {
    params: marketingPrizeParams,
    body: saveMarketingPrizeSchema,
    response: marketingPrizeSchema,
    summary: '更新奖品（库存按增量调整剩余）',
  }),
  removePrize: op.delete('/{campaignId}/prizes/{prizeId}', { params: marketingPrizeParams, summary: '删除奖品' }),
  listParticipations: op.get('/{campaignId}/participations', {
    params: campaignIdParam,
    query: marketingParticipationListQuery,
    response: paginated(marketingParticipationSchema),
    summary: '参与/中奖记录',
  }),
  publish: op.post('/{id}/publish', { params: idParam, response: marketingCampaignSchema, summary: '发布活动（配置了落地页时自动生成分享短链）' }),
  end: op.post('/{id}/end', { params: idParam, response: marketingCampaignSchema, summary: '结束活动' }),
  detail: op.get('/{id}', { params: idParam, response: marketingCampaignSchema, summary: '营销活动详情' }),
  create: op.post('/', { body: createMarketingCampaignSchema, response: marketingCampaignSchema, summary: '创建营销活动' }),
  update: op.put('/{id}', { params: idParam, body: updateMarketingCampaignSchema, response: marketingCampaignSchema, summary: '更新营销活动' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除营销活动' }),
}, { tags: ['营销活动'] });
