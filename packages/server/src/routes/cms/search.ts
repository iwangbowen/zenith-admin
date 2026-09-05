import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { cmsSearchContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { searchCmsContents, segmentForQuery, reloadCmsSearchDict, clearHotKeywords } from '../../services/cms/cms-search.service';
import {
  listCmsSearchWords, createCmsSearchWord, updateCmsSearchWord, deleteCmsSearchWord,
  ensureCmsSearchWordExists, mapCmsSearchWord, batchDeleteCmsSearchWords, batchUpdateCmsSearchWords,
} from '../../services/cms/cms-search-words.service';
import { assertSiteAccess, ensureCmsSiteExists } from '../../services/cms/cms-sites.service';
import { isCmsPlatformAdmin } from '../../services/cms/cms-access';
import { assertAllCmsSiteChannelsAccess } from '../../services/cms/cms-channels.service';
import {
  createCmsHotword, createCmsHotwordGroup, deleteCmsHotword, deleteCmsHotwordGroup,
  listCmsHotwordGroups, listCmsHotwords, updateCmsHotword, updateCmsHotwordGroup,
} from '../../services/cms/cms-hotwords.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const manage = [authMiddleware, guard({ permission: 'cms:search:manage' })] as const;

const testRoute = defineContractRoute(cmsSearchContract.test, {
  middleware: manage,
  handler: async (c) => {
    const q = c.req.valid('query');
    const { tokens: _tokens, ...result } = await searchCmsContents(q);
    return c.json(okBody(result), 200);
  },
});

const segmentRoute = defineContractRoute(cmsSearchContract.segment, {
  middleware: manage,
  handler: async (c) => {
    const { siteId, text } = c.req.valid('query');
    await assertSiteAccess(siteId);
    await reloadCmsSearchDict(siteId);
    return c.json(okBody({ tokens: segmentForQuery(text, siteId) }), 200);
  },
});

const reindexRoute = defineContractRoute(cmsSearchContract.reindex, {
  middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: 'CMS 检索索引重建', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { siteId } = c.req.valid('json');
    let title = 'CMS 检索索引重建（全部站点）';
    if (siteId) {
      const site = await ensureCmsSiteExists(siteId);
      await assertSiteAccess(siteId);
      await assertAllCmsSiteChannelsAccess(siteId);
      title = `CMS 检索索引重建（${site.name}）`;
    } else if (!isCmsPlatformAdmin()) {
      throw new HTTPException(403, { message: '非平台管理员重建索引时必须选择并拥有完整栏目权限的站点' });
    }
    const row = await submitAsyncTask({
      taskType: 'cms-search-reindex',
      title,
      payload: { siteId: siteId ?? null },
    });
    return c.json(okBody(mapAsyncTask(row), '任务已提交，可在任务中心查看进度'), 200);
  },
});

// ═══ 自定义词典 + 搜索热词 ═══════════════════════════════════════════════════

const listWordsRoute = defineContractRoute(cmsSearchContract.wordList, {
  middleware: manage,
  handler: async (c) => c.json(okBody(await listCmsSearchWords(c.req.valid('query'))), 200),
});

const createWordRoute = defineContractRoute(cmsSearchContract.wordCreate, {
  middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: '新增 CMS 检索词条', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsSearchWord(c.req.valid('json')), '创建成功'), 200),
});

const updateWordRoute = defineContractRoute(cmsSearchContract.wordUpdate, {
  middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: '更新 CMS 检索词条', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSearchWord(await ensureCmsSearchWordExists(id)));
    return c.json(okBody(await updateCmsSearchWord(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteWordRoute = defineContractRoute(cmsSearchContract.wordRemove, {
  middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: '删除 CMS 检索词条', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSearchWord(await ensureCmsSearchWordExists(id)));
    await deleteCmsSearchWord(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchUpdateWordsRoute = defineContractRoute(cmsSearchContract.wordBatchUpdate, {
  middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: '批量更新 CMS 检索词典', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const count = await batchUpdateCmsSearchWords(c.req.valid('json'));
    return c.json(okBody(null, `已更新 ${count} 个词条`), 200);
  },
});

const batchDeleteWordsRoute = defineContractRoute(cmsSearchContract.wordBatchRemove, {
  middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: '批量删除 CMS 检索词典', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const count = await batchDeleteCmsSearchWords(c.req.valid('json').ids);
    return c.json(okBody(null, `已删除 ${count} 个词条`), 200);
  },
});

const hotKeywordsRoute = defineContractRoute(cmsSearchContract.hotKeywords, {
  middleware: manage,
  handler: async (c) => c.json(okBody(await listCmsHotwords(c.req.valid('query'))), 200),
});

const clearHotRoute = defineContractRoute(cmsSearchContract.clearHotKeywords, {
  middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: '清空 CMS 搜索热词', module: 'CMS内容管理' } })],
  handler: async (c) => {
    await clearHotKeywords(c.req.valid('json').siteId);
    return c.json(okBody(null, '已清空'), 200);
  },
});

const hotwordGroupsRoute = defineContractRoute(cmsSearchContract.hotwordGroups, {
  middleware: manage,
  handler: async (c) => c.json(okBody(await listCmsHotwordGroups(c.req.valid('query').siteId)), 200),
});

const createHotwordGroupRoute = defineContractRoute(cmsSearchContract.hotwordGroupCreate, {
  middleware: manage,
  handler: async (c) => c.json(okBody(await createCmsHotwordGroup(c.req.valid('json')), '创建成功'), 200),
});

const updateHotwordGroupRoute = defineContractRoute(cmsSearchContract.hotwordGroupUpdate, {
  middleware: manage,
  handler: async (c) => c.json(okBody(await updateCmsHotwordGroup(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteHotwordGroupRoute = defineContractRoute(cmsSearchContract.hotwordGroupRemove, {
  middleware: manage,
  handler: async (c) => {
    await deleteCmsHotwordGroup(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const createHotwordRoute = defineContractRoute(cmsSearchContract.hotwordCreate, {
  middleware: manage,
  handler: async (c) => {
    await createCmsHotword(c.req.valid('json'));
    return c.json(okBody(null, '创建成功'), 200);
  },
});

const updateHotwordRoute = defineContractRoute(cmsSearchContract.hotwordUpdate, {
  middleware: manage,
  handler: async (c) => {
    await updateCmsHotword(c.req.valid('param').id, c.req.valid('json'));
    return c.json(okBody(null, '更新成功'), 200);
  },
});

const deleteHotwordRoute = defineContractRoute(cmsSearchContract.hotwordRemove, {
  middleware: manage,
  handler: async (c) => {
    await deleteCmsHotword(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// /words/batch 与 /hot-keywords/clear 是静态路径，必须早于同前缀的 /{id}
router.openapiRoutes([
  testRoute, segmentRoute, reindexRoute,
  listWordsRoute, createWordRoute, batchUpdateWordsRoute, batchDeleteWordsRoute, updateWordRoute, deleteWordRoute,
  hotKeywordsRoute, createHotwordRoute, updateHotwordRoute, deleteHotwordRoute, clearHotRoute,
  hotwordGroupsRoute, createHotwordGroupRoute, updateHotwordGroupRoute, deleteHotwordGroupRoute,
] as const);

export default router;
