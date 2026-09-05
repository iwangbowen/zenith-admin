import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsSeoContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsRedirects, createCmsRedirect, updateCmsRedirect, deleteCmsRedirect, ensureCmsRedirectExists, mapCmsRedirect,
} from '../../services/cms/cms-redirects.service';
import {
  listCmsLinkWords, createCmsLinkWord, updateCmsLinkWord, deleteCmsLinkWord, ensureCmsLinkWordExists, mapCmsLinkWord,
} from '../../services/cms/cms-link-words.service';
import { pushCmsUrls, listCmsPushLogs } from '../../services/cms/cms-push.service';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { assertSiteAccess, ensureCmsSiteExists } from '../../services/cms/cms-sites.service';
import { assertAllCmsSiteChannelsAccess } from '../../services/cms/cms-channels.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const manage = [authMiddleware, guard({ permission: 'cms:seo:manage' })] as const;

// ─── 301 重定向 ───────────────────────────────────────────────────────────────
const listRedirects = defineContractRoute(cmsSeoContract.redirectList, {
  middleware: manage,
  handler: async (c) => c.json(okBody(await listCmsRedirects(c.req.valid('query'))), 200),
});

const createRedirect = defineContractRoute(cmsSeoContract.redirectCreate, {
  middleware: [authMiddleware, guard({ permission: 'cms:seo:manage', audit: { description: '创建 CMS 重定向', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsRedirect(c.req.valid('json')), '创建成功'), 200),
});

const updateRedirect = defineContractRoute(cmsSeoContract.redirectUpdate, {
  middleware: [authMiddleware, guard({ permission: 'cms:seo:manage', audit: { description: '更新 CMS 重定向', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsRedirect(await ensureCmsRedirectExists(id)));
    return c.json(okBody(await updateCmsRedirect(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRedirect = defineContractRoute(cmsSeoContract.redirectRemove, {
  middleware: [authMiddleware, guard({ permission: 'cms:seo:manage', audit: { description: '删除 CMS 重定向', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsRedirect(await ensureCmsRedirectExists(id)));
    await deleteCmsRedirect(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 内链词 ───────────────────────────────────────────────────────────────────
const listLinkWords = defineContractRoute(cmsSeoContract.linkWordList, {
  middleware: manage,
  handler: async (c) => c.json(okBody(await listCmsLinkWords(c.req.valid('query'))), 200),
});

const createLinkWord = defineContractRoute(cmsSeoContract.linkWordCreate, {
  middleware: [authMiddleware, guard({ permission: 'cms:seo:manage', audit: { description: '创建 CMS 内链词', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsLinkWord(c.req.valid('json')), '创建成功'), 200),
});

const updateLinkWord = defineContractRoute(cmsSeoContract.linkWordUpdate, {
  middleware: [authMiddleware, guard({ permission: 'cms:seo:manage', audit: { description: '更新 CMS 内链词', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsLinkWord(await ensureCmsLinkWordExists(id)));
    return c.json(okBody(await updateCmsLinkWord(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteLinkWord = defineContractRoute(cmsSeoContract.linkWordRemove, {
  middleware: [authMiddleware, guard({ permission: 'cms:seo:manage', audit: { description: '删除 CMS 内链词', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsLinkWord(await ensureCmsLinkWordExists(id)));
    await deleteCmsLinkWord(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 搜索引擎推送 ─────────────────────────────────────────────────────────────
const pushRoute = defineContractRoute(cmsSeoContract.push, {
  middleware: [authMiddleware, guard({ permission: 'cms:seo:push', audit: { description: 'CMS 搜索引擎推送', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { siteId, urls, engines } = c.req.valid('json');
    return c.json(okBody(await pushCmsUrls(siteId, urls, engines), '推送完成'), 200);
  },
});

const pushLogsRoute = defineContractRoute(cmsSeoContract.pushLogs, {
  middleware: manage,
  handler: async (c) => c.json(okBody(await listCmsPushLogs(c.req.valid('query'))), 200),
});

// ─── 死链检测（任务中心执行）──────────────────────────────────────────────────
const deadlinkRoute = defineContractRoute(cmsSeoContract.deadlinkCheck, {
  middleware: [authMiddleware, guard({ permission: 'cms:seo:manage', audit: { description: 'CMS 死链检测', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { siteId } = c.req.valid('json');
    const site = await ensureCmsSiteExists(siteId);
    await assertSiteAccess(siteId);
    await assertAllCmsSiteChannelsAccess(siteId);
    const row = await submitAsyncTask({
      taskType: 'cms-deadlink-check',
      title: `CMS 死链检测（${site.name}）`,
      payload: { siteId },
    });
    return c.json(okBody(mapAsyncTask(row), '任务已提交，可在任务中心查看进度与坏链明细'), 200);
  },
});

router.openapiRoutes([
  listRedirects, createRedirect, updateRedirect, deleteRedirect,
  listLinkWords, createLinkWord, updateLinkWord, deleteLinkWord,
  pushRoute, pushLogsRoute, deadlinkRoute,
] as const);

export default router;
