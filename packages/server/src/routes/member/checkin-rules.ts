import { OpenAPIHono } from '@hono/zod-openapi';
import { checkinRuleContract } from '@zenith/shared/member';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCheckinRules,
  createCheckinRule,
  updateCheckinRule,
  deleteCheckinRule,
  ensureCheckinRuleExists,
} from '../../services/member/checkin-rules.service';

const checkinRulesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(checkinRuleContract.list, {
  middleware: [authMiddleware, guard({ permission: 'member:checkin:rule:list' })],
  handler: async (c) => c.json(okBody(await listCheckinRules()), 200),
});

const createRuleRoute = defineContractRoute(checkinRuleContract.create, {
  middleware: [authMiddleware, guard({ permission: 'member:checkin:rule:create', audit: { module: '会员签到', description: '创建签到规则' } })],
  handler: async (c) => c.json(okBody(await createCheckinRule(c.req.valid('json')), '创建成功'), 200),
});

const updateRuleRoute = defineContractRoute(checkinRuleContract.update, {
  middleware: [authMiddleware, guard({ permission: 'member:checkin:rule:update', audit: { module: '会员签到', description: '更新签到规则' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureCheckinRuleExists(id));
    return c.json(okBody(await updateCheckinRule(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRuleRoute = defineContractRoute(checkinRuleContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'member:checkin:rule:delete', audit: { module: '会员签到', description: '删除签到规则' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureCheckinRuleExists(id));
    await deleteCheckinRule(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

checkinRulesRouter.openapiRoutes([listRoute, createRuleRoute, updateRuleRoute, deleteRuleRoute] as const);

export default checkinRulesRouter;
