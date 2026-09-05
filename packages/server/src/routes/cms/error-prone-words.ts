import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsErrorProneWordContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsErrorProneWords, createCmsErrorProneWord, updateCmsErrorProneWord,
  deleteCmsErrorProneWord, mapCmsErrorProneWord, ensureCmsErrorProneWordExists,
} from '../../services/cms/cms-error-prone-words.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(cmsErrorProneWordContract.list, {
  middleware: [authMiddleware, guard({ permission: 'cms:word:list' })],
  handler: async (c) => c.json(okBody(await listCmsErrorProneWords(c.req.valid('query'))), 200),
});

const createRouteDef = defineContractRoute(cmsErrorProneWordContract.create, {
  middleware: [authMiddleware, guard({ permission: 'cms:word:manage', audit: { description: '新增 CMS 易错词', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsErrorProneWord(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(cmsErrorProneWordContract.update, {
  middleware: [authMiddleware, guard({ permission: 'cms:word:manage', audit: { description: '更新 CMS 易错词', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsErrorProneWord(await ensureCmsErrorProneWordExists(id)));
    return c.json(okBody(await updateCmsErrorProneWord(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsErrorProneWordContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'cms:word:manage', audit: { description: '删除 CMS 易错词', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsErrorProneWord(await ensureCmsErrorProneWordExists(id)));
    await deleteCmsErrorProneWord(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, createRouteDef, updateRouteDef, deleteRouteDef] as const);

export default router;
