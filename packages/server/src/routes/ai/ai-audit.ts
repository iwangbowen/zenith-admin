import { OpenAPIHono } from '@hono/zod-openapi';
import { aiAuditContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listAuditMessages, getFeedbackContext } from '../../services/ai/ai-conversations.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const list = defineContractRoute(aiAuditContract.messages, {
  middleware: [authMiddleware, guard({ permission: 'ai:audit:view', audit: { description: 'AI 对话审计检索', module: '智能助手' } })],
  handler: async (c) => {
    const { page, pageSize, keyword, userId, role, startDate, endDate } = c.req.valid('query');
    return c.json(okBody(await listAuditMessages({ page, pageSize, keyword, userId, role, startDate, endDate })), 200);
  },
});

const context = defineContractRoute(aiAuditContract.messageContext, {
  middleware: [authMiddleware, guard({ permission: 'ai:audit:view' })],
  handler: async (c) => {
    const { msgId } = c.req.valid('param');
    return c.json(okBody(await getFeedbackContext(msgId)), 200);
  },
});

router.openapiRoutes([list, context] as const);

export default router;
