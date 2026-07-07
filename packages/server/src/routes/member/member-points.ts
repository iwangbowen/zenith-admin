import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import {
  jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okBody, IdParam, PaginationQuery,
} from '../../lib/openapi-schemas';
import { MemberPointTransactionDTO, MemberPointAccountDTO } from '../../lib/openapi-dtos';
import { listPointTransactions, adjustPoints, getPointAccount, getPointAccountBeforeAudit } from '../../services/member/member-points.service';
import { currentUser } from '../../lib/context';

const pointsRouter = new OpenAPIHono({ defaultHook: validationHook });

const pointTypeEnum = z.enum(['earn', 'redeem', 'expire', 'adjust', 'refund']);
const txQuery = PaginationQuery.extend({
  memberKeyword: z.string().optional(),
  type: pointTypeEnum.optional(),
});
const adjustSchema = z.object({
  memberId: z.number().int().positive(),
  delta: z.number().int().refine((v) => v !== 0, '变动量不能为 0'),
  remark: z.string().max(256).optional(),
});

const txRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/transactions', tags: ['会员积分'], summary: '积分流水',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:point:list' })] as const,
    request: { query: txQuery },
    responses: { ...commonErrorResponses, ...okPaginated(MemberPointTransactionDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listPointTransactions(c.req.valid('query'))), 200),
});

const accountRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/account/{id}', tags: ['会员积分'], summary: '会员积分账户',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:point:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(MemberPointAccountDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await getPointAccount(c.req.valid('param').id)), 200),
});

const adjustRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/adjust', tags: ['会员积分'], summary: '手动调整积分',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:point:adjust', audit: { description: '调整会员积分', module: '会员积分' } }), idempotencyGuard({ ttlSeconds: 10 })] as const,
    request: { body: { content: jsonContent(adjustSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MemberPointAccountDTO, '已调整') },
  }),
  handler: async (c) => {
    const { memberId, delta, remark } = c.req.valid('json');
    setAuditBeforeData(c, await getPointAccountBeforeAudit(memberId));
    const acc = await adjustPoints(memberId, delta, currentUser().userId, remark);
    return c.json(okBody({ memberId: acc.memberId, balance: acc.balance, frozen: acc.frozen, totalEarned: acc.totalEarned, totalSpent: acc.totalSpent }, '已调整'), 200);
  },
});

pointsRouter.openapiRoutes([txRoute, accountRoute, adjustRoute] as const);

export default pointsRouter;
