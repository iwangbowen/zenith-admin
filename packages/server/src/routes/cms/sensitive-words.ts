import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsSensitiveWordContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsSensitiveWords, createCmsSensitiveWord, updateCmsSensitiveWord, deleteCmsSensitiveWord,
  ensureCmsSensitiveWordExists, mapCmsSensitiveWord,
} from '../../services/cms/cms-sensitive-words.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(cmsSensitiveWordContract.list, {
  middleware: [authMiddleware, guard({ permission: 'cms:sensitive:list' })],
  handler: async (c) => c.json(okBody(await listCmsSensitiveWords(c.req.valid('query'))), 200),
});

const createRouteDef = defineContractRoute(cmsSensitiveWordContract.create, {
  middleware: [authMiddleware, guard({ permission: 'cms:sensitive:manage', audit: { description: '创建 CMS 敏感词', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsSensitiveWord(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(cmsSensitiveWordContract.update, {
  middleware: [authMiddleware, guard({ permission: 'cms:sensitive:manage', audit: { description: '更新 CMS 敏感词', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSensitiveWord(await ensureCmsSensitiveWordExists(id)));
    return c.json(okBody(await updateCmsSensitiveWord(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsSensitiveWordContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'cms:sensitive:manage', audit: { description: '删除 CMS 敏感词', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSensitiveWord(await ensureCmsSensitiveWordExists(id)));
    await deleteCmsSensitiveWord(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, createRouteDef, updateRouteDef, deleteRouteDef] as const);

export default router;
