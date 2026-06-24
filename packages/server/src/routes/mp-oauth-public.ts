import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { validationHook, commonErrorResponses, ok, okBody } from '../lib/openapi-schemas';
import { MpOAuthResultDTO } from '../lib/openapi-dtos';
import { handleMpOAuthCallback } from '../services/mp-oauth.service';

/**
 * 公众号网页授权回调（公开端点，无需登录）。
 * 微信在用户授权后回跳此地址并带上 code，服务端用 code 换取 openid/unionid（及用户信息）。
 *   GET /api/public/mp/oauth/{accountId}?code=&state=
 */
const mpOAuthPublicRouter = new OpenAPIHono({ defaultHook: validationHook });

const callbackRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{accountId}', tags: ['公众号网页授权（公开）'],
    summary: '网页授权回调（公开，无需登录）',
    request: {
      params: z.object({ accountId: z.coerce.number().int().positive().openapi({ param: { name: 'accountId', in: 'path' }, example: 1 }) }),
      query: z.object({ code: z.string().min(1, '缺少 code'), state: z.string().optional() }),
    },
    responses: { ...commonErrorResponses, ...ok(MpOAuthResultDTO, '授权成功') },
  }),
  handler: async (c) => {
    const { accountId } = c.req.valid('param');
    const { code } = c.req.valid('query');
    return c.json(okBody(await handleMpOAuthCallback(accountId, code), '授权成功'), 200);
  },
});

mpOAuthPublicRouter.openapiRoutes([callbackRoute] as const);

export default mpOAuthPublicRouter;
