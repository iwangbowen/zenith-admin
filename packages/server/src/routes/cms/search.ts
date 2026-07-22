import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import {
  batchUpdateCmsSearchWordsSchema, createCmsHotwordGroupSchema, createCmsHotwordSchema,
  createCmsSearchWordSchema, updateCmsHotwordGroupSchema, updateCmsHotwordSchema, updateCmsSearchWordSchema,
} from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { commonErrorResponses, jsonContent, ok, okBody, okPaginated, okMsg, IdParam, ErrorResponse, PaginationQuery, validationHook } from '../../lib/openapi-schemas';
import { AsyncTaskDTO, CmsSearchResultDTO, CmsSearchWordDTO, CmsHotKeywordDTO, CmsHotwordGroupDTO } from '../../lib/openapi-dtos';
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
    request: { query: z.object({ siteId: z.coerce.number().int().positive(), text: z.string().min(1).max(200) }) },
    responses: { ...commonErrorResponses, ...ok(z.object({ tokens: z.array(z.string()) }), '分词结果') },
  }),
  handler: async (c) => {
    const { siteId, text } = c.req.valid('query');
    await assertSiteAccess(siteId);
    await reloadCmsSearchDict(siteId);
    return c.json(okBody({ tokens: segmentForQuery(text, siteId) }), 200);
  },
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
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        keyword: z.string().optional(),
        type: z.enum(['extension', 'stop']).optional(),
        groupName: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
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
    tags: ['CMS-全文检索'], summary: '删除词条（即时重建当前站点词典）',
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

const batchUpdateWordsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/words/batch',
    tags: ['CMS-全文检索'], summary: '批量更新词典分组/状态',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: '批量更新 CMS 检索词典', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(batchUpdateCmsSearchWordsSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('更新成功') },
  }),
  handler: async (c) => {
    const count = await batchUpdateCmsSearchWords(c.req.valid('json'));
    return c.json(okBody(null, `已更新 ${count} 个词条`), 200);
  },
});

const batchDeleteWordsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/words/batch',
    tags: ['CMS-全文检索'], summary: '批量删除词典',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage', audit: { description: '批量删除 CMS 检索词典', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) })), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const count = await batchDeleteCmsSearchWords(c.req.valid('json').ids);
    return c.json(okBody(null, `已删除 ${count} 个词条`), 200);
  },
});

const hotKeywordsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/hot-keywords',
    tags: ['CMS-全文检索'], summary: '搜索热词榜',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage' })] as const,
    request: {
      query: z.object({
        siteId: z.coerce.number().int().positive(),
        groupId: z.coerce.number().int().positive().optional(),
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional().default(100),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsHotKeywordDTO), '热词榜') },
  }),
  handler: async (c) => {
    return c.json(okBody(await listCmsHotwords(c.req.valid('query'))), 200);
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

const hotwordGroupsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/hotword-groups',
    tags: ['CMS-全文检索'], summary: '热词分组列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage' })] as const,
    request: { query: z.object({ siteId: z.coerce.number().int().positive() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsHotwordGroupDTO), '分组列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsHotwordGroups(c.req.valid('query').siteId)), 200),
});

const createHotwordGroupRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/hotword-groups',
    tags: ['CMS-全文检索'], summary: '创建热词分组',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage' })] as const,
    request: { body: { content: jsonContent(createCmsHotwordGroupSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsHotwordGroupDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsHotwordGroup(c.req.valid('json')), '创建成功'), 200),
});

const updateHotwordGroupRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/hotword-groups/{id}',
    tags: ['CMS-全文检索'], summary: '更新热词分组',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage' })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsHotwordGroupSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsHotwordGroupDTO, '更新成功') },
  }),
  handler: async (c) => c.json(okBody(await updateCmsHotwordGroup(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteHotwordGroupRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/hotword-groups/{id}',
    tags: ['CMS-全文检索'], summary: '删除空热词分组',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    await deleteCmsHotwordGroup(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const createHotwordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/hot-keywords',
    tags: ['CMS-全文检索'], summary: '创建可管理热词',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage' })] as const,
    request: { body: { content: jsonContent(createCmsHotwordSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('创建成功') },
  }),
  handler: async (c) => {
    await createCmsHotword(c.req.valid('json'));
    return c.json(okBody(null, '创建成功'), 200);
  },
});

const updateHotwordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/hot-keywords/{id}',
    tags: ['CMS-全文检索'], summary: '更新可管理热词',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage' })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsHotwordSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('更新成功') },
  }),
  handler: async (c) => {
    await updateCmsHotword(c.req.valid('param').id, c.req.valid('json'));
    return c.json(okBody(null, '更新成功'), 200);
  },
});

const deleteHotwordRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/hot-keywords/{id}',
    tags: ['CMS-全文检索'], summary: '删除可管理热词',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:search:manage' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    await deleteCmsHotword(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

p3Router.openapiRoutes([
  listWordsRoute, createWordRoute, batchUpdateWordsRoute, batchDeleteWordsRoute, updateWordRoute, deleteWordRoute,
  hotKeywordsRoute, createHotwordRoute, updateHotwordRoute, deleteHotwordRoute, clearHotRoute,
  hotwordGroupsRoute, createHotwordGroupRoute, updateHotwordGroupRoute, deleteHotwordGroupRoute,
] as const);
router.route('/', p3Router);
