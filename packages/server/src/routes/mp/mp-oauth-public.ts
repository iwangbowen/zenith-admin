import { OpenAPIHono } from '@hono/zod-openapi';
import { mpOAuthPublicContract } from '@zenith/shared/mp';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { handleMpOAuthCallback } from '../../services/mp/mp-oauth.service';

/**
 * 公众号网页授权回调（公开端点，无需登录）。
 * 微信在用户授权后回跳此地址并带上 code，服务端用 code 换取 openid/unionid（及用户信息）。
 *   回调携带 code 与 state 查询参数
 */
const mpOAuthPublicRouter = new OpenAPIHono({ defaultHook: validationHook });

const callbackRoute = defineContractRoute(mpOAuthPublicContract.callback, {
  middleware: [] as const,
  handler: async (c) => {
    const { accountId } = c.req.valid('param');
    const { code } = c.req.valid('query');
    return c.json(okBody(await handleMpOAuthCallback(accountId, code), '授权成功'), 200);
  },
});

mpOAuthPublicRouter.openapiRoutes([callbackRoute] as const);

export default mpOAuthPublicRouter;
