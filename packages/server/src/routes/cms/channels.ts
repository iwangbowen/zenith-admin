import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsChannelContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData, setAuditAfterData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listCmsChannelTree, getCmsChannel, createCmsChannel, updateCmsChannel, deleteCmsChannel,
  mergeCmsChannels, clearCmsChannel, batchCreateCmsChannels, getCmsChannelUsers, setCmsChannelUsers,
} from '../../services/cms/cms-channels.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:channel:list' })] as const;

const treeRoute = defineContractRoute(cmsChannelContract.tree, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsChannelTree(c.req.valid('query'))), 200),
});

const getOneRoute = defineContractRoute(cmsChannelContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsChannel(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(cmsChannelContract.create, {
  middleware: [authMiddleware, guard({ permission: 'cms:channel:create', audit: { description: '创建 CMS 栏目', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsChannel(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(cmsChannelContract.update, {
  middleware: [authMiddleware, guard({ permission: 'cms:channel:update', audit: { description: '更新 CMS 栏目', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsChannel(id));
    return c.json(okBody(await updateCmsChannel(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsChannelContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'cms:channel:delete', audit: { description: '删除 CMS 栏目', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsChannel(id));
    await deleteCmsChannel(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 栏目运维：合并 / 清空 / 批量新增 ─────────────────────────────────────────
const mergeRoute = defineContractRoute(cmsChannelContract.merge, {
  middleware: [authMiddleware, guard({ permission: 'cms:channel:update', audit: { description: 'CMS 栏目合并', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { sourceIds, targetId } = c.req.valid('json');
    const count = await mergeCmsChannels(sourceIds, targetId);
    return c.json(okBody(null, `合并完成，已迁移 ${count} 条内容`), 200);
  },
});

const clearRoute = defineContractRoute(cmsChannelContract.clear, {
  middleware: [authMiddleware, guard({ permission: 'cms:channel:update', audit: { description: 'CMS 栏目清空', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const count = await clearCmsChannel(c.req.valid('param').id);
    return c.json(okBody(null, `已将 ${count} 条内容移入回收站`), 200);
  },
});

const batchCreateRoute = defineContractRoute(cmsChannelContract.batchCreate, {
  middleware: [authMiddleware, guard({ permission: 'cms:channel:create', audit: { description: 'CMS 栏目批量新增', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { siteId, parentId, names, slugStrategy } = c.req.valid('json');
    const count = await batchCreateCmsChannels(siteId, parentId, names, slugStrategy);
    return c.json(okBody(null, `已创建 ${count} 个栏目`), 200);
  },
});

// ─── 栏目授权用户（栏目级数据权限：绑定后仅授权用户可管理该栏目下内容）─────────
const getChannelUsersRoute = defineContractRoute(cmsChannelContract.users, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsChannelUsers(c.req.valid('param').id)), 200),
});

const setChannelUsersRoute = defineContractRoute(cmsChannelContract.setUsers, {
  middleware: [authMiddleware, guard({ permission: 'cms:channel:update', audit: { description: '设置 CMS 栏目授权用户', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userIds } = c.req.valid('json');
    setAuditBeforeData(c, await getCmsChannelUsers(id));
    const after = await setCmsChannelUsers(id, userIds);
    setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

router.openapiRoutes([treeRoute, getOneRoute, createRouteDef, updateRouteDef, deleteRouteDef, mergeRoute, clearRoute, batchCreateRoute, getChannelUsersRoute, setChannelUsersRoute] as const);

export default router;
