import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody, BatchIdsBody } from '../lib/openapi-schemas';
import { ManagedFileDTO, StorageBrowseResultDTO, FileStatsDTO, SheetPreviewDTO } from '../lib/openapi-dtos';
import {
  readFileContent, listManagedFiles, getManagedFile, uploadManagedFileFromBody, deleteManagedFile, batchDeleteFiles, getManagedFileBeforeAudit, batchDownloadFilesAsZip, browseStorageFiles, getFileStats, getSheetPreview,
} from '../services/files.service';

const filesRouter = new OpenAPIHono({ defaultHook: validationHook });

/**
 * 可安全内联渲染的 MIME 类型白名单。
 * SVG、HTML、XML、JS 等类型可能内嵌脚本，必须以 attachment 下载，防止 Stored XSS。
 */
const SAFE_INLINE_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'image/bmp', 'image/ico', 'image/x-icon',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
  'application/pdf',
]);

function resolveContentDisposition(mimeType: string, fileName: string): string {
  const normalizedMime = mimeType.split(';')[0].trim().toLowerCase();
  const disposition = SAFE_INLINE_MIME_TYPES.has(normalizedMime) ? 'inline' : 'attachment';
  return `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

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
    return new Response(storedFile.stream, {
      headers: {
        'Content-Type': storedFile.contentType,
        'Content-Disposition': resolveContentDisposition(storedFile.contentType, storedFile.fileName),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
});

const browseRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/browse', tags: ['Files'], summary: '按存储配置浏览文件目录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:list' })] as const,
    request: {
      query: z.object({
        storageConfigId: z.coerce.number().int().positive(),
        path: z.string().optional(),
      }),
    },
    responses: { ...commonErrorResponses, ...ok(StorageBrowseResultDTO, '浏览结果') },
  }),
  handler: async (c) => c.json(okBody(await browseStorageFiles(c.req.valid('query'))), 200),
});

const getOneRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['Files'], summary: '获取文件详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(ManagedFileDTO, '文件详情'),
      404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getManagedFile(c.req.valid('param').id)), 200),
});

const sheetPreviewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/sheet-preview', tags: ['Files'], summary: '获取 Excel 表格预览数据',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(SheetPreviewDTO, 'Excel 预览数据'),
      400: { content: jsonContent(ErrorResponse), description: '非表格文件或解析失败' },
      404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getSheetPreview(c.req.valid('param').id)), 200),
});

const statsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/stats', tags: ['Files'], summary: '文件统计分析',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:file:list' })] as const,
    responses: { ...commonErrorResponses, ...ok(FileStatsDTO, '统计结果') },
  }),
  handler: async (c) => c.json(okBody(await getFileStats()), 200),
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

filesRouter.openapiRoutes([contentRoute, sheetPreviewRoute, statsRoute, listRoute, browseRoute, getOneRoute, uploadRoute, uploadOneRoute, batchDeleteRoute, deleteRoute] as const);

// 非 OpenAPI 路由：批量下载打包为 zip 流式响应
filesRouter.post('/batch-download', authMiddleware, guard({ permission: 'system:file:list' }), async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => ({ ids: [] }));
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  const { stream, filename } = await batchDownloadFilesAsZip(ids);
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
});

export default filesRouter;
