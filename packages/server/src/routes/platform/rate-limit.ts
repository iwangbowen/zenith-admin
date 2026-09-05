import { OpenAPIHono } from '@hono/zod-openapi';
import { rateLimitContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listRateLimitRules,
  updateRateLimitRule,
  createRateLimitRule,
  deleteRateLimitRule,
  getRateLimitStats,
  unblockRateLimit,
  resetRateLimitStats,
  getRateLimitRuleBeforeAudit,
  banRateLimit,
  unbanRateLimit,
  listRateLimitActiveBans,
} from '../../services/platform/rate-limit.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const view = [authMiddleware, guard({ permission: 'system:rate-limit:view' })] as const;

const listRules = defineContractRoute(rateLimitContract.rules, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listRateLimitRules()), 200),
});

const createRule = defineContractRoute(rateLimitContract.createRule, {
  middleware: [authMiddleware, guard({
    permission: 'system:rate-limit:manage',
    audit: { description: '新增限流规则', module: '接口限流' },
  })],
  handler: async (c) => {
    const body = c.req.valid('json');
    return c.json(okBody(await createRateLimitRule(body), '规则已创建'), 200);
  },
});

const patchRule = defineContractRoute(rateLimitContract.updateRule, {
  middleware: [authMiddleware, guard({
    permission: 'system:rate-limit:manage',
    audit: { description: '更新限流规则', module: '接口限流' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    setAuditBeforeData(c, await getRateLimitRuleBeforeAudit(id));
    return c.json(okBody(await updateRateLimitRule(id, patch), '规则已更新'), 200);
  },
});

const deleteRule = defineContractRoute(rateLimitContract.removeRule, {
  middleware: [authMiddleware, guard({
    permission: 'system:rate-limit:manage',
    audit: { description: '删除限流规则', module: '接口限流' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getRateLimitRuleBeforeAudit(id));
    await deleteRateLimitRule(id);
    return c.json(okBody(null, '规则已删除'), 200);
  },
});

const getStats = defineContractRoute(rateLimitContract.stats, {
  middleware: view,
  handler: async (c) => c.json(okBody(await getRateLimitStats()), 200),
});

const unblock = defineContractRoute(rateLimitContract.unblock, {
  middleware: [authMiddleware, guard({
    permission: 'system:rate-limit:manage',
    audit: { description: '解封限流 key', module: '接口限流' },
  })],
  handler: async (c) => {
    const { name, key } = c.req.valid('json');
    const { unblocked } = await unblockRateLimit(name, key);
    return c.json(okBody(null, unblocked ? '解封成功' : '未找到活跃计数窗口（可能已过期或已解封）'), 200);
  },
});

const resetStats = defineContractRoute(rateLimitContract.resetStats, {
  middleware: [authMiddleware, guard({
    permission: 'system:rate-limit:manage',
    audit: { description: '清空限流统计', module: '接口限流' },
  })],
  handler: async (c) => {
    const { name } = c.req.valid('json');
    await resetRateLimitStats(name);
    return c.json(okBody(null, '统计已清空'), 200);
  },
});

const banKey = defineContractRoute(rateLimitContract.ban, {
  middleware: [authMiddleware, guard({
    permission: 'system:rate-limit:manage',
    audit: { description: '手动封禁限流 key', module: '接口限流' },
  })],
  handler: async (c) => {
    const { name, key, durationSeconds } = c.req.valid('json');
    await banRateLimit(name, key, durationSeconds);
    return c.json(okBody(null, '封禁成功'), 200);
  },
});

const unbanKey = defineContractRoute(rateLimitContract.unban, {
  middleware: [authMiddleware, guard({
    permission: 'system:rate-limit:manage',
    audit: { description: '解除限流封禁', module: '接口限流' },
  })],
  handler: async (c) => {
    const { name, key } = c.req.valid('json');
    const { unbanned } = await unbanRateLimit(name, key);
    return c.json(okBody(null, unbanned ? '已解除封禁' : '封禁不存在或已过期'), 200);
  },
});

const listBans = defineContractRoute(rateLimitContract.bans, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listRateLimitActiveBans()), 200),
});

router.openapiRoutes([listRules, createRule, patchRule, deleteRule, getStats, unblock, resetStats, banKey, unbanKey, listBans] as const);

export default router;
