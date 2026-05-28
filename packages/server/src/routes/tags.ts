import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  PaginationQuery,
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okPaginated,
  okMsg,
  IdParam,
  okBody,
  BatchIdsBody,
} from '../lib/openapi-schemas';
import { createTagSchema, updateTagSchema } from '@zenith/shared';
import { TagDTO } from '../lib/openapi-dtos';
import {
  listTags,
  createTag,
  updateTag,
  deleteTag,
  batchDeleteTags,
  listTagGroups,
  ensureTagExists,
  getTag,
} from '../services/tags.service';

const tagsRouter = new OpenAPIHono({ defaultHook: validationHook });

// ─── 标签列表 ────────────────────────────────────────────────────────────────
const listTagsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Tags'], summary: '标签列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:tag:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword:   z.string().optional(),
        status:    z.enum(['enabled', 'disabled']).optional(),
        groupName: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(TagDTO, '标签列表') },
  }),
  handler: async (c) => c.json(okBody(await listTags(c.req.valid('query'))), 200),
});

// ─── 获取所有分组 ─────────────────────────────────────────────────────────────
const listGroupsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/groups', tags: ['Tags'], summary: '获取标签分组列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:tag:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(z.string()), '标签分组列表') },
  }),
  handler: async (c) => c.json(okBody(await listTagGroups()), 200),
});

// ─── 标签详情 ─────────────────────────────────────────────────────────────────
const getOneTagRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['Tags'], summary: '标签详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:tag:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(TagDTO, '标签详情') },
  }),
  handler: async (c) => c.json(okBody(await getTag(c.req.valid('param').id)), 200),
});

// ─── 创建标签 ─────────────────────────────────────────────────────────────────
const createTagRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['Tags'], summary: '创建标签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:tag:create', audit: { description: '创建标签', module: '标签管理' } })] as const,
    request: { body: { content: jsonContent(createTagSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(TagDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createTag(c.req.valid('json')), '创建成功'), 200),
});

// ─── 更新标签 ─────────────────────────────────────────────────────────────────
const updateTagRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['Tags'], summary: '更新标签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:tag:update', audit: { description: '更新标签', module: '标签管理' } })] as const,
    request: {
      params: IdParam,
      body: { content: jsonContent(updateTagSchema), required: true },
    },
    responses: { ...commonErrorResponses, ...ok(TagDTO, '更新成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureTagExists(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(await updateTag(id, c.req.valid('json')), '更新成功'), 200);
  },
});

// ─── 删除标签 ─────────────────────────────────────────────────────────────────
const deleteTagRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['Tags'], summary: '删除标签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:tag:delete', audit: { description: '删除标签', module: '标签管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureTagExists(id);
    setAuditBeforeData(c, before);
    await deleteTag(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 批量删除 ─────────────────────────────────────────────────────────────────
const batchDeleteTagsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch', tags: ['Tags'], summary: '批量删除标签',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:tag:delete', audit: { description: '批量删除标签', module: '标签管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('批量删除成功') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    await batchDeleteTags(ids);
    return c.json(okBody(null, '批量删除成功'), 200);
  },
});

tagsRouter.openapiRoutes([
  listTagsRoute,
  listGroupsRoute,
  getOneTagRoute,
  createTagRoute,
  updateTagRoute,
  batchDeleteTagsRoute,
  deleteTagRoute,
] as const);

export default tagsRouter;
