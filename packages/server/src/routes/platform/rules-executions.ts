/**
 * 规则执行记录路由（全资产通用）。
 * 覆盖决策表 / 决策流 / 评分卡 / 名单命中的统一留痕，支持按资产类型与调用方筛选。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { ruleExecutionContract } from '@zenith/shared/rules';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listRuleExecutions } from '../../services/platform/rules-executions.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(ruleExecutionContract.list, {
  middleware: [authMiddleware, guard({ permission: 'rule:table:list' })],
  handler: async (c) => c.json(okBody(await listRuleExecutions(c.req.valid('query'))), 200),
});

router.openapiRoutes([listRoute] as const);

export default router;
