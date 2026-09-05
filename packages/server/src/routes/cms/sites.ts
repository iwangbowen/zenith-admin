import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsSiteContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData, setAuditAfterData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { getThemeSettingsSchema, isThemeRegistered, listThemes, listThemeTemplates } from '../../cms/themes/registry';
import {
  listCmsSites, listAllCmsSites, getCmsSite, createCmsSite, updateCmsSite, deleteCmsSite,
  ensureCmsSiteExists, mapCmsSite, getCmsSiteUsers, setCmsSiteUsers, enableSiteAnalytics, assertSiteAccess,
  getCmsEffectiveConfig, getCmsSiteInheritanceChain, listCmsSiteTree, moveCmsSite,
  updateCmsSiteInheritance,
} from '../../services/cms/cms-sites.service';
import { getSiteTemplateHealth } from '../../services/cms/cms-template-refs.service';
import { exportCmsSite, importCmsSite } from '../../services/cms/cms-site-transfer.service';
import {
  deleteCmsOpenAppGrant, listCmsOpenAppGrants, saveCmsOpenAppGrant,
} from '../../services/cms/cms-open-grants.service';
import { formatFileTimestamp } from '../../lib/datetime';
import { assertAllCmsSiteChannelsAccess } from '../../services/cms/cms-channels.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:site:list' })] as const;

const listRoute = defineContractRoute(cmsSiteContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsSites(c.req.valid('query'))), 200),
});

const allRoute = defineContractRoute(cmsSiteContract.all, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listAllCmsSites()), 200),
});

const treeRoute = defineContractRoute(cmsSiteContract.tree, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsSiteTree(c.req.valid('query'))), 200),
});

const themesRoute = defineContractRoute(cmsSiteContract.themes, {
  middleware: read,
  handler: async (c) => c.json(okBody(listThemes()), 200),
});

const themeTemplatesRoute = defineContractRoute(cmsSiteContract.themeTemplates, {
  middleware: read,
  handler: async (c) => {
    const code = c.req.valid('param').code;
    const options = isThemeRegistered(code) ? listThemeTemplates(code) : { list: [], detail: [] };
    return c.json(okBody({ list: options.list, detail: options.detail }), 200);
  },
});

const themeSettingsSchemaRoute = defineContractRoute(cmsSiteContract.themeSettingsSchema, {
  middleware: read,
  handler: (c) => {
    const { code } = c.req.valid('param');
    return c.json(okBody(isThemeRegistered(code) ? getThemeSettingsSchema(code) : []), 200);
  },
});

const templateHealthRoute = defineContractRoute(cmsSiteContract.templateHealth, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await assertSiteAccess(id);
    await assertAllCmsSiteChannelsAccess(id);
    return c.json(okBody(await getSiteTemplateHealth(id, c.req.valid('query').theme)), 200);
  },
});

const getOneRoute = defineContractRoute(cmsSiteContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsSite(c.req.valid('param').id)), 200),
});

const inheritanceChainRoute = defineContractRoute(cmsSiteContract.inheritanceChain, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsSiteInheritanceChain(c.req.valid('param').id)), 200),
});

const effectiveConfigRoute = defineContractRoute(cmsSiteContract.effectiveConfig, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsEffectiveConfig(c.req.valid('param').id)), 200),
});

const moveRoute = defineContractRoute(cmsSiteContract.move, {
  middleware: [authMiddleware, guard({
    permission: 'cms:site:hierarchy',
    audit: { description: '移动 CMS 站点子树', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const result = await moveCmsSite(c.req.valid('param').id, c.req.valid('json').parentId);
    setAuditAfterData(c, result);
    return c.json(okBody(result, '站点子树已移动，受影响站点重建任务已提交'), 200);
  },
});

const updateInheritanceRoute = defineContractRoute(cmsSiteContract.updateInheritance, {
  middleware: [authMiddleware, guard({
    permission: 'cms:site:hierarchy',
    audit: { description: '更新 CMS 站点继承策略', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const result = await updateCmsSiteInheritance(c.req.valid('param').id, c.req.valid('json'));
    setAuditAfterData(c, result);
    return c.json(okBody(result, '继承策略已更新'), 200);
  },
});

const createRouteDef = defineContractRoute(cmsSiteContract.create, {
  middleware: [authMiddleware, guard({ permission: 'cms:site:create', audit: { description: '创建 CMS 站点', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsSite(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(cmsSiteContract.update, {
  middleware: [authMiddleware, guard({ permission: 'cms:site:update', audit: { description: '更新 CMS 站点', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSite(await ensureCmsSiteExists(id)));
    return c.json(okBody(await updateCmsSite(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(cmsSiteContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'cms:site:delete', audit: { description: '删除 CMS 站点', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSite(await ensureCmsSiteExists(id)));
    await deleteCmsSite(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 站点授权用户（站点级数据权限）────────────────────────────────────────────
const getSiteUsersRoute = defineContractRoute(cmsSiteContract.users, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsSiteUsers(c.req.valid('param').id)), 200),
});

const setSiteUsersRoute = defineContractRoute(cmsSiteContract.setUsers, {
  middleware: [authMiddleware, guard({ permission: 'cms:site:update', audit: { description: '设置 CMS 站点授权用户', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userIds } = c.req.valid('json');
    const before = await getCmsSiteUsers(id);
    setAuditBeforeData(c, before);
    const after = await setCmsSiteUsers(id, userIds);
    setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

// ─── 开通行为统计（自动创建 analytics 站点并注入采集脚本）─────────────────────
const enableAnalyticsRoute = defineContractRoute(cmsSiteContract.enableAnalytics, {
  middleware: [authMiddleware, guard({ permission: 'cms:site:update', audit: { description: 'CMS 站点开通行为统计', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const result = await enableSiteAnalytics(c.req.valid('param').id);
    return c.json(okBody(result, result.created ? '已开通行为统计' : '行为统计已开通过'), 200);
  },
});

// ─── 站点导入导出（整站备份迁移）──────────────────────────────────────────────
const importSiteRoute = defineContractRoute(cmsSiteContract.import, {
  middleware: [authMiddleware, guard({ permission: 'cms:site:create', audit: { description: '导入 CMS 站点', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const result = await importCmsSite(c.req.valid('json'));
    setAuditAfterData(c, result);
    return c.json(okBody(result, `站点「${result.siteName}」导入成功，内容已统一转为草稿`), 200);
  },
});

// 站点导出：JSON 附件下载（结构+内容整站打包，不含运行数据）
const exportSiteRoute = defineContractRoute(cmsSiteContract.export, {
  middleware: [authMiddleware, guard({
    permission: 'cms:site:update',
    audit: { description: '导出 CMS 站点', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const pkg = await exportCmsSite(id);
    const siteCode = String((pkg.site as Record<string, unknown>).code ?? id);
    const filename = `cms-site-${siteCode}-${formatFileTimestamp(new Date())}.json`;
    return new Response(JSON.stringify(pkg, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  },
});

// ─── 开放授权（Headless 写入的 fail-closed 边界）──────────────────────────────
const listGrantsRoute = defineContractRoute(cmsSiteContract.openGrants, {
  middleware: [authMiddleware, guard({ permission: 'cms:site:update' })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await assertSiteAccess(id);
    return c.json(okBody(await listCmsOpenAppGrants(id)), 200);
  },
});

const saveGrantRoute = defineContractRoute(cmsSiteContract.saveOpenGrant, {
  middleware: [authMiddleware, guard({ permission: 'cms:site:update', audit: { description: '设置 CMS 站点开放授权', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await assertSiteAccess(id);
    const row = await saveCmsOpenAppGrant({ ...c.req.valid('json'), siteId: id });
    setAuditAfterData(c, row);
    return c.json(okBody(row, '已保存'), 200);
  },
});

const deleteGrantRoute = defineContractRoute(cmsSiteContract.removeOpenGrant, {
  middleware: [authMiddleware, guard({ permission: 'cms:site:update', audit: { description: '删除 CMS 站点开放授权', module: 'CMS内容管理' } })],
  handler: async (c) => {
    await deleteCmsOpenAppGrant(c.req.valid('param').grantId);
    return c.json(okBody(null, '已删除'), 200);
  },
});

router.openapiRoutes([
  listRoute, allRoute, treeRoute, themesRoute, themeTemplatesRoute, themeSettingsSchemaRoute,
  templateHealthRoute, inheritanceChainRoute, effectiveConfigRoute, moveRoute, updateInheritanceRoute,
  getOneRoute, createRouteDef, updateRouteDef, deleteRouteDef, getSiteUsersRoute, setSiteUsersRoute,
  enableAnalyticsRoute, importSiteRoute, exportSiteRoute,
  listGrantsRoute, saveGrantRoute, deleteGrantRoute,
] as const);

export default router;
