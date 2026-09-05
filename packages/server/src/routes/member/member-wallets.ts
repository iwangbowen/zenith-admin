import { OpenAPIHono } from '@hono/zod-openapi';
import { memberWalletContract } from '@zenith/shared/member';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listWalletTransactions, getWallet, adjustWallet, refundWallet, mapWallet, getWalletBeforeAudit } from '../../services/member/member-wallet.service';
import { currentUser } from '../../lib/context';

const walletsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'member:wallet:list' })] as const;

const txRoute = defineContractRoute(memberWalletContract.transactions, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listWalletTransactions(c.req.valid('query'))), 200),
});

const accountRoute = defineContractRoute(memberWalletContract.account, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getWallet(c.req.valid('param').id)), 200),
});

const adjustRoute = defineContractRoute(memberWalletContract.adjust, {
  middleware: [authMiddleware, guard({ permission: 'member:wallet:adjust', audit: { description: '调整会员余额', module: '会员钱包' } }), idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { memberId, amount, remark } = c.req.valid('json');
    setAuditBeforeData(c, await getWalletBeforeAudit(memberId));
    const w = await adjustWallet(memberId, amount, currentUser().userId, remark);
    return c.json(okBody(mapWallet(w), '已调整'), 200);
  },
});

const refundRoute = defineContractRoute(memberWalletContract.refund, {
  middleware: [authMiddleware, guard({ permission: 'member:wallet:refund', audit: { description: '会员钱包退款', module: '会员钱包' } }), idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => {
    const { memberId, amount, remark, bizId } = c.req.valid('json');
    setAuditBeforeData(c, await getWalletBeforeAudit(memberId));
    const w = await refundWallet(memberId, amount, { operatorId: currentUser().userId, remark, bizId, bizType: 'admin_refund' });
    return c.json(okBody(mapWallet(w), '已退款'), 200);
  },
});

walletsRouter.openapiRoutes([txRoute, accountRoute, adjustRoute, refundRoute] as const);

export default walletsRouter;
