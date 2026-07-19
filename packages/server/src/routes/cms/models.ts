import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsModelSchema, updateCmsModelSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { CmsModelDTO } from '../../lib/openapi-dtos';
import {
  listCmsModels, listAllCmsModels, getCmsModel, createCmsModel, updateCmsModel, deleteCmsModel,
} from '../../services/cms/cms-models.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-内容模型'], summary: '模型分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:model:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsModelDTO, '模型列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsModels(c.req.valid('query'))), 200),
});

const allRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/all',
    tags: ['CMS-内容模型'], summary: '全部启用模型（栏目绑定下拉）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(CmsModelDTO), '模型列表') },
  }),
  handler: async (c) => c.json(okBody(await listAllCmsModels()), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['CMS-内容模型'], summary: '模型详情（含字段）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:model:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsModelDTO, '模型详情'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getCmsModel(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-内容模型'], summary: '创建模型',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:model:create', audit: { description: '创建 CMS 内容模型', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsModelSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsModelDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsModel(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-内容模型'], summary: '更新模型（fields 提供时整组替换）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:model:update', audit: { description: '更新 CMS 内容模型', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsModelSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsModelDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsModel(id));
    return c.json(okBody(await updateCmsModel(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-内容模型'], summary: '删除模型',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:model:delete', audit: { description: '删除 CMS 内容模型', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsModel(id));
    await deleteCmsModel(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, allRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
