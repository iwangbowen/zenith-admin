import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { validationHook, commonErrorResponses, ok, jsonContent, okBody } from '../lib/openapi-schemas';
import { ReportPublicDashboardDTO, ReportDashboardDataDTO } from '../lib/openapi-dtos';
import { resolvePublicDashboard, resolvePublicData } from '../services/report-ops.service';

// 公开分享路由：无需登录，凭 token（可选密码）访问。挂载在 /api/report/public。
const router = new OpenAPIHono({ defaultHook: validationHook });

const TokenParam = z.object({
  token: z.string().min(8).openapi({ param: { name: 'token', in: 'path' }, example: 'a1b2c3d4' }),
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/dashboards/{token}',
    tags: ['报表公开'], summary: '公开仪表盘（凭 token）',
    request: { params: TokenParam, body: { content: jsonContent(z.object({ password: z.string().optional() })), required: false } },
    responses: { ...commonErrorResponses, ...ok(ReportPublicDashboardDTO, 'ok') },
  }),
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await resolvePublicDashboard(token, body?.password)), 200);
  },
});

const dataRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/dashboards/{token}/data',
    tags: ['报表公开'], summary: '公开仪表盘取数',
    request: { params: TokenParam, body: { content: jsonContent(z.object({ password: z.string().optional(), filters: z.record(z.string(), z.unknown()).optional() })), required: false } },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardDataDTO, 'ok') },
  }),
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await resolvePublicData(token, body?.password, (body?.filters ?? {}) as Record<string, unknown>)), 200);
  },
});

router.openapiRoutes([getRoute, dataRoute] as const);

export default router;
