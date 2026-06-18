import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import {
  PaginationQuery,
  okBody,
  okPaginated,
  validationHook,
  commonErrorResponses,
} from '../lib/openapi-schemas';
import { MemberCheckinDTO } from '../lib/openapi-dtos';
import { listMemberCheckins } from '../services/member-checkin.service';

const memberCheckinsRouter = new OpenAPIHono({ defaultHook: validationHook });

const querySchema = PaginationQuery.extend({
  memberKeyword: z.string().optional(),
  dateStart: z.string().optional().openapi({ param: { name: 'dateStart', in: 'query' }, example: '2026-06-01' }),
  dateEnd: z.string().optional().openapi({ param: { name: 'dateEnd', in: 'query' }, example: '2026-06-30' }),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['会员签到'],
    summary: '签到记录列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'member:checkin:log:list' })] as const,
    request: { query: querySchema },
    responses: { ...commonErrorResponses, ...okPaginated(MemberCheckinDTO, '签到记录列表') },
  }),
  handler: async (c) => c.json(okBody(await listMemberCheckins(c.req.valid('query'))), 200),
});

memberCheckinsRouter.openapiRoutes([listRoute] as const);

export default memberCheckinsRouter;
