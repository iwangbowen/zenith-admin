import { OpenAPIHono } from '@hono/zod-openapi';
import { oauth2ClientContract } from '@zenith/shared/open-platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listOAuth2Clients,
  createOAuth2Client,
  getOAuth2Client,
  updateOAuth2Client,
  deleteOAuth2Client,
  regenerateOAuth2ClientSecret,
  listClientTokens,
  revokeToken,
  getOAuth2ClientBeforeAudit,
  getOAuth2TokenBeforeAudit,
  listAppOptions,
  listClientGrants,
  listMyGrants,
  revokeMyGrant,
  reviewOAuth2Client,
} from '../../services/open-platform/oauth2-clients.service';
import { notifyAppReviewResult } from '../../services/open-platform/developer-apps.service';
import { currentUser } from '../../lib/context';

const router = new OpenAPIHono({ defaultHook: validationHook });

const MODULE = 'OAuth2 应用';
const read = [authMiddleware, guard({ permission: 'system:oauth2-apps:view' })] as const;

const list = defineContractRoute(oauth2ClientContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listOAuth2Clients(c.req.valid('query'))), 200),
});

const create = defineContractRoute(oauth2ClientContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'system:oauth2-apps:manage',
    audit: { description: '创建 OAuth2 应用', module: MODULE, recordResponseBody: false },
  })],
  handler: async (c) => {
    const created = await createOAuth2Client(c.req.valid('json'));
    setAuditAfterData(c, { ...created, clientSecret: created.clientSecret ? '[REDACTED]' : '' });
    return c.json(okBody(created, '应用已创建，client_secret 仅返回一次，请妥善保存'), 200);
  },
});

const detail = defineContractRoute(oauth2ClientContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getOAuth2Client(c.req.valid('param').id)), 200),
});

const grants = defineContractRoute(oauth2ClientContract.grants, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    const client = await getOAuth2Client(id);
    return c.json(okBody(await listClientGrants(client.clientId, { page, pageSize })), 200);
  },
});

const review = defineContractRoute(oauth2ClientContract.review, {
  middleware: [authMiddleware, guard({
    permission: 'system:oauth2-apps:manage',
    audit: { description: '审核 OAuth2 应用', module: MODULE },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2ClientBeforeAudit(id));
    const result = await reviewOAuth2Client(id, c.req.valid('json'));
    await notifyAppReviewResult(id);
    setAuditAfterData(c, result);
    return c.json(okBody(result, '审核完成'), 200);
  },
});

const update = defineContractRoute(oauth2ClientContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'system:oauth2-apps:manage',
    audit: { description: '更新 OAuth2 应用', module: MODULE },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2ClientBeforeAudit(id));
    return c.json(okBody(await updateOAuth2Client(id, c.req.valid('json'))), 200);
  },
});

const remove = defineContractRoute(oauth2ClientContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'system:oauth2-apps:manage',
    audit: { description: '删除 OAuth2 应用', module: MODULE },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2ClientBeforeAudit(id));
    await deleteOAuth2Client(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const regenerateSecret = defineContractRoute(oauth2ClientContract.regenerateSecret, {
  middleware: [authMiddleware, guard({
    permission: 'system:oauth2-apps:manage',
    audit: { description: '重置 OAuth2 应用密钥', module: MODULE, recordResponseBody: false },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2ClientBeforeAudit(id));
    const result = await regenerateOAuth2ClientSecret(id);
    setAuditAfterData(c, { clientId: result.clientId, clientSecret: '[REDACTED]' });
    return c.json(okBody(result, '新 secret 仅返回一次，请妥善保存'), 200);
  },
});

const tokens = defineContractRoute(oauth2ClientContract.tokens, {
  middleware: read,
  handler: async (c) => {
    const { clientId, page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listClientTokens(clientId, { page, pageSize })), 200);
  },
});

const revokeTokenRoute = defineContractRoute(oauth2ClientContract.revokeToken, {
  middleware: [authMiddleware, guard({
    permission: 'system:oauth2-apps:manage',
    audit: { description: '撤销 OAuth2 令牌', module: MODULE },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getOAuth2TokenBeforeAudit(id));
    await revokeToken(id);
    return c.json(okBody(null, '令牌已撤销'), 200);
  },
});

const options = defineContractRoute(oauth2ClientContract.options, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listAppOptions()), 200),
});

/**
 * 「我的已授权应用」——用户自助管理入口，只操作当前登录用户自己的授权，
 * 因此不挂任何 permission guard（登录即可访问自己的数据）。
 */
const myGrants = defineContractRoute(oauth2ClientContract.myGrants, {
  middleware: [authMiddleware],
  handler: async (c) => {
    const { page, pageSize } = c.req.valid('query');
    return c.json(okBody(await listMyGrants(currentUser().userId, { page, pageSize })), 200);
  },
});

const revokeMyGrantRoute = defineContractRoute(oauth2ClientContract.revokeMyGrant, {
  middleware: [authMiddleware, guard({ audit: { description: '撤销第三方应用授权', module: MODULE } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await revokeMyGrant(currentUser().userId, id);
    return c.json(okBody(null, '授权已撤销'), 200);
  },
});

router.openapiRoutes([
  list, options, tokens, revokeTokenRoute, myGrants, revokeMyGrantRoute,
  create, grants, review, detail, update, remove, regenerateSecret,
] as const);

export default router;
