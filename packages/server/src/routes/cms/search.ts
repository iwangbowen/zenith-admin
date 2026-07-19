import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { commonErrorResponses, jsonContent, ok, okBody, okPaginated, validationHook } from '../../lib/openapi-schemas';
import { AsyncTaskDTO, CmsSearchResultDTO } from '../../lib/openapi-dtos';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { searchCmsContents, segmentForQuery } from '../../services/cms/cms-search.service';
import { ensureCmsSiteExists } from '../../services/cms/cms-sites.service';

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
      title = `CMS 检索索引重建（${site.name}）`;
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
