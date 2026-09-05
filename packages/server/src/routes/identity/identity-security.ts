import { OpenAPIHono } from '@hono/zod-openapi';
import { identitySecurityContract } from '@zenith/shared/identity';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { listLoginRiskEvents } from '../../services/identity/identity-security.service';

// 身份安全策略的读写已迁至 /api/settings/identity-security（运行时设置模块），本路由只保留风险事件查询
const identitySecurity = new OpenAPIHono({ defaultHook: validationHook });

const manage = [authMiddleware, guard({ permission: 'system:identity-security:manage' })] as const;

const riskEventsRoute = defineContractRoute(identitySecurityContract.riskEvents, {
  middleware: manage,
  handler: async (c) => c.json(okBody(await listLoginRiskEvents(c.req.valid('query'))), 200),
});

identitySecurity.openapiRoutes([riskEventsRoute] as const);

export default identitySecurity;