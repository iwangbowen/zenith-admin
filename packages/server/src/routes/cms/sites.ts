import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsSiteContract } from '@zenith/shared/cms';
import { setAuditBeforeData, setAuditAfterData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import { getThemeSettingsSchema, isThemeRegistered, listThemes, listThemeTemplates } from '../../cms/themes/registry';
import {
  listCmsSites,
  listAllCmsSites,
  getCmsSite,
  createCmsSite,
  updateCmsSite,
  deleteCmsSite,
  getCmsSiteUsers,
  setCmsSiteUsers,
  enableSiteAnalytics,
  assertSiteAccess,
  getCmsEffectiveConfig,
  getCmsSiteInheritanceChain,
  listCmsSiteTree,
  moveCmsSite,
  updateCmsSiteInheritance,
} from '../../services/cms/cms-sites.service';
import { getSiteTemplateHealth } from '../../services/cms/cms-template-refs.service';
import { exportCmsSite, importCmsSite, listCmsSiteBlueprints, createCmsSiteFromBlueprint } from '../../services/cms/cms-site-transfer.service';
import {
  deleteCmsOpenAppGrant,
  listCmsOpenAppGrants,
  saveCmsOpenAppGrant,
} from '../../services/cms/cms-open-grants.service';
import { assertAllCmsSiteChannelsAccess } from '../../services/cms/cms-channels.service';
import { attachmentDisposition } from '../../lib/content-disposition';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const allRoute = defineContractRoute(cmsSiteContract.all, {
  handler: async (c) => c.json(okBody(await listAllCmsSites()), 200),
});

const treeRoute = defineContractRoute(cmsSiteContract.tree, {
  handler: async (c) => c.json(okBody(await listCmsSiteTree(c.req.valid('query'))), 200),
});

const themesRoute = defineContractRoute(cmsSiteContract.themes, {
  handler: async (c) => c.json(okBody(listThemes()), 200),
});

const themeTemplatesRoute = defineContractRoute(cmsSiteContract.themeTemplates, {
  handler: async (c) => {
    const code = c.req.valid('param').code;
    const options = isThemeRegistered(code) ? listThemeTemplates(code) : { list: [], detail: [] };
    return c.json(okBody({ list: options.list, detail: options.detail }), 200);
  },
});

const themeSettingsSchemaRoute = defineContractRoute(cmsSiteContract.themeSettingsSchema, {
  handler: (c) => {
    const { code } = c.req.valid('param');
    return c.json(okBody(isThemeRegistered(code) ? getThemeSettingsSchema(code) : []), 200);
  },
});

const templateHealthRoute = defineContractRoute(cmsSiteContract.templateHealth, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await assertSiteAccess(id);
    await assertAllCmsSiteChannelsAccess(id);
    return c.json(okBody(await getSiteTemplateHealth(id, c.req.valid('query').theme)), 200);
  },
});
const inheritanceChainRoute = defineContractRoute(cmsSiteContract.inheritanceChain, {
  handler: async (c) => c.json(okBody(await getCmsSiteInheritanceChain(c.req.valid('param').id)), 200),
});

const effectiveConfigRoute = defineContractRoute(cmsSiteContract.effectiveConfig, {
  handler: async (c) => c.json(okBody(await getCmsEffectiveConfig(c.req.valid('param').id)), 200),
});

const moveRoute = defineContractRoute(cmsSiteContract.move, {
  handler: async (c) => {
    const result = await moveCmsSite(c.req.valid('param').id, c.req.valid('json').parentId);
    setAuditAfterData(c, result);
    return c.json(okBody(result, '站点子树已移动，受影响站点重建任务已提交'), 200);
  },
});

const updateInheritanceRoute = defineContractRoute(cmsSiteContract.updateInheritance, {
  handler: async (c) => {
    const result = await updateCmsSiteInheritance(c.req.valid('param').id, c.req.valid('json'));
    setAuditAfterData(c, result);
    return c.json(okBody(result, '继承策略已更新'), 200);
  },
});
// ─── 站点授权用户（站点级数据权限）────────────────────────────────────────────
const getSiteUsersRoute = defineContractRoute(cmsSiteContract.users, {
  handler: async (c) => c.json(okBody(await getCmsSiteUsers(c.req.valid('param').id)), 200),
});

const setSiteUsersRoute = defineContractRoute(cmsSiteContract.setUsers, {
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
  handler: async (c) => {
    const result = await enableSiteAnalytics(c.req.valid('param').id);
    return c.json(okBody(result, result.created ? '已开通行为统计' : '行为统计已开通过'), 200);
  },
});

// ─── 站点导入导出（整站备份迁移）──────────────────────────────────────────────
const importSiteRoute = defineContractRoute(cmsSiteContract.import, {
  handler: async (c) => {
    const result = await importCmsSite(c.req.valid('json'));
    setAuditAfterData(c, result);
    return c.json(okBody(result, `站点「${result.siteName}」导入成功，内容已统一转为草稿`), 200);
  },
});

// 站点导出：JSON 附件下载（结构+内容整站打包，不含运行数据）
const exportSiteRoute = defineContractRoute(cmsSiteContract.export, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const pkg = await exportCmsSite(id);
    const siteCode = String((pkg.site as Record<string, unknown>).code ?? id);
    const filename = `cms-site-${siteCode}-${formatFileTimestamp(new Date())}.json`;
    return new Response(JSON.stringify(pkg, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': attachmentDisposition(filename),
        'Cache-Control': 'no-store',
      },
    });
  },
});

// ─── 开放授权（Headless 写入的 fail-closed 边界）──────────────────────────────
const listGrantsRoute = defineContractRoute(cmsSiteContract.openGrants, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await assertSiteAccess(id);
    return c.json(okBody(await listCmsOpenAppGrants(id)), 200);
  },
});

const saveGrantRoute = defineContractRoute(cmsSiteContract.saveOpenGrant, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await assertSiteAccess(id);
    const row = await saveCmsOpenAppGrant({ ...c.req.valid('json'), siteId: id });
    setAuditAfterData(c, row);
    return c.json(okBody(row, '已保存'), 200);
  },
});

const deleteGrantRoute = defineContractRoute(cmsSiteContract.removeOpenGrant, {
  handler: async (c) => {
    await deleteCmsOpenAppGrant(c.req.valid('param').grantId);
    return c.json(okBody(null, '已删除'), 200);
  },
});

mountCrud(router, cmsSiteContract,
  { list: listCmsSites, get: getCmsSite, create: createCmsSite, update: updateCmsSite, remove: deleteCmsSite },
  {},
  [
    allRoute,
    treeRoute,
    themesRoute,
    themeTemplatesRoute,
    themeSettingsSchemaRoute,
    templateHealthRoute,
    inheritanceChainRoute,
    effectiveConfigRoute,
    moveRoute,
    updateInheritanceRoute,
    getSiteUsersRoute,
    setSiteUsersRoute,
    enableAnalyticsRoute,
    defineContractRoute(cmsSiteContract.blueprints, { handler: (c) => c.json(okBody(listCmsSiteBlueprints()), 200) }),
    defineContractRoute(cmsSiteContract.fromBlueprint, { handler: async (c) => c.json(okBody(await createCmsSiteFromBlueprint(c.req.valid('json')), '建站配置已准备，待补充内容并发布'), 200) }),
    importSiteRoute,
    exportSiteRoute,
    listGrantsRoute,
    saveGrantRoute,
    deleteGrantRoute,
  ],
);

export default router;
import { formatFileTimestamp } from '../../lib/datetime';
