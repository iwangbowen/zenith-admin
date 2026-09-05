import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsFriendLinkContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listCmsFriendLinks, createCmsFriendLink, updateCmsFriendLink, deleteCmsFriendLink,
  ensureCmsFriendLinkExists, mapCmsFriendLink,
} from '../../services/cms/cms-friend-links.service';
import {
  listCmsFriendLinkGroups, listAllCmsFriendLinkGroups, createCmsFriendLinkGroup,
  updateCmsFriendLinkGroup, deleteCmsFriendLinkGroup,
  ensureCmsFriendLinkGroupExists, mapCmsFriendLinkGroup,
} from '../../services/cms/cms-friend-link-groups.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:link:list' })] as const;

const listRoute = defineContractRoute(cmsFriendLinkContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsFriendLinks(c.req.valid('query'))), 200),
});

const createRouteDef = defineContractRoute(cmsFriendLinkContract.create, {
  middleware: [authMiddleware, guard({ permission: 'cms:link:create', audit: { description: '创建 CMS 友情链接', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsFriendLink(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(cmsFriendLinkContract.update, {
  middleware: [authMiddleware, guard({ permission: 'cms:link:update', audit: { description: '更新 CMS 友情链接', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsFriendLink(await ensureCmsFriendLinkExists(id)));
    return c.json(okBody(await updateCmsFriendLink(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsFriendLinkContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'cms:link:delete', audit: { description: '删除 CMS 友情链接', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsFriendLink(await ensureCmsFriendLinkExists(id)));
    await deleteCmsFriendLink(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 友链分组（独立子资源：/groups；置于 /{id} 之前避免路径冲突）─────────────────
const groupListRoute = defineContractRoute(cmsFriendLinkContract.groupList, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsFriendLinkGroups(c.req.valid('query'))), 200),
});

const groupAllRoute = defineContractRoute(cmsFriendLinkContract.groupAll, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listAllCmsFriendLinkGroups(c.req.valid('query').siteId)), 200),
});

const groupCreateRoute = defineContractRoute(cmsFriendLinkContract.groupCreate, {
  middleware: [authMiddleware, guard({ permission: 'cms:link:create', audit: { description: '创建 CMS 友链分组', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsFriendLinkGroup(c.req.valid('json')), '创建成功'), 200),
});

const groupUpdateRoute = defineContractRoute(cmsFriendLinkContract.groupUpdate, {
  middleware: [authMiddleware, guard({ permission: 'cms:link:update', audit: { description: '更新 CMS 友链分组', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsFriendLinkGroup(await ensureCmsFriendLinkGroupExists(id)));
    return c.json(okBody(await updateCmsFriendLinkGroup(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const groupDeleteRoute = defineContractRoute(cmsFriendLinkContract.groupRemove, {
  middleware: [authMiddleware, guard({ permission: 'cms:link:delete', audit: { description: '删除 CMS 友链分组', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsFriendLinkGroup(await ensureCmsFriendLinkGroupExists(id)));
    await deleteCmsFriendLinkGroup(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([
  groupAllRoute, groupListRoute, groupCreateRoute, groupUpdateRoute, groupDeleteRoute,
  listRoute, createRouteDef, updateRouteDef, deleteRouteDef,
] as const);

export default router;
