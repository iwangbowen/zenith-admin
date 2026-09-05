import { OpenAPIHono } from '@hono/zod-openapi';
import { memberPointContract } from '@zenith/shared/member';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listPointTransactions, adjustPoints, getPointAccount, getPointAccountBeforeAudit, mapPointAccount } from '../../services/member/member-points.service';
import { currentUser } from '../../lib/context';

const pointsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'member:point:list' })] as const;

const txRoute = defineContractRoute(memberPointContract.transactions, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listPointTransactions(c.req.valid('query'))), 200),
});

const accountRoute = defineContractRoute(memberPointContract.account, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getPointAccount(c.req.valid('param').id)), 200),
});

const adjustRoute = defineContractRoute(memberPointContract.adjust, {
  middleware: [authMiddleware, guard({ permission: 'member:point:adjust', audit: { description: '调整会员积分', module: '会员积分' } }), idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { memberId, delta, remark } = c.req.valid('json');
    setAuditBeforeData(c, await getPointAccountBeforeAudit(memberId));
    const acc = await adjustPoints(memberId, delta, currentUser().userId, remark);
    return c.json(okBody(mapPointAccount(acc), '已调整'), 200);
  },
});

pointsRouter.openapiRoutes([txRoute, accountRoute, adjustRoute] as const);

export default pointsRouter;
