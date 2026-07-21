import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { createCmsSearchWordSchema, updateCmsSearchWordSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { commonErrorResponses, jsonContent, ok, okBody, okPaginated, okMsg, IdParam, ErrorResponse, PaginationQuery, validationHook } from '../../lib/openapi-schemas';
import { AsyncTaskDTO, CmsSearchResultDTO, CmsSearchWordDTO, CmsHotKeywordDTO } from '../../lib/openapi-dtos';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { searchCmsContents, segmentForQuery, getHotKeywords, clearHotKeywords } from '../../services/cms/cms-search.service';
import {
  listCmsSearchWords, createCmsSearchWord, updateCmsSearchWord, deleteCmsSearchWord,
  ensureCmsSearchWordExists, mapCmsSearchWord,
} from '../../services/cms/cms-search-words.service';
import { assertSiteAccess, ensureCmsSiteExists } from '../../services/cms/cms-sites.service';
import { isCmsPlatformAdmin } from '../../services/cms/cms-access';
import { assertAllCmsSiteChannelsAccess } from '../../services/cms/cms-channels.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const testRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/test',
    tags: ['CMS-全文检索'], summary: '检索测试（后台联调）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage' })] as const,
    request: {
      query: z.object({
        siteId: z.coerce.number().int().positive(),
        keyword: z.string().min(1),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(50).optional().default(10),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsSearchResultDTO, '检索结果') },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    const { tokens: _tokens, ...result } = await searchCmsContents(q);
    return c.json(okBody(result), 200);
  },
});

const segmentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/segment',
    tags: ['CMS-全文检索'], summary: '分词预览（调试分词效果）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage' })] as const,
    request: { query: z.object({ text: z.string().min(1).max(200) }) },
    responses: { ...commonErrorResponses, ...ok(z.object({ tokens: z.array(z.string()) }), '分词结果') },
  }),
  handler: (c) => c.json(okBody({ tokens: segmentForQuery(c.req.valid('query').text) }), 200),
});

const reindexRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/reindex',
    tags: ['CMS-全文检索'], summary: '提交索引重建任务（任务中心执行）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: 'CMS 检索索引重建', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(z.object({ siteId: z.number().int().positive().nullable().optional() })), required: true } },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '任务已提交') },
  }),
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

router.openapiRoutes([testRoute, segmentRoute, reindexRoute] as const);

export default router;

// ═══ P3：自定义词典 + 搜索热词 ═════════════════════════════════════════════════
const p3Router = new OpenAPIHono({ defaultHook: validationHook });

const listWordsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/words',
    tags: ['CMS-全文检索'], summary: '自定义词典分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(CmsSearchWordDTO, '词典列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsSearchWords(c.req.valid('query'))), 200),
});

const createWordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/words',
    tags: ['CMS-全文检索'], summary: '新增词条（即时生效，历史内容需重建索引）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: '新增 CMS 检索词条', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsSearchWordSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsSearchWordDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsSearchWord(c.req.valid('json')), '创建成功'), 200),
});

const updateWordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/words/{id}',
    tags: ['CMS-全文检索'], summary: '更新词条',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: '更新 CMS 检索词条', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsSearchWordSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsSearchWordDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSearchWord(await ensureCmsSearchWordExists(id)));
    return c.json(okBody(await updateCmsSearchWord(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteWordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/words/{id}',
    tags: ['CMS-全文检索'], summary: '删除词条（重启后完全失效）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: '删除 CMS 检索词条', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsSearchWord(await ensureCmsSearchWordExists(id)));
    await deleteCmsSearchWord(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const hotKeywordsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/hot-keywords',
    tags: ['CMS-全文检索'], summary: '搜索热词榜',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage' })] as const,
    request: { query: z.object({ siteId: z.coerce.number().int().positive(), limit: z.coerce.number().int().min(1).max(100).optional().default(20) }) },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsHotKeywordDTO), '热词榜') },
  }),
  handler: async (c) => {
    const { siteId, limit } = c.req.valid('query');
    return c.json(okBody(await getHotKeywords(siteId, limit)), 200);
  },
});

const clearHotRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/hot-keywords/clear',
    tags: ['CMS-全文检索'], summary: '清空搜索热词榜',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: '清空 CMS 搜索热词', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(z.object({ siteId: z.number().int().positive() })), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已清空') },
  }),
  handler: async (c) => {
    await clearHotKeywords(c.req.valid('json').siteId);
    return c.json(okBody(null, '已清空'), 200);
  },
});

p3Router.openapiRoutes([listWordsRoute, createWordRoute, updateWordRoute, deleteWordRoute, hotKeywordsRoute, clearHotRoute] as const);
router.route('/', p3Router);
