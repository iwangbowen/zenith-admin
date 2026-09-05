import { OpenAPIHono } from '@hono/zod-openapi';
import { mpTagContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpTags, createMpTag, updateMpTag, deleteMpTag, getMpTagBeforeAudit, syncMpTags,
} from '../../services/mp/mp-tag.service';

const mpTagsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(mpTagContract.list, {
  middleware: [authMiddleware, guard({ permission: 'mp:tag:list' })],
  handler: async (c) => c.json(okBody(await listMpTags(c.req.valid('query'))), 200),
});

const syncRoute = defineContractRoute(mpTagContract.sync, {
  middleware: [authMiddleware, guard({ permission: 'mp:tag:sync', audit: { description: '同步公众号标签', module: '公众号标签' } })],
  handler: async (c) => c.json(okBody(await syncMpTags(c.req.valid('json').accountId), '同步完成'), 200),
});

const createRouteDef = defineContractRoute(mpTagContract.create, {
  middleware: [authMiddleware, guard({ permission: 'mp:tag:create', audit: { description: '创建公众号标签', module: '公众号标签' } })],
  handler: async (c) => c.json(okBody(await createMpTag(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(mpTagContract.update, {
  middleware: [authMiddleware, guard({ permission: 'mp:tag:update', audit: { description: '更新公众号标签', module: '公众号标签' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpTagBeforeAudit(id));
    return c.json(okBody(await updateMpTag(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(mpTagContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'mp:tag:delete', audit: { description: '删除公众号标签', module: '公众号标签' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpTagBeforeAudit(id));
    await deleteMpTag(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mpTagsRouter.openapiRoutes([listRoute, syncRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default mpTagsRouter;
