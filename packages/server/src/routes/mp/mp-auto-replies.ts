import { OpenAPIHono } from '@hono/zod-openapi';
import { mpAutoReplyContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpAutoReplies, createMpAutoReply, updateMpAutoReply, deleteMpAutoReply, getMpAutoReplyBeforeAudit,
  listMpUnmatchedKeywords, deleteMpUnmatchedKeyword, getMpUnmatchedKeywordBeforeAudit,
} from '../../services/mp/mp-auto-reply.service';

const mpAutoRepliesRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'mp:reply:list' })] as const;

const listRoute = defineContractRoute(mpAutoReplyContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listMpAutoReplies(c.req.valid('query'))), 200),
});

const createRouteDef = defineContractRoute(mpAutoReplyContract.create, {
  middleware: [authMiddleware, guard({ permission: 'mp:reply:create', audit: { description: '创建自动回复', module: '公众号自动回复' } })],
  handler: async (c) => c.json(okBody(await createMpAutoReply(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(mpAutoReplyContract.update, {
  middleware: [authMiddleware, guard({ permission: 'mp:reply:update', audit: { description: '更新自动回复', module: '公众号自动回复' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpAutoReplyBeforeAudit(id));
    return c.json(okBody(await updateMpAutoReply(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(mpAutoReplyContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'mp:reply:delete', audit: { description: '删除自动回复', module: '公众号自动回复' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpAutoReplyBeforeAudit(id));
    await deleteMpAutoReply(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const unmatchedListRoute = defineContractRoute(mpAutoReplyContract.unmatched, {
  middleware: read,
  handler: async (c) => {
    const q = c.req.valid('query');
    return c.json(okBody(await listMpUnmatchedKeywords(q.accountId, q.page, q.pageSize)), 200);
  },
});

const unmatchedDeleteRoute = defineContractRoute(mpAutoReplyContract.removeUnmatched, {
  middleware: [authMiddleware, guard({ permission: 'mp:reply:delete', audit: { description: '删除未命中热词', module: '公众号自动回复' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getMpUnmatchedKeywordBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteMpUnmatchedKeyword(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

mpAutoRepliesRouter.openapiRoutes([unmatchedListRoute, unmatchedDeleteRoute, listRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default mpAutoRepliesRouter;
