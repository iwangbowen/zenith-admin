import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { reportPublicContract } from '@zenith/shared/report';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createPublicAccessSession,
  resolveEmbedDashboard,
  resolveEmbedData,
  resolvePublicDashboard,
  resolvePublicData,
} from '../../services/report/report-ops.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const accessRoute = defineContractRoute(reportPublicContract.access, {
  middleware: [],
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await createPublicAccessSession(token, body.password)), 200);
  },
});

const getRoute = defineContractRoute(reportPublicContract.dashboard, {
  middleware: [],
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const session = c.req.header('session');
    if (!session) throw new HTTPException(401, { message: '缺少公开访问会话' });
    return c.json(okBody(await resolvePublicDashboard(token, session)), 200);
  },
});

const dataRoute = defineContractRoute(reportPublicContract.dashboardData, {
  middleware: [],
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const session = c.req.header('session');
    if (!session) throw new HTTPException(401, { message: '缺少公开访问会话' });
    const body = c.req.valid('json');
    return c.json(okBody(await resolvePublicData(
      token,
      session,
      (body.filters ?? {}) as Record<string, unknown>,
      body.widgetQueries,
    )), 200);
  },
});

const embedRoute = defineContractRoute(reportPublicContract.embed, {
  middleware: [],
  handler: async (c) => c.json(okBody(await resolveEmbedDashboard(c.req.valid('param').token)), 200),
});

const embedDataRoute = defineContractRoute(reportPublicContract.embedData, {
  middleware: [],
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await resolveEmbedData(
      token,
      (body.filters ?? {}) as Record<string, unknown>,
      body.widgetQueries,
    )), 200);
  },
});

router.openapiRoutes([accessRoute, getRoute, dataRoute, embedRoute, embedDataRoute] as const);

export default router;
