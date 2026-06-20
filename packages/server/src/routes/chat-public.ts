/**
 * 聊天入站 Webhook（公开端点，无需登录，由外部系统以令牌调用）。
 *
 * POST /api/public/chat/webhook/{token}
 * body: { type?: 'text'|'card', text?, card? }
 *
 * 令牌在路由处理内校验；命中后以 webhook 身份向其目标会话投递一条消息。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { jsonContent, validationHook, commonErrorResponses, okMsg, okBody } from '../lib/openapi-schemas';
import { chatWebhookPayloadSchema } from '@zenith/shared';
import { ingestChatWebhook } from '../services/chat-webhooks.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const TokenParam = z.object({
  token: z.string().min(8).max(128).openapi({ param: { name: 'token', in: 'path' }, example: 'cwh_xxxxxxxx' }),
});

const ingestRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/{token}',
    tags: ['聊天 Webhook（公开）'],
    summary: '入站 Webhook 推送消息（公开，无需登录，由外部系统调用）',
    request: {
      params: TokenParam,
      body: { content: jsonContent(chatWebhookPayloadSchema), required: true },
    },
    responses: { ...commonErrorResponses, ...okMsg('推送成功') },
  }),
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const payload = c.req.valid('json');
    await ingestChatWebhook(token, payload);
    return c.json(okBody(null, '推送成功'), 200);
  },
});

router.openapiRoutes([ingestRoute] as const);

export default router;
