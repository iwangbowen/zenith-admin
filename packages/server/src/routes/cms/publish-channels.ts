import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createCmsPublishChannelSchema, updateCmsPublishChannelSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, validationHook, commonErrorResponses,
  ok, okMsg, IdParam, okBody,
} from '../../lib/openapi-schemas';
import { CmsPublishChannelDTO } from '../../lib/openapi-dtos';
import {
  listCmsPublishChannels, createCmsPublishChannel, updateCmsPublishChannel, deleteCmsPublishChannel,
  ensureCmsPublishChannelExists, mapCmsPublishChannel,
} from '../../services/cms/cms-publish-channels.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-发布通道'], summary: '站点发布通道列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:publish-channel:list' })] as const,
    request: { query: z.object({ siteId: z.coerce.number().int().positive() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsPublishChannelDTO), '通道列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsPublishChannels(c.req.valid('query').siteId)), 200),
});

const createRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/',
    tags: ['CMS-发布通道'], summary: '创建发布通道',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:publish-channel:create', audit: { description: '创建 CMS 发布通道', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsPublishChannelSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsPublishChannelDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsPublishChannel(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-发布通道'], summary: '更新发布通道',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:publish-channel:update', audit: { description: '更新 CMS 发布通道', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsPublishChannelSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsPublishChannelDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsPublishChannel(await ensureCmsPublishChannelExists(id)));
    return c.json(okBody(await updateCmsPublishChannel(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}',
    tags: ['CMS-发布通道'], summary: '删除发布通道',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:publish-channel:delete', audit: { description: '删除 CMS 发布通道', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapCmsPublishChannel(await ensureCmsPublishChannelExists(id)));
    await deleteCmsPublishChannel(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
