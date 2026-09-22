import { OpenAPIHono } from '@hono/zod-openapi';
import { memberFulfillmentContract } from '@zenith/shared/member';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getMemberVipRenewal, getMemberWalletTransaction } from '../../services/member/member-fulfillment.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
router.openapiRoutes([
  defineContractRoute(memberFulfillmentContract.walletTransaction, {
    handler: async (c) => c.json(okBody(await getMemberWalletTransaction(c.req.valid('param').id)), 200),
  }),
  defineContractRoute(memberFulfillmentContract.vipRenewal, {
    handler: async (c) => c.json(okBody(await getMemberVipRenewal(c.req.valid('param').id)), 200),
  }),
] as const);
export default router;
