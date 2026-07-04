import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { validationHook, commonErrorResponses, okPaginated, okBody, PaginationQuery } from '../../lib/openapi-schemas';
import { MemberRechargeDTO } from '../../lib/openapi-dtos';
import { listMemberRecharges } from '../../services/member/member-recharge.service';

const memberRechargesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listQuery = PaginationQuery.extend({
  keyword: z.string().optional(),
  status: z.enum(['pending', 'paying', 'success', 'closed', 'refunding', 'refunded', 'failed']).optional(),
  channel: z.enum(['wechat', 'alipay', 'unionpay']).optional(),
  dateStart: z.string().optional(),
  dateEnd: z.string().optional(),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['会员充值'], summary: '会员充值记录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:recharge:list' })] as const,
    request: { query: listQuery },
    responses: { ...commonErrorResponses, ...okPaginated(MemberRechargeDTO, '会员充值记录') },
  }),
  handler: async (c) => {
    const { page = 1, pageSize = 20, ...rest } = c.req.valid('query');
    return c.json(okBody(await listMemberRecharges({ page, pageSize, ...rest })), 200);
  },
});

memberRechargesRouter.openapiRoutes([listRoute] as const);

export default memberRechargesRouter;
