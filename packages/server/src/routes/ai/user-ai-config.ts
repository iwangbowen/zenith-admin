import { OpenAPIHono } from '@hono/zod-openapi';
import { userAiConfigContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  getUserAiConfigs,
  createUserAiConfig,
  updateUserAiConfig,
  deleteUserAiConfig,
} from '../../services/ai/user-ai-config.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const authed = [authMiddleware] as const;

const getConfigs = defineContractRoute(userAiConfigContract.list, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await getUserAiConfigs()), 200),
});

const createConfig = defineContractRoute(userAiConfigContract.create, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await createUserAiConfig(c.req.valid('json')), '创建成功'), 200),
});

const updateConfig = defineContractRoute(userAiConfigContract.update, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateUserAiConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteConfig = defineContractRoute(userAiConfigContract.remove, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteUserAiConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([getConfigs, createConfig, updateConfig, deleteConfig] as const);

export default router;
