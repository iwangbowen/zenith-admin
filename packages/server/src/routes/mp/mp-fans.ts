import { OpenAPIHono } from '@hono/zod-openapi';
import { mpFanContract } from '@zenith/shared/mp';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpFans, updateMpFan, getMpFanBeforeAudit, syncMpFans,
  blacklistMpFans, unblacklistMpFans, syncMpBlacklist, getMpFansBlacklistAudit, getMpBlacklistStateAudit,
} from '../../services/mp/mp-fan.service';
import { createMemberForFan, bindFanToMember, unbindFanMember } from '../../services/mp/mp-member.service';

const mpFansRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(mpFanContract.list, {
  middleware: [authMiddleware, guard({ permission: 'mp:fan:list' })],
  handler: async (c) => c.json(okBody(await listMpFans(c.req.valid('query'))), 200),
});

const syncRoute = defineContractRoute(mpFanContract.sync, {
  middleware: [authMiddleware, guard({ permission: 'mp:fan:sync', audit: { description: '同步公众号粉丝', module: '公众号粉丝' } })],
  handler: async (c) => c.json(okBody(await syncMpFans(c.req.valid('json').accountId), '同步完成'), 200),
});

const updateRoute = defineContractRoute(mpFanContract.update, {
  middleware: [authMiddleware, guard({ permission: 'mp:fan:update', audit: { description: '更新公众号粉丝', module: '公众号粉丝' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpFanBeforeAudit(id));
    return c.json(okBody(await updateMpFan(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const createMemberRoute = defineContractRoute(mpFanContract.createMember, {
  middleware: [authMiddleware, guard({ permission: 'mp:fan:bind', audit: { description: '粉丝创建会员', module: '公众号粉丝' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpFanBeforeAudit(id));
    return c.json(okBody(await createMemberForFan(id), '会员已创建并绑定'), 200);
  },
});

const bindMemberRoute = defineContractRoute(mpFanContract.bindMember, {
  middleware: [authMiddleware, guard({ permission: 'mp:fan:bind', audit: { description: '粉丝绑定会员', module: '公众号粉丝' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpFanBeforeAudit(id));
    return c.json(okBody(await bindFanToMember(id, c.req.valid('json').memberId), '绑定成功'), 200);
  },
});

const unbindMemberRoute = defineContractRoute(mpFanContract.unbindMember, {
  middleware: [authMiddleware, guard({ permission: 'mp:fan:bind', audit: { description: '粉丝解绑会员', module: '公众号粉丝' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMpFanBeforeAudit(id));
    return c.json(okBody(await unbindFanMember(id), '已解绑'), 200);
  },
});

const blacklistRoute = defineContractRoute(mpFanContract.blacklist, {
  middleware: [authMiddleware, guard({ permission: 'mp:fan:blacklist', audit: { description: '拉黑粉丝', module: '公众号粉丝' } })],
  handler: async (c) => {
    const b = c.req.valid('json');
    setAuditBeforeData(c, await getMpFansBlacklistAudit(b.accountId, b.openids));
    const result = await blacklistMpFans(b.accountId, b.openids);
    setAuditAfterData(c, await getMpFansBlacklistAudit(b.accountId, b.openids));
    return c.json(okBody(result, '已拉黑'), 200);
  },
});

const unblacklistRoute = defineContractRoute(mpFanContract.unblacklist, {
  middleware: [authMiddleware, guard({ permission: 'mp:fan:blacklist', audit: { description: '移出黑名单', module: '公众号粉丝' } })],
  handler: async (c) => {
    const b = c.req.valid('json');
    setAuditBeforeData(c, await getMpFansBlacklistAudit(b.accountId, b.openids));
    const result = await unblacklistMpFans(b.accountId, b.openids);
    setAuditAfterData(c, await getMpFansBlacklistAudit(b.accountId, b.openids));
    return c.json(okBody(result, '已移出'), 200);
  },
});

const syncBlacklistRoute = defineContractRoute(mpFanContract.syncBlacklist, {
  middleware: [authMiddleware, guard({ permission: 'mp:fan:blacklist', audit: { description: '同步黑名单', module: '公众号粉丝' } })],
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
