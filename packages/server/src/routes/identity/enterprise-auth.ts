import { OpenAPIHono, createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { enterpriseAuthContract } from '@zenith/shared/identity';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook, commonErrorResponses } from '../../lib/openapi-schemas';
import {
  discoverEnterpriseIdentityProviders,
  exchangeEnterpriseSamlTicket,
  generateEnterpriseAuthUrl,
  handleEnterpriseLdapLogin,
  handleEnterpriseOidcCallback,
  handleEnterpriseSamlAcs,
} from '../../services/identity/identity-providers.service';
import { getClientInfo } from '../../lib/request-helpers';

const router = new OpenAPIHono({ defaultHook: validationHook });

const discoverRoute = defineContractRoute(enterpriseAuthContract.providers, {
  middleware: [] as const,
  handler: async (c) => c.json(okBody(await discoverEnterpriseIdentityProviders(c.req.valid('query').tenantCode)), 200),
});

const authUrlRoute = defineContractRoute(enterpriseAuthContract.authUrl, {
  middleware: [] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { redirect, tenantCode } = c.req.valid('query');
    const { ip, ua } = getClientInfo(c);
    return c.json(okBody(await generateEnterpriseAuthUrl(id, { ip, ua, tenantCode, redirectTo: redirect })), 200);
  },
});

const callbackRoute = defineContractRoute(enterpriseAuthContract.callback, {
  middleware: [] as const,
  handler: async (c) => {
    const { code, state, deviceId } = c.req.valid('json');
    return c.json(okBody(await handleEnterpriseOidcCallback(code, state, undefined, deviceId)), 200);
  },
});

const ldapLoginRoute = defineContractRoute(enterpriseAuthContract.ldapLogin, {
  middleware: [] as const,
  handler: async (c) => {
    const body = c.req.valid('json');
    const { ip, ua } = getClientInfo(c);
    return c.json(okBody(await handleEnterpriseLdapLogin({ ...body, ip, ua })), 200);
  },
});

// IdP 以 application/x-www-form-urlencoded 表单 POST 回调，成功后 302 到前端回调页；
// 非 JSON 协议，无法由契约表达，单独声明
const samlAcsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/saml/acs',
    tags: ['EnterpriseAuth'],
    summary: '企业 SAML ACS 回调',
    security: [],
    responses: {
      302: { description: '重定向至前端企业登录回调页' },
      ...commonErrorResponses,
    },
  }),
  handler: async (c) => {
    const body = await c.req.parseBody();
    const samlResponse = typeof body.SAMLResponse === 'string' ? body.SAMLResponse : '';
    const relayState = typeof body.RelayState === 'string' ? body.RelayState : '';
    const result = await handleEnterpriseSamlAcs(samlResponse, relayState);
    return c.redirect(result.redirectUrl, 302);
  },
});

const samlExchangeRoute = defineContractRoute(enterpriseAuthContract.samlExchange, {
  middleware: [] as const,
  handler: async (c) => c.json(okBody(await exchangeEnterpriseSamlTicket(c.req.valid('json').ticket)), 200),
});

router.openapiRoutes([discoverRoute, authUrlRoute, callbackRoute, ldapLoginRoute, samlAcsRoute, samlExchangeRoute] as const);

export default router;
