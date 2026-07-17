import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { jsonContent, validationHook, commonErrorResponses, ok, okMsg, IdParam, okBody } from '../../lib/openapi-schemas';
import { AiConversationShareDTO } from '../../lib/openapi-dtos';
import { shareConversation, getConversationShare, revokeConversationShare } from '../../services/ai/ai-share.service';
import { setConversationKnowledgeBase } from '../../services/ai/ai-knowledge.service';
import { shareAiConversationSchema } from '@zenith/shared';

/** 挂载在 /api/ai/conversations 下的扩展能力：分享管理 + 知识库挂载 */
const router = new OpenAPIHono({ defaultHook: validationHook });

const createShare = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{id}/share',
    tags: ['AI'],
    summary: '创建（或重建）对话分享链接',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam, body: { content: jsonContent(shareAiConversationSchema), required: false } },
    responses: { ...commonErrorResponses, ...ok(AiConversationShareDTO, '分享信息') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = await c.req.json().catch(() => ({}));
    const parsed = shareAiConversationSchema.safeParse(body ?? {});
    const expiresDays = parsed.success ? parsed.data.expiresDays : 0;
    return c.json(okBody(await shareConversation(id, expiresDays), '已生成分享链接'), 200);
  },
});

const getShare = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}/share',
    tags: ['AI'],
    summary: '查询对话分享状态',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AiConversationShareDTO.nullable(), '分享信息（未分享为 null）') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getConversationShare(id)), 200);
  },
});

const revokeShare = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}/share',
    tags: ['AI'],
    summary: '取消对话分享',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('已取消分享') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await revokeConversationShare(id);
    return c.json(okBody(null, '已取消分享'), 200);
  },
});

const setKb = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{id}/knowledge-base',
    tags: ['AI'],
    summary: '设置 / 清除对话挂载的知识库（kbId 传 null 清除）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ kbId: z.number().int().positive().nullable() })), required: true },
    },
    responses: { ...commonErrorResponses, ...okMsg('设置成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { kbId } = c.req.valid('json');
    await setConversationKnowledgeBase(id, kbId);
    return c.json(okBody(null, kbId ? '已挂载知识库' : '已清除知识库'), 200);
  },
});

router.openapiRoutes([createShare, getShare, revokeShare, setKb] as const);

export default router;
