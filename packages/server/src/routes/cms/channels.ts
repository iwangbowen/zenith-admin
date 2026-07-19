import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsChannelSchema, updateCmsChannelSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, validationHook, commonErrorResponses,
  ok, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { CmsChannelDTO } from '../../lib/openapi-dtos';
import {
  listCmsChannelTree, getCmsChannel, createCmsChannel, updateCmsChannel, deleteCmsChannel,
} from '../../services/cms/cms-channels.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const treeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/tree',
    tags: ['CMS-栏目管理'], summary: '站点栏目树',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:list' })] as const,
    request: {
      query: z.object({
        siteId: z.coerce.number().int().positive(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsChannelDTO), '栏目树') },
  }),
  handler: async (c) => c.json(okBody(await listCmsChannelTree(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}',
    tags: ['CMS-栏目管理'], summary: '栏目详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsChannelDTO, '栏目详情'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getCmsChannel(c.req.valid('param').id)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-栏目管理'], summary: '创建栏目',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:create', audit: { description: '创建 CMS 栏目', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsChannelSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsChannelDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsChannel(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-栏目管理'], summary: '更新栏目',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:update', audit: { description: '更新 CMS 栏目', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsChannelSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsChannelDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsChannel(id));
    return c.json(okBody(await updateCmsChannel(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-栏目管理'], summary: '删除栏目',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:channel:delete', audit: { description: '删除 CMS 栏目', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsChannel(id));
    await deleteCmsChannel(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([treeRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
