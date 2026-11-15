import { OpenAPIHono } from '@hono/zod-openapi';
import { rateLimitContract } from '@zenith/shared/platform';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listRateLimitRules,
  getRateLimitOperations,
  diagnoseRateLimit,
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

const operations = defineContractRoute(rateLimitContract.operations, { handler: c => c.json(okBody(getRateLimitOperations()), 200) });
const diagnose = defineContractRoute(rateLimitContract.diagnose, { handler: c => c.json(okBody(diagnoseRateLimit(c.req.valid('json'))), 200) });

const listRules = defineContractRoute(rateLimitContract.rules, {
  handler: async (c) => c.json(okBody(await listRateLimitRules()), 200),
});

const createRule = defineContractRoute(rateLimitContract.createRule, {
  handler: async (c) => {
    const body = c.req.valid('json');
    return c.json(okBody(await createRateLimitRule(body), '规则已创建'), 200);
  },
});

const patchRule = defineContractRoute(rateLimitContract.updateRule, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    setAuditBeforeData(c, await getRateLimitRuleBeforeAudit(id));
    return c.json(okBody(await updateRateLimitRule(id, patch), '规则已更新'), 200);
  },
});

const deleteRule = defineContractRoute(rateLimitContract.removeRule, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getRateLimitRuleBeforeAudit(id));
    await deleteRateLimitRule(id);
    return c.json(okBody(null, '规则已删除'), 200);
  },
});

const getStats = defineContractRoute(rateLimitContract.stats, {
  handler: async (c) => c.json(okBody(await getRateLimitStats()), 200),
});

const unblock = defineContractRoute(rateLimitContract.unblock, {
  handler: async (c) => {
    const { name, key } = c.req.valid('json');
    const { unblocked } = await unblockRateLimit(name, key);
    return c.json(okBody(null, unblocked ? '解封成功' : '未找到活跃计数窗口（可能已过期或已解封）'), 200);
  },
});

const resetStats = defineContractRoute(rateLimitContract.resetStats, {
  handler: async (c) => {
    const { name } = c.req.valid('json');
    await resetRateLimitStats(name);
    return c.json(okBody(null, '统计已清空'), 200);
  },
});

const banKey = defineContractRoute(rateLimitContract.ban, {
  handler: async (c) => {
    const { name, key, durationSeconds } = c.req.valid('json');
    await banRateLimit(name, key, durationSeconds);
    return c.json(okBody(null, '封禁成功'), 200);
  },
});

const unbanKey = defineContractRoute(rateLimitContract.unban, {
  handler: async (c) => {
    const { name, key } = c.req.valid('json');
    const { unbanned } = await unbanRateLimit(name, key);
    return c.json(okBody(null, unbanned ? '已解除封禁' : '封禁不存在或已过期'), 200);
  },
});

const listBans = defineContractRoute(rateLimitContract.bans, {
  handler: async (c) => c.json(okBody(await listRateLimitActiveBans()), 200),
});

router.openapiRoutes([operations, diagnose, listRules, createRule, patchRule, deleteRule, getStats, unblock, resetStats, banKey, unbanKey, listBans] as const);

export default router;
