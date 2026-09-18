import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentChannelAccountContract } from '@zenith/shared/payment';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getChannelAccount, listAllChannelAccounts, listChannelAccounts } from '../../services/payment/payment-channel-account.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });
mountCrud(router, paymentChannelAccountContract, { get: getChannelAccount, list: listChannelAccounts }, {}, [
  defineContractRoute(paymentChannelAccountContract.all, { handler: async (c) => c.json(okBody(await listAllChannelAccounts()), 200) }),
]);
export default router;
