import { marketingCampaignContract } from '@zenith/shared/marketing';
import type { MarketingCampaign, MarketingPrize } from '@zenith/shared/marketing';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockCoupons } from '@/mocks/data/members';
import {
  getNextMarketingCampaignId, getNextMarketingPrizeId,
  mockMarketingCampaigns, mockMarketingParticipations, mockMarketingPrizes,
} from '../data/marketing';
import { mockDateTime } from '../utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';

/** 优惠券名称按模板关联回填（与服务端 leftJoin coupons 口径一致） */
function withCouponName(prize: MarketingPrize): MarketingPrize {
  return {
    ...prize,
    couponName: prize.couponId ? (mockCoupons.find((c) => c.id === prize.couponId)?.name ?? null) : null,
  };
}

export const marketingHandlers = [
  // ─── 活动列表 ────────────────────────────────────────────────────────────────
  mock(marketingCampaignContract.list, ({ query, ok, paginate }) => {
    let list = [...mockMarketingCampaigns].sort((a, b) => b.id - a.id);
    if (query.keyword) {
      const keyword = query.keyword;
      list = filterByKeyword(list, keyword, [(c) => c.name, (c) => c.description]);
    }
    if (query.status) list = list.filter((c) => c.status === query.status);
    return ok(paginate(list));
  }),

  // ─── 奖品子资源（静态段先于 /{id} 注册）──────────────────────────────────────
  mock(marketingCampaignContract.listPrizes, ({ params, ok }) => {
    if (!mockMarketingCampaigns.some((c) => c.id === params.campaignId)) return notFound('营销活动不存在', { status: 404 });
    return ok(mockMarketingPrizes
      .filter((p) => p.campaignId === params.campaignId)
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map(withCouponName));
  }),
  mock(marketingCampaignContract.createPrize, ({ params, body, ok }) => {
    if (!mockMarketingCampaigns.some((c) => c.id === params.campaignId)) return notFound('营销活动不存在', { status: 404 });
    const now = mockDateTime();
    const prize: MarketingPrize = {
      id: getNextMarketingPrizeId(),
      campaignId: params.campaignId,
      name: body.name,
      prizeType: body.prizeType,
      points: body.prizeType === 'points' ? body.points ?? null : null,
      couponId: body.prizeType === 'coupon' ? body.couponId ?? null : null,
      couponName: null,
      stock: body.stock,
      totalStock: body.stock,
      weight: body.weight,
      sort: body.sort,
      createdAt: now,
      updatedAt: now,
    };
    mockMarketingPrizes.push(prize);
    return ok(withCouponName(prize), '创建成功');
  }),
  mock(marketingCampaignContract.updatePrize, ({ params, body, ok }) => {
    const current = mockMarketingPrizes.find((p) => p.id === params.prizeId && p.campaignId === params.campaignId);
    if (!current) return notFound('奖品不存在', { status: 404 });
    // 编辑库存：按增量同步调整剩余库存，已发放部分不受影响
    const delta = body.stock - current.totalStock;
    const nextStock = current.stock + delta;
    if (nextStock < 0) return badRequest(`库存不可低于已发放数量（已发放 ${current.totalStock - current.stock}）`, { status: 400 });
    Object.assign(current, {
      name: body.name,
      prizeType: body.prizeType,
      points: body.prizeType === 'points' ? body.points ?? null : null,
      couponId: body.prizeType === 'coupon' ? body.couponId ?? null : null,
      weight: body.weight,
      sort: body.sort,
      totalStock: body.stock,
      stock: nextStock,
      updatedAt: mockDateTime(),
    });
    return ok(withCouponName(current), '更新成功');
  }),
  mock(marketingCampaignContract.removePrize, ({ params, ok }) => {
    const campaign = mockMarketingCampaigns.find((c) => c.id === params.campaignId);
    if (!campaign) return notFound('营销活动不存在', { status: 404 });
    if (campaign.status === 'published') return badRequest('进行中的活动不可删除奖品', { status: 400 });
    const idx = mockMarketingPrizes.findIndex((p) => p.id === params.prizeId && p.campaignId === params.campaignId);
    if (idx === -1) return notFound('奖品不存在', { status: 404 });
    mockMarketingPrizes.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  // ─── 参与记录 ────────────────────────────────────────────────────────────────
  mock(marketingCampaignContract.listParticipations, ({ params, query, ok, paginate }) => {
    if (!mockMarketingCampaigns.some((c) => c.id === params.campaignId)) return notFound('营销活动不存在', { status: 404 });
    let list = mockMarketingParticipations.filter((r) => r.campaignId === params.campaignId);
    if (query.memberId !== undefined) list = list.filter((r) => r.memberId === query.memberId);
    if (query.wonOnly) list = list.filter((r) => r.prizeId !== null);
    return ok(paginate([...list].sort((a, b) => b.id - a.id)));
  }),

  // ─── 发布 / 结束 ────────────────────────────────────────────────────────────
  mock(marketingCampaignContract.publish, ({ params, ok }) => {
    const campaign = mockMarketingCampaigns.find((c) => c.id === params.id);
    if (!campaign) return notFound('营销活动不存在', { status: 404 });
    if (campaign.status === 'published') return badRequest('活动已是进行中状态', { status: 400 });
    if (!mockMarketingPrizes.some((p) => p.campaignId === params.id)) return badRequest('请先配置奖品再发布', { status: 400 });
    campaign.status = 'published';
    if (campaign.landingUrl) campaign.shortUrl = `${window.location.origin}/s/act${params.id}x`;
    campaign.updatedAt = mockDateTime();
    return ok(campaign, '发布成功');
  }),
  mock(marketingCampaignContract.end, ({ params, ok }) => {
    const campaign = mockMarketingCampaigns.find((c) => c.id === params.id);
    if (!campaign) return notFound('营销活动不存在', { status: 404 });
    if (campaign.status !== 'published') return badRequest('仅进行中的活动可结束', { status: 400 });
    campaign.status = 'ended';
    campaign.updatedAt = mockDateTime();
    return ok(campaign, '活动已结束');
  }),

  // ─── 详情 / 创建 / 更新 / 删除 ──────────────────────────────────────────────
  mock(marketingCampaignContract.detail, ({ params, ok }) => {
    const campaign = mockMarketingCampaigns.find((c) => c.id === params.id);
    if (!campaign) return notFound('营销活动不存在', { status: 404 });
    return ok(campaign);
  }),
  mock(marketingCampaignContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const campaign: MarketingCampaign = {
      id: getNextMarketingCampaignId(),
      name: body.name,
      type: 'lottery',
      status: 'draft',
      startAt: body.startAt,
      endAt: body.endAt,
      perMemberLimit: body.perMemberLimit,
      dailyPerMemberLimit: body.dailyPerMemberLimit ?? null,
      landingUrl: body.landingUrl ?? null,
      shortUrl: null,
      description: body.description ?? null,
      participationCount: 0,
      awardCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockMarketingCampaigns.push(campaign);
    return ok(campaign, '创建成功');
  }),
  mock(marketingCampaignContract.update, ({ params, body, ok }) => {
    const campaign = mockMarketingCampaigns.find((c) => c.id === params.id);
    if (!campaign) return notFound('营销活动不存在', { status: 404 });
    if (campaign.status === 'ended') return badRequest('已结束的活动不可修改', { status: 400 });
    Object.assign(campaign, body, { updatedAt: mockDateTime() });
    return ok(campaign, '更新成功');
  }),
  mock(marketingCampaignContract.remove, ({ params, ok }) => {
    const campaign = mockMarketingCampaigns.find((c) => c.id === params.id);
    if (!campaign) return notFound('营销活动不存在', { status: 404 });
    if (campaign.status === 'published') return badRequest('进行中的活动不可删除，请先结束', { status: 400 });
    mockMarketingCampaigns.splice(mockMarketingCampaigns.indexOf(campaign), 1);
    return ok(null, '删除成功');
  }),
];
