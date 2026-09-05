import { OpenAPIHono } from '@hono/zod-openapi';
import { aiAgentContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMyAgents,
  listBuiltinAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  getAgentDetail,
} from '../../services/ai/ai-agents.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const authed = [authMiddleware] as const;

const listMine = defineContractRoute(aiAgentContract.list, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await listMyAgents()), 200),
});

const builtin = defineContractRoute(aiAgentContract.builtin, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await listBuiltinAgents()), 200),
});

const detail = defineContractRoute(aiAgentContract.detail, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getAgentDetail(id)), 200);
  },
});

const create = defineContractRoute(aiAgentContract.create, {
  middleware: authed,
  handler: async (c) => c.json(okBody(await createAgent(c.req.valid('json')), '创建成功'), 200),
});

const update = defineContractRoute(aiAgentContract.update, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateAgent(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineContractRoute(aiAgentContract.remove, {
  middleware: authed,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteAgent(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listMine, builtin, detail, create, update, remove] as const);

export default router;
