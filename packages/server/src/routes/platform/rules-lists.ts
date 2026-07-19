import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { sensitiveRateLimit } from '../../middleware/rate-limit';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { RuleListDTO, RuleListItemDTO, RuleListCheckResultDTO } from '../../lib/openapi-dtos';
import { createRuleListSchema, updateRuleListSchema, createRuleListItemSchema, batchRuleListItemsSchema, checkRuleListSchema } from '@zenith/shared';
import {
  listRuleLists, createRuleList, updateRuleList, deleteRuleList,
  listRuleListItems, createRuleListItem, batchCreateRuleListItems, deleteRuleListItem, purgeExpiredRuleListItems,
  checkRuleList, ensureRuleList, mapRuleList,
} from '../../services/platform/rules-lists.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['RuleLists'], summary: '名单分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:list:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), type: z.enum(['black', 'white', 'grey']).optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(RuleListDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listRuleLists(c.req.valid('query'))), 200),
});

const checkRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/check', tags: ['RuleLists'], summary: '名单命中判定（对外通用，支持 zat_ API Token 调用）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, sensitiveRateLimit, guard({ permission: 'rule:list:list' })] as const,
    request: { body: { content: jsonContent(checkRuleListSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(RuleListCheckResultDTO, 'ok') },
  }),
  handler: async (c) => { const b = c.req.valid('json'); return c.json(okBody(await checkRuleList(b.key, b.value)), 200); },
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['RuleLists'], summary: '创建名单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:list:create', audit: { description: '创建名单', module: '规则中心' } })] as const,
    request: { body: { content: jsonContent(createRuleListSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(RuleListDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createRuleList(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['RuleLists'], summary: '更新名单（含启停）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:list:update', audit: { description: '更新名单', module: '规则中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateRuleListSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(RuleListDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureRuleList(id).then((r) => mapRuleList(r)).catch(() => null);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateRuleList(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['RuleLists'], summary: '删除名单（级联删除条目）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:list:delete', audit: { description: '删除名单', module: '规则中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => { await deleteRuleList(c.req.valid('param').id); return c.json(okBody(null, '删除成功'), 200); },
});

const itemsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/items', tags: ['RuleLists'], summary: '名单条目分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:list:list' })] as const,
    request: { params: IdParam, query: PaginationQuery.extend({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(RuleListItemDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listRuleListItems(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const itemCreateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/items', tags: ['RuleLists'], summary: '新增名单条目',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:list:item', audit: { description: '新增名单条目', module: '规则中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(createRuleListItemSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(RuleListItemDTO, '新增成功') },
  }),
  handler: async (c) => c.json(okBody(await createRuleListItem(c.req.valid('param').id, c.req.valid('json')), '新增成功'), 200),
});

const itemBatchRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/items/batch', tags: ['RuleLists'], summary: '批量导入条目（去重，最多 500 条）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:list:item', audit: { description: '批量导入名单条目', module: '规则中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(batchRuleListItemsSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('导入完成') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { values, expiresAt } = c.req.valid('json');
    const added = await batchCreateRuleListItems(id, values, expiresAt);
    return c.json(okBody(null, `导入完成：新增 ${added} 条（重复值已跳过）`), 200);
  },
});

const itemDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}/items/{itemId}', tags: ['RuleLists'], summary: '删除名单条目',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:list:item', audit: { description: '删除名单条目', module: '规则中心' } })] as const,
    request: { params: z.object({ id: z.coerce.number().int(), itemId: z.coerce.number().int() }) },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id, itemId } = c.req.valid('param');
    await deleteRuleListItem(id, itemId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const purgeExpiredRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/items/purge-expired', tags: ['RuleLists'], summary: '清理已过期条目',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'rule:list:item', audit: { description: '清理过期名单条目', module: '规则中心' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('清理完成') },
  }),
  handler: async (c) => {
    const removed = await purgeExpiredRuleListItems(c.req.valid('param').id);
    return c.json(okBody(null, `清理完成：删除 ${removed} 条过期条目`), 200);
  },
});

router.openapiRoutes([listRoute, checkRoute, createRouteDef, updateRoute, deleteRoute, itemsRoute, itemCreateRoute, itemBatchRoute, itemDeleteRoute, purgeExpiredRoute] as const);

export default router;
