/**
 * 营销活动 C 端（会员登录态）：
 * 活动详情 / 抽奖 / 我的记录，供会员前台或外部 H5 活动页对接。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { memberMarketingContract } from '@zenith/shared/marketing';
import { memberAuthMiddleware } from '../../middleware/member-auth';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { currentMemberId } from '../../lib/member-context';
import {
  drawMarketingLottery, getPublicMarketingCampaign, listMyParticipations,
} from '../../services/marketing/marketing-campaigns.service';

const memberMarketing = new OpenAPIHono({ defaultHook: validationHook });

const member = [memberAuthMiddleware] as const;

const detailRoute = defineContractRoute(memberMarketingContract.campaign, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getPublicMarketingCampaign(c.req.valid('param').id)), 200),
});

const drawRoute = defineContractRoute(memberMarketingContract.draw, {
  middleware: member,
  handler: async (c) => c.json(okBody(await drawMarketingLottery(c.req.valid('param').id, currentMemberId())), 200),
});

const myRecordsRoute = defineContractRoute(memberMarketingContract.myRecords, {
  middleware: member,
  handler: async (c) => c.json(okBody(await listMyParticipations(c.req.valid('param').id, currentMemberId())), 200),
});

memberMarketing.openapiRoutes([detailRoute, drawRoute, myRecordsRoute] as const);

export default memberMarketing;
