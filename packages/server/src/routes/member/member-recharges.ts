import { OpenAPIHono } from '@hono/zod-openapi';
import { memberRechargeContract } from '@zenith/shared/member';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listMemberRecharges } from '../../services/member/member-recharge.service';

const memberRechargesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(memberRechargeContract.list, {
  middleware: [authMiddleware, guard({ permission: 'member:recharge:list' })],
  handler: async (c) => c.json(okBody(await listMemberRecharges(c.req.valid('query'))), 200),
});

memberRechargesRouter.openapiRoutes([listRoute] as const);

export default memberRechargesRouter;
