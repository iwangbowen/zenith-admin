import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import {
  reportDashboardDataBodySchema,
  reportPublicAccessSchema,
} from '@zenith/shared';
import {
  commonErrorResponses,
  jsonContent,
  ok,
  okBody,
  validationHook,
} from '../../lib/openapi-schemas';
import {
  ReportDashboardDataDTO,
  ReportPublicAccessSessionDTO,
  ReportPublicDashboardDTO,
} from '../../lib/openapi-dtos';
import {
  createPublicAccessSession,
  resolveEmbedDashboard,
  resolveEmbedData,
  resolvePublicDashboard,
  resolvePublicData,
} from '../../services/report/report-ops.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const TokenParam = z.object({
  token: z.string().min(8).openapi({ param: { name: 'token', in: 'path' }, example: 'a1b2c3d4' }),
});

const accessRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/dashboards/{token}/access',
    tags: ['报表公开'],
    summary: '公开仪表盘密码验证并签发访问会话',
    request: {
      params: TokenParam,
      body: { content: jsonContent(reportPublicAccessSchema), required: false },
    },
    responses: { ...commonErrorResponses, ...ok(ReportPublicAccessSessionDTO, 'ok') },
  }),
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await createPublicAccessSession(token, body?.password)), 200);
  },
});

const getRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/dashboards/{token}',
    tags: ['报表公开'],
    summary: '公开仪表盘（需访问会话）',
    request: { params: TokenParam },
    responses: { ...commonErrorResponses, ...ok(ReportPublicDashboardDTO, 'ok') },
  }),
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const session = c.req.header('session');
    if (!session) throw new HTTPException(401, { message: '缺少公开访问会话' });
    return c.json(okBody(await resolvePublicDashboard(token, session)), 200);
  },
});

const dataRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/dashboards/{token}/data',
    tags: ['报表公开'],
    summary: '公开仪表盘取数',
    request: {
      params: TokenParam,
      body: { content: jsonContent(reportDashboardDataBodySchema), required: false },
    },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardDataDTO, 'ok') },
  }),
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const session = c.req.header('session');
    if (!session) throw new HTTPException(401, { message: '缺少公开访问会话' });
    const body = c.req.valid('json');
    return c.json(okBody(await resolvePublicData(
      token,
      session,
      (body?.filters ?? {}) as Record<string, unknown>,
      body?.widgetQueries,
    )), 200);
  },
});

const embedRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/embed/{token}',
    tags: ['报表公开'],
    summary: '匿名嵌入读取仪表盘',
    request: { params: TokenParam },
    responses: { ...commonErrorResponses, ...ok(ReportPublicDashboardDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await resolveEmbedDashboard(c.req.valid('param').token)), 200),
});

const embedDataRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/embed/{token}/data',
    tags: ['报表公开'],
    summary: '匿名嵌入仪表盘取数',
    request: {
      params: TokenParam,
      body: { content: jsonContent(reportDashboardDataBodySchema), required: false },
    },
    responses: { ...commonErrorResponses, ...ok(ReportDashboardDataDTO, 'ok') },
  }),
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await resolveEmbedData(
      token,
      (body?.filters ?? {}) as Record<string, unknown>,
      body?.widgetQueries,
    )), 200);
  },
});

router.openapiRoutes([accessRoute, getRoute, dataRoute, embedRoute, embedDataRoute] as const);

export default router;
