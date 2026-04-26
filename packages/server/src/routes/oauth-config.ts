import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import type { OAuthProviderType } from '@zenith/shared';
import { jsonContent, validationHook, commonErrorResponses, ok, okBody } from '../lib/openapi-schemas';
import { OAuthConfigItemDTO } from '../lib/openapi-dtos';
import { updateOauthConfigSchema } from '@zenith/shared';
import { listOauthConfigs, updateOauthConfig, getOauthConfigBeforeAudit } from '../services/oauth-config.service';

const oauthConfigRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['OAuthConfig'], summary: '获取所有 OAuth 配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:oauth-config:view' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(OAuthConfigItemDTO), 'OAuth 配置列表') },
  }),
  handler: async (c) => c.json(okBody(await listOauthConfigs(), 'success'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{provider}', tags: ['OAuthConfig'], summary: '更新指定 provider 的 OAuth 配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:oauth-config:update', audit: { description: '更新OAuth配置', module: 'OAuth配置' } })] as const,
    request: {
      params: z.object({ provider: z.string().openapi({ param: { name: 'provider', in: 'path' }, example: 'github', description: 'OAuth 提供方' }) }),
      body: { content: jsonContent(updateOauthConfigSchema), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(OAuthConfigItemDTO.nullable(), '保存成功') },
  }),
  handler: async (c) => {
    const provider = c.req.param('provider') as OAuthProviderType;
    const before = await getOauthConfigBeforeAudit(provider);
    if (before) setAuditBeforeData(c, before);
    const result = await updateOauthConfig(provider, c.req.valid('json'));
    return c.json(okBody(result, '保存成功'), 200);
  },
});

oauthConfigRouter.openapiRoutes([listRoute, updateRoute] as const);

export default oauthConfigRouter;
