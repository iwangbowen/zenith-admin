import { OpenAPIHono } from '@hono/zod-openapi';
import { aiProviderContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listAiProviderConfigs,
  getAiProviderConfig,
  createAiProviderConfig,
  updateAiProviderConfig,
  deleteAiProviderConfig,
  setDefaultAiProviderConfig,
  testAiProviderConnection,
  fetchProviderModels,
  getProviderCatalog,
  getCatalogProviderModels,
} from '../../services/ai/ai-providers.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'ai:provider:list' })] as const;
const edit = [authMiddleware, guard({ permission: 'ai:provider:edit' })] as const;

const list = defineContractRoute(aiProviderContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listAiProviderConfigs()), 200),
});

const catalog = defineContractRoute(aiProviderContract.catalog, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getProviderCatalog()), 200),
});

const catalogModels = defineContractRoute(aiProviderContract.catalogModels, {
  middleware: read,
  handler: async (c) => {
    const { providerId } = c.req.valid('param');
    return c.json(okBody(await getCatalogProviderModels(providerId)), 200);
  },
});

const getOne = defineContractRoute(aiProviderContract.detail, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getAiProviderConfig(id)), 200);
  },
});

const create = defineContractRoute(aiProviderContract.create, {
  middleware: [authMiddleware, guard({ permission: 'ai:provider:create' })],
  handler: async (c) => c.json(okBody(await createAiProviderConfig(c.req.valid('json')), '创建成功'), 200),
});

const update = defineContractRoute(aiProviderContract.update, {
  middleware: edit,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateAiProviderConfig(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineContractRoute(aiProviderContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'ai:provider:delete' })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteAiProviderConfig(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const setDefault = defineContractRoute(aiProviderContract.setDefault, {
  middleware: edit,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await setDefaultAiProviderConfig(id), '已设为默认'), 200);
  },
});

const testConnection = defineContractRoute(aiProviderContract.testConnection, {
  middleware: edit,
  handler: async (c) => {
    const result = await testAiProviderConnection(c.req.valid('json'));
    return c.json(okBody(result), 200);
  },
});

const fetchModels = defineContractRoute(aiProviderContract.fetchModels, {
  middleware: edit,
  handler: async (c) => c.json(okBody(await fetchProviderModels(c.req.valid('json'))), 200),
});

router.openapiRoutes([list, catalog, catalogModels, getOne, create, update, remove, setDefault, testConnection, fetchModels] as const);

export default router;
