import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, okExcel, excelBody, BatchIdsBody } from '../lib/openapi-schemas';
import { ManagedFileDTO } from '../lib/openapi-dtos';
import {
  readFileContent, listManagedFiles, uploadManagedFileFromBody, deleteManagedFile, batchDeleteFiles, exportManagedFiles, getManagedFileBeforeAudit,
} from '../services/files.service';

const filesRouter = new OpenAPIHono({ defaultHook: validationHook });

const contentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/content', tags: ['Files'], summary: '公开访问文件内容',
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      200: { content: { 'application/octet-stream': { schema: z.string() } }, description: '文件内容' },
      404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const storedFile = await readFileContent(id);
    return new Response(new Uint8Array(storedFile.buffer), {
      headers: {
        'Content-Type': storedFile.contentType,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(storedFile.fileName)}`,
      },
    }) as never;
  },
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['Files'], summary: '文件分页列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        provider: z.enum(['local', 'oss', 's3', 'cos']).optional(),
        fileType: z.enum(['image', 'video', 'audio', 'document']).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...okPaginated(ManagedFileDTO, '文件列表') },
  }),
  handler: async (c) => c.json(okBody(await listManagedFiles(c.req.valid('query'))), 200),
});

const uploadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/upload', tags: ['Files'], summary: '上传文件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:upload', audit: { description: '上传文件', module: '文件管理', recordBody: false } })] as const,
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              file: z.any().openapi({ type: 'array', items: { type: 'string', format: 'binary' } }),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(ManagedFileDTO), '上传成功'),
      400: { content: jsonContent(ErrorResponse), description: '未选择文件或无可用存储' },
    },
  }),
  handler: async (c) => {
    const body = await c.req.parseBody({ all: true });
    const fileValues = Array.isArray(body.file) ? body.file : [body.file];
    const results = await Promise.all(fileValues.map((f) => uploadManagedFileFromBody(f)));
    return c.json(okBody(results, `成功上传 ${results.length} 个文件`), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['Files'], summary: '删除文件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:delete', audit: { description: '删除文件', module: '文件管理', recordBody: false } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getManagedFileBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteManagedFile(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batch', tags: ['Files'], summary: '批量删除文件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:delete', audit: { description: '批量删除文件', module: '文件管理', recordBody: false } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await batchDeleteFiles(ids);
    return c.json(okBody(null, `已删除 ${count} 个文件`), 200);
  },
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/export', tags: ['Files'], summary: '导出文件列表 Excel',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:list' })] as const,
    responses: { ...commonErrorResponses, ...okExcel('Excel 文件') },
  }),
  handler: async (c) => {
    const { buffer, filename } = await exportManagedFiles();
    return excelBody(c, buffer, filename);
  },
});

const uploadOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/upload-one', tags: ['Files'], summary: '上传单个文件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
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
      ...ok(ManagedFileDTO, '上传成功'),
      400: { content: jsonContent(ErrorResponse), description: '未选择文件或无可用存储' },
    },
  }),
  handler: async (c) => {
    const body = await c.req.parseBody();
    const result = await uploadManagedFileFromBody(body.file);
    return c.json(okBody(result, '上传成功'), 200);
  },
});

filesRouter.openapiRoutes([contentRoute, listRoute, uploadRoute, uploadOneRoute, deleteRoute, batchDeleteRoute, exportRoute] as const);

export default filesRouter;
