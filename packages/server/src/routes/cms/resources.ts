import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import {
  createCmsResourceFolderSchema, cropCmsResourceSchema, moveCmsResourcesSchema,
  updateCmsResourceFolderSchema, updateCmsResourceSchema,
} from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import {
  ErrorResponse, jsonContent, PaginationQuery, IdParam, validationHook, commonErrorResponses,
  ok, okPaginated, okMsg, okBody, BatchIdsBody,
} from '../../lib/openapi-schemas';
import { AsyncTaskDTO, CmsResourceDTO, CmsResourceFolderDTO, CmsResourceReferenceDTO } from '../../lib/openapi-dtos';
import {
  listCmsResources, uploadCmsResource, updateCmsResource, deleteCmsResources,
  listCmsResourceReferences, cropCmsResource,
} from '../../services/cms/cms-resources.service';
import {
  createCmsResourceFolder, deleteCmsResourceFolder, listCmsResourceFolderTree, updateCmsResourceFolder,
} from '../../services/cms/cms-resource-folders.service';
import { mapAsyncTask } from '../../lib/task-center';
import { submitCmsResourceTask } from '../../services/cms/cms-resource-task-submit.service';

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
        folderId: z.coerce.number().int().min(0).optional(),
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
      query: z.object({
        siteId: z.coerce.number().int().positive(),
        folderId: z.coerce.number().int().positive().optional(),
      }),
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
    const { siteId, folderId } = c.req.valid('query');
    const body = await c.req.parseBody();
    const file = body.file;
    if (!file || typeof (file as File).arrayBuffer !== 'function') {
      throw new HTTPException(400, { message: '请选择要上传的文件' });
    }
    return c.json(okBody(await uploadCmsResource(file as File, siteId, folderId), '上传成功'), 200);
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

const folderTreeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/folders',
    tags: ['CMS-素材中心'], summary: '素材文件夹树',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:resource:list' })] as const,
    request: { query: z.object({ siteId: z.coerce.number().int().positive() }) },
    responses: { ...commonErrorResponses, ...ok(z.array(CmsResourceFolderDTO), '文件夹树') },
  }),
  handler: async (c) => c.json(okBody(await listCmsResourceFolderTree(c.req.valid('query').siteId)), 200),
});

const createFolderRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/folders',
    tags: ['CMS-素材中心'], summary: '创建素材文件夹',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:resource:update', audit: { description: '创建 CMS 素材文件夹', module: 'CMS内容管理' } })] as const,
    request: { body: { content: jsonContent(createCmsResourceFolderSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsResourceFolderDTO, '创建成功') },
  }),
  handler: async (c) => c.json(okBody(await createCmsResourceFolder(c.req.valid('json')), '创建成功'), 200),
});

const updateFolderRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/folders/{id}',
    tags: ['CMS-素材中心'], summary: '移动或重命名素材文件夹',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:resource:update', audit: { description: '更新 CMS 素材文件夹', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateCmsResourceFolderSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(CmsResourceFolderDTO, '更新成功') },
  }),
  handler: async (c) => c.json(okBody(await updateCmsResourceFolder(c.req.valid('param').id, c.req.valid('json')), '更新成功'), 200),
});

const deleteFolderRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/folders/{id}',
    tags: ['CMS-素材中心'], summary: '删除空素材文件夹',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:resource:delete', audit: { description: '删除 CMS 素材文件夹', module: 'CMS内容管理' } })] as const,
    request: { params: IdParam },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    await deleteCmsResourceFolder(c.req.valid('param').id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const governanceRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/governance',
    tags: ['CMS-素材中心'], summary: '提交孤立素材扫描/清理任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:resource:delete', audit: { description: '提交 CMS 素材治理任务', module: 'CMS内容管理' } })] as const,
    request: {
      body: {
        content: jsonContent(z.object({
          siteId: z.number().int().positive(),
          operation: z.enum(['scan', 'cleanup']),
          dryRun: z.boolean().default(true),
        })),
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '任务已提交') },
  }),
  handler: async (c) => {
    const payload = c.req.valid('json');
    const row = await submitCmsResourceTask(
      payload,
      payload.operation === 'scan' ? 'CMS 孤立素材扫描' : (payload.dryRun ? 'CMS 素材清理预演' : 'CMS 孤立素材清理'),
    );
    return c.json(okBody(mapAsyncTask(row), '任务已提交'), 200);
  },
});

const moveResourcesRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/move',
    tags: ['CMS-素材中心'], summary: '提交批量移动素材任务',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'cms:resource:update', audit: { description: '批量移动 CMS 素材', module: 'CMS内容管理' } })] as const,
    request: {
      body: {
        content: jsonContent(moveCmsResourcesSchema.extend({ siteId: z.number().int().positive() })),
        required: true,
      },
    },
    responses: { ...commonErrorResponses, ...ok(AsyncTaskDTO, '任务已提交') },
  }),
  handler: async (c) => {
    const body = c.req.valid('json');
    const row = await submitCmsResourceTask({
      operation: 'move',
      siteId: body.siteId,
      resourceIds: body.ids,
      folderId: body.folderId,
    }, 'CMS 素材批量移动');
    return c.json(okBody(mapAsyncTask(row), '移动任务已提交'), 200);
  },
});

router.openapiRoutes([
  listRoute, folderTreeRoute, createFolderRoute, updateFolderRoute, deleteFolderRoute,
  uploadRoute, updateRoute, referencesRoute, cropRoute, deleteRoute, governanceRoute, moveResourcesRoute,
] as const);

export default router;
