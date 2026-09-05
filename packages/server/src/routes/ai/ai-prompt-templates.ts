import { OpenAPIHono } from '@hono/zod-openapi';
import { aiPromptTemplateContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listPromptTemplates,
  listChatPromptTemplates,
  getPromptTemplate,
  createPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
  incrementPromptUsage,
  listPromptTemplateVersions,
  restorePromptTemplateVersion,
} from '../../services/ai/ai-prompt-templates.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'ai:prompt:list' })] as const;

const list = defineContractRoute(aiPromptTemplateContract.list, {
  middleware: read,
  handler: async (c) => {
    const { page, pageSize, scope, keyword } = c.req.valid('query');
    return c.json(okBody(await listPromptTemplates({ page, pageSize, scope, keyword })), 200);
  },
});

const available = defineContractRoute(aiPromptTemplateContract.all, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listChatPromptTemplates()), 200),
});

const use = defineContractRoute(aiPromptTemplateContract.use, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await incrementPromptUsage(id);
    return c.json(okBody(null, '已记录'), 200);
  },
});

const getOne = defineContractRoute(aiPromptTemplateContract.detail, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getPromptTemplate(id)), 200);
  },
});

const create = defineContractRoute(aiPromptTemplateContract.create, {
  middleware: [authMiddleware, guard({ permission: 'ai:prompt:create' })],
  handler: async (c) => c.json(okBody(await createPromptTemplate(c.req.valid('json')), '创建成功'), 200),
});

const update = defineContractRoute(aiPromptTemplateContract.update, {
  middleware: [authMiddleware, guard({ permission: 'ai:prompt:edit' })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updatePromptTemplate(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineContractRoute(aiPromptTemplateContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'ai:prompt:delete' })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deletePromptTemplate(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const versions = defineContractRoute(aiPromptTemplateContract.versions, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listPromptTemplateVersions(id)), 200);
  },
});

const restoreVersion = defineContractRoute(aiPromptTemplateContract.restoreVersion, {
  middleware: [authMiddleware, guard({ permission: 'ai:prompt:edit', audit: { description: '恢复提示词模板版本', module: '智能助手' } })],
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    return c.json(okBody(await restorePromptTemplateVersion(id, versionId), '已恢复到历史版本'), 200);
  },
});

router.openapiRoutes([list, available, use, getOne, versions, restoreVersion, create, update, remove] as const);

export default router;
