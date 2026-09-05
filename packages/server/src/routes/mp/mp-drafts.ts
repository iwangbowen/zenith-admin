import { OpenAPIHono } from '@hono/zod-openapi';
import { mpDraftContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpDrafts, getMpDraft, createMpDraft, updateMpDraft, deleteMpDraft, pushMpDraft,
} from '../../services/mp/mp-draft.service';

const mpDraftsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'mp:draft:list' })] as const;

const listRoute = defineContractRoute(mpDraftContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listMpDrafts(c.req.valid('query'))), 200),
});

const getRoute = defineContractRoute(mpDraftContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getMpDraft(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(mpDraftContract.create, {
  middleware: [authMiddleware, guard({ permission: 'mp:draft:create', audit: { description: '创建图文草稿', module: '公众号图文' } })],
  handler: async (c) => c.json(okBody(await createMpDraft(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(mpDraftContract.update, {
  middleware: [authMiddleware, guard({ permission: 'mp:draft:update', audit: { description: '更新图文草稿', module: '公众号图文' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpDraft(id));
    return c.json(okBody(await updateMpDraft(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const pushRoute = defineContractRoute(mpDraftContract.push, {
  middleware: [authMiddleware, guard({ permission: 'mp:draft:push', audit: { description: '推送图文草稿', module: '公众号图文' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpDraft(id));
    return c.json(okBody(await pushMpDraft(id), '推送成功'), 200);
  },
});

const deleteRoute = defineContractRoute(mpDraftContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'mp:draft:delete', audit: { description: '删除图文草稿', module: '公众号图文' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpDraft(id));
    await deleteMpDraft(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mpDraftsRouter.openapiRoutes([listRoute, getRoute, createRouteDef, updateRoute, pushRoute, deleteRoute] as const);

export default mpDraftsRouter;
