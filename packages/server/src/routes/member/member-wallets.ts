import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import {
  jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okBody, IdParam, PaginationQuery,
} from '../../lib/openapi-schemas';
import { MemberWalletTransactionDTO, MemberWalletDTO } from '../../lib/openapi-dtos';
import { listWalletTransactions, getWallet, adjustWallet, refundWallet, mapWallet, getWalletBeforeAudit } from '../../services/member/member-wallet.service';
import { currentUser } from '../../lib/context';

const walletsRouter = new OpenAPIHono({ defaultHook: validationHook });

const walletTypeEnum = z.enum(['recharge', 'consume', 'refund', 'adjust']);
const txQuery = PaginationQuery.extend({
  memberKeyword: z.string().optional(),
  type: walletTypeEnum.optional(),
});
const adjustSchema = z.object({
  memberId: z.number().int().positive(),
  amount: z.number().int().refine((v) => v !== 0, '变动金额不能为 0'),
  remark: z.string().max(256).optional(),
});
const refundSchema = z.object({
  memberId: z.number().int().positive(),
  amount: z.number().int().positive('退款金额必须大于 0'),
  remark: z.string().max(256).optional(),
});

const txRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/transactions', tags: ['会员钱包'], summary: '钱包流水',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:wallet:list' })] as const,
    request: { query: txQuery },
    responses: { ...commonErrorResponses, ...okPaginated(MemberWalletTransactionDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listWalletTransactions(c.req.valid('query'))), 200),
});

const accountRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/account/{id}', tags: ['会员钱包'], summary: '会员钱包账户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:wallet:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(MemberWalletDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getWallet(c.req.valid('param').id)), 200),
});

const adjustRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/adjust', tags: ['会员钱包'], summary: '手动调整余额',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:wallet:adjust', audit: { description: '调整会员余额', module: '会员钱包' } }), idempotencyGuard({ ttlSeconds: 10 })] as const,
    request: { body: { content: jsonContent(adjustSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberWalletDTO, '已调整') },
  }),
  handler: async (c) => {
    const { memberId, amount, remark } = c.req.valid('json');
    setAuditBeforeData(c, await getWalletBeforeAudit(memberId));
    const w = await adjustWallet(memberId, amount, currentUser().userId, remark);
    return c.json(okBody(mapWallet(w), '已调整'), 200);
  },
});

const refundRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/refund', tags: ['会员钱包'], summary: '钱包退款入账',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:wallet:refund', audit: { description: '会员钱包退款', module: '会员钱包' } }), idempotencyGuard({ ttlSeconds: 10 })] as const,
    request: { body: { content: jsonContent(refundSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberWalletDTO, '已退款') },
  }),
  handler: async (c) => {
    const { memberId, amount, remark } = c.req.valid('json');
    setAuditBeforeData(c, await getWalletBeforeAudit(memberId));
    const w = await refundWallet(memberId, amount, { operatorId: currentUser().userId, remark, bizType: 'admin_refund' });
    return c.json(okBody(mapWallet(w), '已退款'), 200);
  },
});

walletsRouter.openapiRoutes([txRoute, accountRoute, adjustRoute, refundRoute] as const);

export default walletsRouter;
