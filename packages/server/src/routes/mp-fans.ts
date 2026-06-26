import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery, jsonContent, validationHook, commonErrorResponses,
  ok, okPaginated, IdParam, okBody,
} from '../lib/openapi-schemas';
import { updateMpFanSchema, blacklistMpFansSchema } from '@zenith/shared';
import { MpFanDTO, MpFanSyncResultDTO, MpFanBlacklistResultDTO } from '../lib/openapi-dtos';
import {
  listMpFans, updateMpFan, getMpFanBeforeAudit, syncMpFans,
  blacklistMpFans, unblacklistMpFans, syncMpBlacklist, getMpFansBlacklistAudit, getMpBlacklistStateAudit,
} from '../services/mp-fan.service';
import { createMemberForFan, bindFanToMember, unbindFanMember } from '../services/mp-member.service';

const mpFansRouter = new OpenAPIHono({ defaultHook: validationHook });

const syncBodySchema = z.object({ accountId: z.number().int().positive() });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['公众号粉丝'], summary: '粉丝列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:fan:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        accountId: z.coerce.number().int().positive(),
        keyword: z.string().optional(),
        subscribe: z.enum(['subscribed', 'unsubscribed']).optional(),
        tagId: z.coerce.number().int().positive().optional(),
        blacklisted: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(MpFanDTO, '粉丝列表') },
  }),
  handler: async (c) => c.json(okBody(await listMpFans(c.req.valid('query'))), 200),
});

const syncRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/sync', tags: ['公众号粉丝'], summary: '从微信同步粉丝',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:fan:sync', audit: { description: '同步公众号粉丝', module: '公众号粉丝' } })] as const,
    request: { body: { content: jsonContent(syncBodySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpFanSyncResultDTO, '同步完成') },
  }),
  handler: async (c) => c.json(okBody(await syncMpFans(c.req.valid('json').accountId), '同步完成'), 200),
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['公众号粉丝'], summary: '更新粉丝备注/标签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:fan:update', audit: { description: '更新公众号粉丝', module: '公众号粉丝' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateMpFanSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpFanDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpFanBeforeAudit(id));
    return c.json(okBody(await updateMpFan(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const createMemberRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/create-member', tags: ['公众号粉丝'], summary: '为粉丝创建并绑定会员',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:fan:bind', audit: { description: '粉丝创建会员', module: '公众号粉丝' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(MpFanDTO, '会员已创建并绑定') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpFanBeforeAudit(id));
    return c.json(okBody(await createMemberForFan(id), '会员已创建并绑定'), 200);
  },
});

const bindMemberRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/bind-member', tags: ['公众号粉丝'], summary: '绑定粉丝到已有会员',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:fan:bind', audit: { description: '粉丝绑定会员', module: '公众号粉丝' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(z.object({ memberId: z.number().int().positive() })), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpFanDTO, '绑定成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpFanBeforeAudit(id));
    return c.json(okBody(await bindFanToMember(id, c.req.valid('json').memberId), '绑定成功'), 200);
  },
});

const unbindMemberRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/unbind-member', tags: ['公众号粉丝'], summary: '解绑粉丝会员',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:fan:bind', audit: { description: '粉丝解绑会员', module: '公众号粉丝' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(MpFanDTO, '已解绑') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpFanBeforeAudit(id));
    return c.json(okBody(await unbindFanMember(id), '已解绑'), 200);
  },
});

const blacklistRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/blacklist', tags: ['公众号粉丝'], summary: '批量拉黑粉丝',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:fan:blacklist', audit: { description: '拉黑粉丝', module: '公众号粉丝' } })] as const,
    request: { body: { content: jsonContent(blacklistMpFansSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpFanBlacklistResultDTO, '已拉黑') },
  }),
  handler: async (c) => {
    const b = c.req.valid('json');
    setAuditBeforeData(c, await getMpFansBlacklistAudit(b.accountId, b.openids));
    const result = await blacklistMpFans(b.accountId, b.openids);
    setAuditAfterData(c, await getMpFansBlacklistAudit(b.accountId, b.openids));
    return c.json(okBody(result, '已拉黑'), 200);
  },
});

const unblacklistRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/unblacklist', tags: ['公众号粉丝'], summary: '批量移出黑名单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:fan:blacklist', audit: { description: '移出黑名单', module: '公众号粉丝' } })] as const,
    request: { body: { content: jsonContent(blacklistMpFansSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpFanBlacklistResultDTO, '已移出') },
  }),
  handler: async (c) => {
    const b = c.req.valid('json');
    setAuditBeforeData(c, await getMpFansBlacklistAudit(b.accountId, b.openids));
    const result = await unblacklistMpFans(b.accountId, b.openids);
    setAuditAfterData(c, await getMpFansBlacklistAudit(b.accountId, b.openids));
    return c.json(okBody(result, '已移出'), 200);
  },
});

const syncBlacklistRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/sync-blacklist', tags: ['公众号粉丝'], summary: '从微信同步黑名单',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'mp:fan:blacklist', audit: { description: '同步黑名单', module: '公众号粉丝' } })] as const,
    request: { body: { content: jsonContent(syncBodySchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(MpFanSyncResultDTO, '同步完成') },
  }),
  handler: async (c) => {
    const { accountId } = c.req.valid('json');
    setAuditBeforeData(c, await getMpBlacklistStateAudit(accountId));
    const r = await syncMpBlacklist(accountId);
    setAuditAfterData(c, await getMpBlacklistStateAudit(accountId));
    return c.json(okBody({ success: r.success, synced: r.total, total: r.total }, '同步完成'), 200);
  },
});

mpFansRouter.openapiRoutes([listRoute, syncRoute, blacklistRoute, unblacklistRoute, syncBlacklistRoute, updateRoute, createMemberRoute, bindMemberRoute, unbindMemberRoute] as const);

export default mpFansRouter;
