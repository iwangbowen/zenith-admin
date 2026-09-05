import { OpenAPIHono } from '@hono/zod-openapi';
import { aiEvalContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listEvalDatasets,
  createEvalDataset,
  updateEvalDataset,
  deleteEvalDataset,
  listEvalItems,
  addEvalItems,
  deleteEvalItem,
  runEvalExperiment,
  listEvalExperiments,
  getEvalExperimentResults,
} from '../../services/ai/ai-eval.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'ai:eval:list' })] as const;
const manage = [authMiddleware, guard({ permission: 'ai:eval:manage' })] as const;

const list = defineContractRoute(aiEvalContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listEvalDatasets()), 200),
});

const create = defineContractRoute(aiEvalContract.create, {
  middleware: manage,
  handler: async (c) => c.json(okBody(await createEvalDataset(c.req.valid('json')), '创建成功'), 200),
});

const update = defineContractRoute(aiEvalContract.update, {
  middleware: manage,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateEvalDataset(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineContractRoute(aiEvalContract.remove, {
  middleware: manage,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteEvalDataset(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const items = defineContractRoute(aiEvalContract.items, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listEvalItems(id)), 200);
  },
});

const addItems = defineContractRoute(aiEvalContract.addItems, {
  middleware: manage,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await addEvalItems(id, c.req.valid('json')), '添加成功'), 200);
  },
});

const removeItem = defineContractRoute(aiEvalContract.removeItem, {
  middleware: manage,
  handler: async (c) => {
    const { id, itemId } = c.req.valid('param');
    await deleteEvalItem(id, itemId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const runExperiment = defineContractRoute(aiEvalContract.runExperiment, {
  middleware: [authMiddleware, guard({ permission: 'ai:eval:manage', audit: { description: '发起评测实验', module: '智能助手' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await runEvalExperiment(id, c.req.valid('json')), '实验已发起'), 200);
  },
});

const experiments = defineContractRoute(aiEvalContract.experiments, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listEvalExperiments(id)), 200);
  },
});

const experimentResults = defineContractRoute(aiEvalContract.experimentDetail, {
  middleware: read,
  handler: async (c) => {
    const { id, experimentId } = c.req.valid('param');
    return c.json(okBody(await getEvalExperimentResults(id, experimentId)), 200);
  },
});

router.openapiRoutes([list, create, update, remove, items, addItems, removeItem, runExperiment, experiments, experimentResults] as const);

export default router;
