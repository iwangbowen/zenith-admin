import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { updateCmsResourceSchema, cropCmsResourceSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, IdParam, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, okBody, BatchIdsBody,
} from '../../lib/openapi-schemas';
import { CmsResourceDTO, CmsResourceReferenceDTO } from '../../lib/openapi-dtos';
import {
  listCmsResources, uploadCmsResource, updateCmsResource, deleteCmsResources,
  listCmsResourceReferences, cropCmsResource,
} from '../../services/cms/cms-resources.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/',
    tags: ['CMS-素材中心'], summary: '素材分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:resource:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        siteId: z.coerce.number().int().positive(),
        type: z.enum(['image', 'video', 'audio', 'document', 'other']).optional(),
        keyword: z.string().max(100).optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(CmsResourceDTO, '素材列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsResources(c.req.valid('query'))), 200),
});

const uploadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/upload',
    tags: ['CMS-素材中心'], summary: '上传素材（图片按站点配置压缩/水印/缩略图）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:resource:upload', audit: { description: 'CMS 上传素材', module: 'CMS内容管理', recordBody: false } })] as const,
    request: {
      query: z.object({ siteId: z.coerce.number().int().positive() }),
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              file: z.any().openapi({ type: 'string', format: 'binary' }),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(CmsResourceDTO, '上传成功'),
      400: { content: jsonContent(ErrorResponse), description: '未选择文件或无可用存储' },
    },
  }),
  handler: async (c) => {
    const { siteId } = c.req.valid('query');
    const body = await c.req.parseBody();
    const file = body.file;
    if (!file || typeof (file as File).arrayBuffer !== 'function') {
      throw new HTTPException(400, { message: '请选择要上传的文件' });
    }
    return c.json(okBody(await uploadCmsResource(file as File, siteId), '上传成功'), 200);
  },
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}',
    tags: ['CMS-素材中心'], summary: '编辑素材（重命名/备注）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:resource:update', audit: { description: 'CMS 编辑素材', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsResourceSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsResourceDTO, '已保存') },
  }),
  handler: async (c) => c.json(okBody(await updateCmsResource(c.req.valid('param').id, c.req.valid('json')), '已保存'), 200),
});

const referencesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/references',
    tags: ['CMS-素材中心'], summary: '素材站内引用（内容/广告/碎片）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:resource:list' })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsResourceReferenceDTO), '引用列表') },
  }),
  handler: async (c) => c.json(okBody(await listCmsResourceReferences(c.req.valid('param').id)), 200),
});

const cropRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/crop',
    tags: ['CMS-素材中心'], summary: '裁剪图片（非破坏，另存为新素材）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:resource:update', audit: { description: 'CMS 裁剪素材', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(cropCmsResourceSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsResourceDTO, '裁剪成功') },
  }),
  handler: async (c) => c.json(okBody(await cropCmsResource(c.req.valid('param').id, c.req.valid('json')), '裁剪成功，已另存为新素材'), 200),
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/delete',
    tags: ['CMS-素材中心'], summary: '批量删除素材（存在站内引用则拒绝）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:resource:delete', audit: { description: 'CMS 删除素材', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await deleteCmsResources(ids);
    return c.json(okBody(null, `已删除 ${count} 个素材`), 200);
  },
});

router.openapiRoutes([listRoute, uploadRoute, updateRoute, referencesRoute, cropRoute, deleteRoute] as const);

export default router;
