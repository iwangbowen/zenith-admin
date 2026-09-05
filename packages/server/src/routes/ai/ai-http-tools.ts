import { OpenAPIHono } from '@hono/zod-openapi';
import { aiHttpToolContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listHttpTools, createHttpTool, updateHttpTool, deleteHttpTool } from '../../services/ai/ai-http-tools.service';
import { listAvailableTools } from '../../lib/ai/tools';

const router = new OpenAPIHono({ defaultHook: validationHook });

const list = defineContractRoute(aiHttpToolContract.list, {
  middleware: [authMiddleware, guard({ permission: 'ai:tool:list' })],
  handler: async (c) => c.json(okBody(await listHttpTools()), 200),
});

/** 智能体编辑器工具勾选用：内置 + HTTP 工具统一视图，登录即可读 */
const available = defineContractRoute(aiHttpToolContract.all, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listAvailableTools()), 200),
});

const create = defineContractRoute(aiHttpToolContract.create, {
  middleware: [authMiddleware, guard({ permission: 'ai:tool:manage', audit: { description: '创建 AI HTTP 工具', module: '智能助手' } })],
  handler: async (c) => c.json(okBody(await createHttpTool(c.req.valid('json')), '创建成功'), 200),
});

const update = defineContractRoute(aiHttpToolContract.update, {
  middleware: [authMiddleware, guard({ permission: 'ai:tool:manage', audit: { description: '更新 AI HTTP 工具', module: '智能助手' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateHttpTool(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineContractRoute(aiHttpToolContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'ai:tool:manage', audit: { description: '删除 AI HTTP 工具', module: '智能助手' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteHttpTool(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([list, available, create, update, remove] as const);

export default router;
