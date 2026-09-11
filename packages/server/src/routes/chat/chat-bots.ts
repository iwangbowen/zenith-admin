import { OpenAPIHono } from '@hono/zod-openapi';
import { chatBotContract } from '@zenith/shared/chat';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listChatWebhooks, createChatWebhook, updateChatWebhook, deleteChatWebhook, regenerateChatWebhookToken,
  getChatWebhookBeforeAudit, sanitizeChatWebhookForAudit,
} from '../../services/chat/chat-webhooks.service';

const chatBotsRoute = new OpenAPIHono({ defaultHook: validationHook });

const MODULE = '聊天机器人';

const list = defineContractRoute(chatBotContract.list, {
  middleware: [authMiddleware, guard({ permission: 'chat:bot:list' })],
  handler: async (c) => {
    return c.json(okBody(await listChatWebhooks(c.req.valid('query'))), 200);
  },
});

const create = defineContractRoute(chatBotContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'chat:bot:create',
    audit: { description: '创建聊天 Webhook', module: MODULE, recordResponseBody: false },
  })],
  handler: async (c) => {
    const row = await createChatWebhook(c.req.valid('json'));
    setAuditAfterData(c, sanitizeChatWebhookForAudit(row));
    return c.json(okBody(row, '创建成功'), 200);
  },
});

const update = defineContractRoute(chatBotContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'chat:bot:update',
    audit: { description: '更新聊天 Webhook', module: MODULE, recordResponseBody: false },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChatWebhookBeforeAudit(id));
    const row = await updateChatWebhook(id, c.req.valid('json'));
    setAuditAfterData(c, sanitizeChatWebhookForAudit(row));
    return c.json(okBody(row, '更新成功'), 200);
  },
});

const regenerate = defineContractRoute(chatBotContract.regenerateToken, {
  middleware: [authMiddleware, guard({
    permission: 'chat:bot:update',
    audit: { description: '重置聊天 Webhook 令牌', module: MODULE, recordResponseBody: false },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChatWebhookBeforeAudit(id));
    const row = await regenerateChatWebhookToken(id);
    setAuditAfterData(c, sanitizeChatWebhookForAudit(row));
    return c.json(okBody(row, '令牌已重置'), 200);
  },
});

const remove = defineContractRoute(chatBotContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'chat:bot:delete', audit: { description: '删除聊天 Webhook', module: MODULE } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getChatWebhookBeforeAudit(id));
    await deleteChatWebhook(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

chatBotsRoute.openapiRoutes([list, create, update, regenerate, remove] as const);

export default chatBotsRoute;
