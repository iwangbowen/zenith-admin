import { OpenAPIHono } from '@hono/zod-openapi';
import { mpMessageContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listMessages, listConversations, sendCustomMessage } from '../../services/mp/mp-message.service';

const mpMessagesRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'mp:message:list' })] as const;

const conversationsRoute = defineContractRoute(mpMessageContract.conversations, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listConversations(c.req.valid('query').accountId)), 200),
});

const listRoute = defineContractRoute(mpMessageContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listMessages(c.req.valid('query'))), 200),
});

const sendRoute = defineContractRoute(mpMessageContract.send, {
  middleware: [authMiddleware, guard({ permission: 'mp:message:send', audit: { description: '发送客服消息', module: '公众号消息' } })],
  handler: async (c) => c.json(okBody(await sendCustomMessage(c.req.valid('json')), '发送成功'), 200),
});

mpMessagesRouter.openapiRoutes([conversationsRoute, listRoute, sendRoute] as const);

export default mpMessagesRouter;
