/**
 * 营销活动中心（marketing 域）—— 抽奖类活动。
 *
 * - marketing_campaigns       活动主表（时间窗 + 每人次数限制 + 状态机 draft→published→ended）
 * - marketing_prizes          奖品（按权重抽取，库存原子扣减；prize_type=none 为「谢谢参与」不占库存）
 * - marketing_participations  参与记录（追加型：prizeId 为 null 表示未中奖，中奖时带发放状态）
 */
import { timestampColumns } from './common';
import { pgTable, pgEnum, varchar, timestamp, integer, text, index } from 'drizzle-orm/pg-core';
import { auditColumns, tenants } from './core';
import { coupons } from './member';

export const marketingCampaignTypeEnum = pgEnum('marketing_campaign_type', ['lottery']);

export const marketingCampaignStatusEnum = pgEnum('marketing_campaign_status', ['draft', 'published', 'ended']);

export const marketingPrizeTypeEnum = pgEnum('marketing_prize_type', ['points', 'coupon', 'physical', 'none']);

export const marketingGrantStatusEnum = pgEnum('marketing_grant_status', ['none', 'granted', 'failed']);

export const marketingCampaigns = pgTable('marketing_campaigns', {
  id:                  integer().primaryKey().generatedAlwaysAsIdentity(),
  name:                varchar({ length: 128 }).notNull(),
  type:                marketingCampaignTypeEnum().notNull().default('lottery'),
  status:              marketingCampaignStatusEnum().notNull().default('draft'),
  startAt:             timestamp().notNull(),
  endAt:               timestamp().notNull(),
  /** 每位会员总参与次数上限 */
  perMemberLimit:      integer().notNull().default(1),
  /** 每位会员每日参与次数上限，null = 不限 */
  dailyPerMemberLimit: integer(),
  /** C 端活动落地页地址（分享短链目标，选填） */
  landingUrl:          varchar({ length: 2048 }),
  description:         text(),
  tenantId:            integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('idx_marketing_campaigns_status').on(t.status),
  index('idx_marketing_campaigns_tenant').on(t.tenantId),
]);

export type MarketingCampaignRow = typeof marketingCampaigns.$inferSelect;

export type NewMarketingCampaign = typeof marketingCampaigns.$inferInsert;

export const marketingPrizes = pgTable('marketing_prizes', {
  id:         integer().primaryKey().generatedAlwaysAsIdentity(),
  campaignId: integer().notNull().references(() => marketingCampaigns.id, { onDelete: 'cascade' }),
  name:       varchar({ length: 128 }).notNull(),
  prizeType:  marketingPrizeTypeEnum().notNull(),
  /** prize_type=points 时的积分数 */
  points:     integer(),
  /** prize_type=coupon 时的优惠券模板 */
  couponId:   integer().references(() => coupons.id, { onDelete: 'set null' }),
  /** 剩余库存（none 类型不扣减）；抽中时原子扣减兜底并发 */
  stock:      integer().notNull().default(0),
  totalStock: integer().notNull().default(0),
  /** 抽取权重，越大越易中 */
  weight:     integer().notNull().default(1),
  sort:       integer().notNull().default(0),
  ...timestampColumns(),
}, (t) => [
  index('idx_marketing_prizes_campaign').on(t.campaignId),
]);

export type MarketingPrizeRow = typeof marketingPrizes.$inferSelect;

export type NewMarketingPrize = typeof marketingPrizes.$inferInsert;

export const marketingParticipations = pgTable('marketing_participations', {
  id:          integer().primaryKey().generatedAlwaysAsIdentity(),
  campaignId:  integer().notNull().references(() => marketingCampaigns.id, { onDelete: 'cascade' }),
  memberId:    integer().notNull(),
  /** 抽中的奖品；null = 未中奖（谢谢参与） */
  prizeId:     integer().references(() => marketingPrizes.id, { onDelete: 'set null' }),
  prizeName:   varchar({ length: 128 }),
  grantStatus: marketingGrantStatusEnum().notNull().default('none'),
  grantNote:   varchar({ length: 256 }),
  createdAt:   timestamp().defaultNow().notNull(),
}, (t) => [
  index('idx_marketing_participations_campaign_member').on(t.campaignId, t.memberId),
  index('idx_marketing_participations_campaign_time').on(t.campaignId, t.createdAt),
]);

export type MarketingParticipationRow = typeof marketingParticipations.$inferSelect;

export type NewMarketingParticipation = typeof marketingParticipations.$inferInsert;
