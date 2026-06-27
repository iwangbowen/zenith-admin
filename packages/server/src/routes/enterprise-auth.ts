import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import {
  commonErrorResponses,
  jsonContent,
  ok,
  okBody,
  validationHook,
} from '../lib/openapi-schemas';
import { EnterpriseIdentityDiscoveryDTO, LoginResultDTO } from '../lib/openapi-dtos';
import {
  discoverEnterpriseIdentityProviders,
  generateEnterpriseAuthUrl,
  handleEnterpriseOidcCallback,
} from '../services/identity-providers.service';
import { getClientInfo } from '../services/auth.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const discoverRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/providers',
    tags: ['EnterpriseAuth'],
    summary: '发现企业身份源',
    security: [],
    request: {
      query: z.object({
        tenantCode: z.string().optional(),
      }),
    },
    responses: { ...ok(EnterpriseIdentityDiscoveryDTO, 'ok'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { tenantCode } = c.req.valid('query');
    return c.json(okBody(await discoverEnterpriseIdentityProviders(tenantCode)), 200);
  },
});

const authUrlRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['EnterpriseAuth'],
    summary: '获取企业身份源授权链接',
    security: [],
    request: {
      params: z.object({
        id: z.coerce.number().int().positive().openapi({ param: { name: 'id', in: 'path' }, example: 1 }),
      }),
      query: z.object({
        redirect: z.string().optional(),
      }),
    },
    responses: { ...ok(z.object({ authUrl: z.string(), state: z.string().nullable() }), 'ok'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { redirect } = c.req.valid('query');
    const { ip, ua } = getClientInfo(c.req.raw.headers);
    return c.json(okBody(await generateEnterpriseAuthUrl(id, { ip, ua, redirectTo: redirect })), 200);
  },
});

const callbackRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/callback',
    tags: ['EnterpriseAuth'],
    summary: '企业 OIDC 登录回调',
    security: [],
    request: {
      body: {
        content: jsonContent(z.object({
          code: z.string(),
          state: z.string(),
        }).openapi('EnterpriseOidcCallbackBody')),
        required: true,
      },
    },
    responses: { ...ok(z.object({ loginResult: LoginResultDTO, redirectTo: z.string().nullable().optional() }), 'ok'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { code, state } = c.req.valid('json');
    return c.json(okBody(await handleEnterpriseOidcCallback(code, state)), 200);
  },
});

router.openapiRoutes([discoverRoute, authUrlRoute, callbackRoute] as const);

export default router;
