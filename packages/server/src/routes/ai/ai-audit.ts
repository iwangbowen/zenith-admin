import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { validationHook, commonErrorResponses, okPaginated, okBody, PaginationQuery, ok } from '../../lib/openapi-schemas';
import { AiFeedbackItemDTO, AiFeedbackContextDTO } from '../../lib/openapi-dtos';
import { listAuditMessages, getFeedbackContext } from '../../services/ai/ai-conversations.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const AuditQuery = PaginationQuery.extend({
  keyword: z.string().max(200).optional().openapi({ description: '内容关键词' }),
  userId: z.coerce.number().int().positive().optional().openapi({ description: '按用户 ID 筛选' }),
  role: z.enum(['user', 'assistant']).optional().openapi({ description: '按消息角色筛选' }),
  startDate: z.string().max(20).optional().openapi({ description: '时间起（YYYY-MM-DD）' }),
  endDate: z.string().max(20).optional().openapi({ description: '时间止（YYYY-MM-DD）' }),
});

const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/messages',
    tags: ['AI'],
    summary: '管理员对话内容合规审计检索',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:audit:view', audit: { description: 'AI 对话审计检索', module: '智能助手' } })] as const,
    request: { query: AuditQuery },
    responses: { ...commonErrorResponses, ...okPaginated(AiFeedbackItemDTO, '消息列表') },
  }),
  handler: async (c) => {
    const { page, pageSize, keyword, userId, role, startDate, endDate } = c.req.valid('query');
    return c.json(okBody(await listAuditMessages({ page, pageSize, keyword, userId, role, startDate, endDate })), 200);
  },
});

const context = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/messages/{msgId}/context',
    tags: ['AI'],
    summary: '管理员查看审计消息的会话上下文',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'ai:audit:view' })] as const,
    request: { params: z.object({ msgId: z.coerce.number() }) },
    responses: { ...commonErrorResponses, ...ok(AiFeedbackContextDTO, '上下文消息') },
  }),
  handler: async (c) => {
    const { msgId } = c.req.valid('param');
    return c.json(okBody(await getFeedbackContext(msgId)), 200);
  },
});

router.openapiRoutes([list, context] as const);

export default router;
