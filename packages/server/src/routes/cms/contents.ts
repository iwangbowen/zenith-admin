import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsContentSchema, updateCmsContentSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, BatchIdsBody, okBody,
} from '../../lib/openapi-schemas';
import { CmsContentDTO } from '../../lib/openapi-dtos';
import {
  listCmsContents, getCmsContent, createCmsContent, updateCmsContent,
  submitCmsContent, publishCmsContent, rejectCmsContent, offlineCmsContent,
  recycleCmsContents, restoreCmsContents, purgeCmsContents, restoreCmsContentToVersion,
} from '../../services/cms/cms-contents.service';
import { listContentVersions } from '../../services/cms/cms-versions.service';
import { triggerContentStaticRefresh } from '../../services/cms/cms-static.service';
import { triggerAutoPushForContent } from '../../services/cms/cms-push.service';
import { CmsContentVersionDTO } from '../../lib/openapi-dtos';

const router = new OpenAPIHono({ defaultHook: validationHook });

const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true').optional();

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-内容管理'], summary: '内容分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        channelId: z.coerce.number().int().positive().optional(),
        status: z.enum(['draft', 'pending', 'published', 'offline', 'rejected']).optional(),
        keyword: z.string().optional(),
        isTop: boolParam,
        isRecommend: boolParam,
        isHot: boolParam,
        deleted: boolParam,
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsContentDTO, '内容列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsContents(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['CMS-内容管理'], summary: '内容详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsContentDTO, '内容详情'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getCmsContent(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-内容管理'], summary: '创建内容（默认草稿）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:create', audit: { description: '创建 CMS 内容', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsContentSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsContentDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsContent(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-内容管理'], summary: '更新内容',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: '更新 CMS 内容', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsContentSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsContentDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getCmsContent(id);
    setAuditBeforeData(c, { ...before, body: undefined });
    const row = await updateCmsContent(id, c.req.valid('json'));
    if (row.status === 'published') triggerContentStaticRefresh(id);
    return c.json(okBody(row, '更新成功'), 200);
  },
});

// ─── 状态流转 ─────────────────────────────────────────────────────────────────
const submitRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/submit',
    tags: ['CMS-内容管理'], summary: '提交审核',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: '提交 CMS 内容审核', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsContentDTO, '已提交审核') },
  }),
  handler: async (c) => c.json(okBody(await submitCmsContent(c.req.valid('param').id), '已提交审核'), 200),
});

const publishRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/publish',
    tags: ['CMS-内容管理'], summary: '发布（直接发布或审核通过）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:publish', audit: { description: '发布 CMS 内容', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsContentDTO, '发布成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const row = await publishCmsContent(id);
    triggerContentStaticRefresh(id);
    triggerAutoPushForContent(id);
    return c.json(okBody(row, '发布成功'), 200);
  },
});

const rejectRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/reject',
    tags: ['CMS-内容管理'], summary: '驳回',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:audit', audit: { description: '驳回 CMS 内容', module: 'CMS内容管理' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(z.object({ reason: z.string().min(1, '驳回原因不能为空').max(500) })), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(CmsContentDTO, '已驳回') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    return c.json(okBody(await rejectCmsContent(id, reason), '已驳回'), 200);
  },
});

const offlineRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/offline',
    tags: ['CMS-内容管理'], summary: '下线',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:publish', audit: { description: '下线 CMS 内容', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(CmsContentDTO, '已下线') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const row = await offlineCmsContent(id);
    triggerContentStaticRefresh(id);
    return c.json(okBody(row, '已下线'), 200);
  },
});

// ─── 回收站 ───────────────────────────────────────────────────────────────────
const recycleRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/recycle',
    tags: ['CMS-内容管理'], summary: '移入回收站（批量）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:delete', audit: { description: 'CMS 内容移入回收站', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已移入回收站') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await recycleCmsContents(ids);
    for (const id of ids) triggerContentStaticRefresh(id);
    return c.json(okBody(null, `已移入回收站 ${count} 条`), 200);
  },
});

const restoreRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/restore',
    tags: ['CMS-内容管理'], summary: '从回收站恢复（批量，恢复为草稿）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:delete', audit: { description: 'CMS 内容从回收站恢复', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已恢复') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await restoreCmsContents(ids);
    return c.json(okBody(null, `已恢复 ${count} 条`), 200);
  },
});

const purgeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/purge',
    tags: ['CMS-内容管理'], summary: '彻底删除（批量，仅限回收站内容）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:delete', audit: { description: 'CMS 内容彻底删除', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('已删除') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await purgeCmsContents(ids);
    return c.json(okBody(null, `已彻底删除 ${count} 条`), 200);
  },
});

// ─── 版本历史 ─────────────────────────────────────────────────────────────────
const versionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/versions',
    tags: ['CMS-内容管理'], summary: '内容版本历史',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsContentVersionDTO), '版本列表') },
  }),
  handler: async (c) => c.json(okBody(await listContentVersions(c.req.valid('param').id)), 200),
});

const restoreVersionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/versions/{versionId}/restore',
    tags: ['CMS-内容管理'], summary: '回滚到指定版本（回滚前自动留档当前状态）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: 'CMS 内容版本回滚', module: 'CMS内容管理' } })] as const,
    request: {
      params: IdParam.extend({
        versionId: z.coerce.number().int().positive().openapi({ param: { name: 'versionId', in: 'path' } }),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(CmsContentDTO, '回滚成功') },
  }),
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    const before = await getCmsContent(id);
    setAuditBeforeData(c, { ...before, body: undefined });
    const row = await restoreCmsContentToVersion(id, versionId);
    if (row.status === 'published') triggerContentStaticRefresh(id);
    return c.json(okBody(row, '回滚成功'), 200);
  },
});

router.openapiRoutes([
  listRoute, getOneRoute, createRoute_, updateRoute_,
  submitRoute, publishRoute, rejectRoute, offlineRoute,
  recycleRoute, restoreRoute, purgeRoute,
  versionsRoute, restoreVersionRoute,
] as const);

export default router;
