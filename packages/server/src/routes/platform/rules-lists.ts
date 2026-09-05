import { OpenAPIHono } from '@hono/zod-openapi';
import { ruleListContract } from '@zenith/shared/rules';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { sensitiveRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listRuleLists, createRuleList, updateRuleList, deleteRuleList,
  listRuleListItems, createRuleListItem, batchCreateRuleListItems, deleteRuleListItem, purgeExpiredRuleListItems,
  checkRuleList, ensureRuleList, mapRuleList, listRuleListUsages,
} from '../../services/platform/rules-lists.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'rule:list:list' })] as const;

const listRoute = defineContractRoute(ruleListContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listRuleLists(c.req.valid('query'))), 200),
});

const checkRoute = defineContractRoute(ruleListContract.check, {
  middleware: [authMiddleware, sensitiveRateLimit, guard({ permission: 'rule:list:list' })],
  handler: async (c) => {
    const b = c.req.valid('json');
    return c.json(okBody(await checkRuleList(b.key, b.value)), 200);
  },
});

const createRouteDef = defineContractRoute(ruleListContract.create, {
  middleware: [authMiddleware, guard({ permission: 'rule:list:create', audit: { description: '创建名单', module: '规则中心' } })],
  handler: async (c) => c.json(okBody(await createRuleList(c.req.valid('json')), '创建成功'), 200),
});

const usagesRoute = defineContractRoute(ruleListContract.usages, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listRuleListUsages(c.req.valid('param').id)), 200),
});

const updateRoute = defineContractRoute(ruleListContract.update, {
  middleware: [authMiddleware, guard({ permission: 'rule:list:update', audit: { description: '更新名单', module: '规则中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureRuleList(id).then((r) => mapRuleList(r)).catch(() => null);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateRuleList(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(ruleListContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'rule:list:delete', audit: { description: '删除名单', module: '规则中心' } })],
  handler: async (c) => {
    await deleteRuleList(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const itemsRoute = defineContractRoute(ruleListContract.items, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listRuleListItems(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const itemCreateRoute = defineContractRoute(ruleListContract.createItem, {
  middleware: [authMiddleware, guard({ permission: 'rule:list:item', audit: { description: '新增名单条目', module: '规则中心' } })],
  handler: async (c) => c.json(okBody(await createRuleListItem(c.req.valid('param').id, c.req.valid('json')), '新增成功'), 200),
});

const itemBatchRoute = defineContractRoute(ruleListContract.createItemsBatch, {
  middleware: [authMiddleware, guard({ permission: 'rule:list:item', audit: { description: '批量导入名单条目', module: '规则中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { values, expiresAt } = c.req.valid('json');
    const added = await batchCreateRuleListItems(id, values, expiresAt);
    return c.json(okBody(null, `导入完成：新增 ${added} 条（重复值已跳过）`), 200);
  },
});

const itemDeleteRoute = defineContractRoute(ruleListContract.removeItem, {
  middleware: [authMiddleware, guard({ permission: 'rule:list:item', audit: { description: '删除名单条目', module: '规则中心' } })],
  handler: async (c) => {
    const { id, itemId } = c.req.valid('param');
    await deleteRuleListItem(id, itemId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const purgeExpiredRoute = defineContractRoute(ruleListContract.purgeExpiredItems, {
  middleware: [authMiddleware, guard({ permission: 'rule:list:item', audit: { description: '清理过期名单条目', module: '规则中心' } })],
  handler: async (c) => {
    const removed = await purgeExpiredRuleListItems(c.req.valid('param').id);
    return c.json(okBody(null, `清理完成：删除 ${removed} 条过期条目`), 200);
  },
});

router.openapiRoutes([listRoute, checkRoute, createRouteDef, usagesRoute, updateRoute, deleteRoute, itemsRoute, itemCreateRoute, itemBatchRoute, itemDeleteRoute, purgeExpiredRoute] as const);

export default router;
