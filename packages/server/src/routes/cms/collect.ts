import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, okBody, PaginationQuery, IdParam,
} from '../../lib/openapi-schemas';
import { CmsCollectRuleDTO, CmsCollectItemDTO, AsyncTaskDTO } from '../../lib/openapi-dtos';
import {
  listCollectRules, createCollectRule, updateCollectRule, deleteCollectRule,
  ensureCollectRuleRunnable, listCollectItems,
} from '../../services/cms/cms-collect.service';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { currentUser } from '../../lib/context';

const router = new OpenAPIHono({ defaultHook: validationHook });

const ruleBody = z.object({
  siteId: z.number().int().positive(),
  channelId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  listUrl: z.string().url().max(500),
  pageStart: z.number().int().min(1).default(1),
  pageEnd: z.number().int().min(1).default(1),
  listSelector: z.string().min(1).max(200),
  titleSelector: z.string().min(1).max(200),
  bodySelector: z.string().min(1).max(200),
  summarySelector: z.string().max(200).nullish(),
  coverSelector: z.string().max(200).nullish(),
  removeSelectors: z.array(z.string().max(200)).max(20).default([]),
  autoPublish: z.boolean().default(false),
  localizeImages: z.boolean().default(false),
  maxItems: z.number().int().min(1).max(200).default(50),
  status: z.enum(['enabled', 'disabled']).default('enabled'),
  remark: z.string().max(200).nullish(),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/rules',
    tags: ['CMS-采集中心'], summary: '采集规则分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:collect:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        keyword: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsCollectRuleDTO, '规则列表') },
  }),
  handler: async (c) => c.json(okBody(await listCollectRules(c.req.valid('query'))), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/rules',
    tags: ['CMS-采集中心'], summary: '创建采集规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:collect:create', audit: { description: '创建 CMS 采集规则', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(ruleBody), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsCollectRuleDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCollectRule(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/rules/{id}',
    tags: ['CMS-采集中心'], summary: '更新采集规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:collect:update', audit: { description: '更新 CMS 采集规则', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(ruleBody.partial()), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsCollectRuleDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateCollectRule(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/rules/{id}',
    tags: ['CMS-采集中心'], summary: '删除采集规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:collect:delete', audit: { description: '删除 CMS 采集规则', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    await deleteCollectRule(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const runRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/rules/{id}/run',
    tags: ['CMS-采集中心'], summary: '执行采集（任务中心异步）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:collect:run', audit: { description: '执行 CMS 采集', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '任务已提交') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const rule = await ensureCollectRuleRunnable(id);
    const user = currentUser();
    const task = await submitAsyncTask({
      taskType: 'cms-collect-run',
      title: `CMS 采集：${rule.name}`,
      payload: { ruleId: rule.id, operatorId: user.userId },
    });
    return c.json(okBody(mapAsyncTask(task), '任务已提交，可在下方查看进度与明细'), 200);
  },
});

const itemsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/rules/{id}/items',
    tags: ['CMS-采集中心'], summary: '采集明细分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:collect:list' })] as const,
    request: {
      params: IdParam,
      query: PaginationQuery.extend({
        status: z.enum(['success', 'skipped', 'failed']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsCollectItemDTO, '采集明细') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listCollectItems({ ...c.req.valid('query'), ruleId: id })), 200);
  },
});

router.openapiRoutes([listRoute, createRouteDef, updateRouteDef, deleteRouteDef, runRoute, itemsRoute] as const);

export default router;
