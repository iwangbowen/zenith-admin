import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { cmsSearchContract } from '@zenith/shared/cms';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { enqueueAsyncTask, mapAsyncTask, persistAsyncTask } from '../../lib/task-center';
import { db } from '../../db';
import { cmsSites, cmsSiteGenerations } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { captureCmsConfiguration, type CmsCapturedConfiguration } from '../../services/cms/cms-configuration-snapshot.service';
import { searchCmsContents, segmentForQuery, reloadCmsSearchDict, clearHotKeywords } from '../../services/cms/cms-search.service';
import {
  listCmsSearchWords, createCmsSearchWord, updateCmsSearchWord, deleteCmsSearchWord,
  ensureCmsSearchWordExists, mapCmsSearchWord, batchDeleteCmsSearchWords, batchUpdateCmsSearchWords,
} from '../../services/cms/cms-search-words.service';
import { assertSiteAccess, ensureCmsSiteExists } from '../../services/cms/cms-sites.service';
import { isCmsPlatformAdmin } from '../../services/cms/cms-access';
import { assertAllCmsSiteChannelsAccess } from '../../services/cms/cms-channels.service';
import { withCmsPublicGeneration } from '../../services/cms/cms-generation-storage.service';
import {
  createCmsHotword, createCmsHotwordGroup, deleteCmsHotword, deleteCmsHotwordGroup,
  listCmsHotwordGroups, listCmsHotwords, updateCmsHotword, updateCmsHotwordGroup,
} from '../../services/cms/cms-hotwords.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const testRoute = defineContractRoute(cmsSearchContract.test, {
  handler: async (c) => {
    const q = c.req.valid('query');
    const { tokens: _tokens, ...result } = await withCmsPublicGeneration(q.siteId, () => searchCmsContents(q));
    return c.json(okBody(result), 200);
  },
});

const segmentRoute = defineContractRoute(cmsSearchContract.segment, {
  handler: async (c) => {
    const { siteId, text } = c.req.valid('query');
    await assertSiteAccess(siteId);
    await reloadCmsSearchDict(siteId);
    return c.json(okBody({ tokens: segmentForQuery(text, siteId) }), 200);
  },
});

const reindexRoute = defineContractRoute(cmsSearchContract.reindex, {
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
    const row = await db.transaction(async (tx) => {
      const sites = siteId ? [{ id: siteId }] : await tx.select({ id: cmsSites.id }).from(cmsSites);
      const captures: Record<string, CmsCapturedConfiguration> = {};
      for (const site of sites) {
        const frozen = await captureCmsConfiguration(tx, site.id, { configurationTables: ['cms_search_words'] });
        const [generation] = await tx.select().from(cmsSiteGenerations).where(eq(cmsSiteGenerations.siteId, site.id)).limit(1);
        captures[String(site.id)] = { ...frozen, baseGenerationId: generation?.activeGenerationId ?? null };
      }
      return persistAsyncTask(tx, { taskType: 'cms-search-reindex', title, tenantId: null, payload: { siteId: siteId ?? null, configurationCaptures: captures } });
    });
    await enqueueAsyncTask(row.id).catch(() => undefined);
    return c.json(okBody(mapAsyncTask(row), '任务已提交，可在任务中心查看进度'), 200);
  },
});

// ═══ 自定义词典 + 搜索热词 ═══════════════════════════════════════════════════

const listWordsRoute = defineContractRoute(cmsSearchContract.wordList, {
  handler: async (c) => c.json(okBody(await listCmsSearchWords(c.req.valid('query'))), 200),
});

const createWordRoute = defineContractRoute(cmsSearchContract.wordCreate, {
  handler: async (c) => c.json(okBody(await createCmsSearchWord(c.req.valid('json')), '创建成功'), 200),
});

const updateWordRoute = defineContractRoute(cmsSearchContract.wordUpdate, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSearchWord(await ensureCmsSearchWordExists(id)));
    return c.json(okBody(await updateCmsSearchWord(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteWordRoute = defineContractRoute(cmsSearchContract.wordRemove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSearchWord(await ensureCmsSearchWordExists(id)));
    await deleteCmsSearchWord(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchUpdateWordsRoute = defineContractRoute(cmsSearchContract.wordBatchUpdate, {
  handler: async (c) => {
    const count = await batchUpdateCmsSearchWords(c.req.valid('json'));
    return c.json(okBody(null, `已更新 ${count} 个词条`), 200);
  },
});

const batchDeleteWordsRoute = defineContractRoute(cmsSearchContract.wordBatchRemove, {
  handler: async (c) => {
    const count = await batchDeleteCmsSearchWords(c.req.valid('json').ids);
    return c.json(okBody(null, `已删除 ${count} 个词条`), 200);
  },
});

const hotKeywordsRoute = defineContractRoute(cmsSearchContract.hotKeywords, {
  handler: async (c) => c.json(okBody(await listCmsHotwords(c.req.valid('query'))), 200),
});

const clearHotRoute = defineContractRoute(cmsSearchContract.clearHotKeywords, {
  handler: async (c) => {
    await clearHotKeywords(c.req.valid('json').siteId);
    return c.json(okBody(null, '已清空'), 200);
  },
});

const hotwordGroupsRoute = defineContractRoute(cmsSearchContract.hotwordGroups, {
  handler: async (c) => c.json(okBody(await listCmsHotwordGroups(c.req.valid('query').siteId)), 200),
});

const createHotwordGroupRoute = defineContractRoute(cmsSearchContract.hotwordGroupCreate, {
  handler: async (c) => c.json(okBody(await createCmsHotwordGroup(c.req.valid('json')), '创建成功'), 200),
});

const updateHotwordGroupRoute = defineContractRoute(cmsSearchContract.hotwordGroupUpdate, {
  handler: async (c) => c.json(okBody(await updateCmsHotwordGroup(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteHotwordGroupRoute = defineContractRoute(cmsSearchContract.hotwordGroupRemove, {
  handler: async (c) => {
    await deleteCmsHotwordGroup(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const createHotwordRoute = defineContractRoute(cmsSearchContract.hotwordCreate, {
  handler: async (c) => {
    await createCmsHotword(c.req.valid('json'));
    return c.json(okBody(null, '创建成功'), 200);
  },
});

const updateHotwordRoute = defineContractRoute(cmsSearchContract.hotwordUpdate, {
  handler: async (c) => {
    await updateCmsHotword(c.req.valid('param').id, c.req.valid('json'));
    return c.json(okBody(null, '更新成功'), 200);
  },
});

const deleteHotwordRoute = defineContractRoute(cmsSearchContract.hotwordRemove, {
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
