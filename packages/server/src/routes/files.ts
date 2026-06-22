import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, okBody, errBody } from '../lib/openapi-schemas';
import { ManagedFileDTO, StorageBrowseResultDTO, FileStatsDTO, SheetPreviewDTO, UploadSessionInitDTO, UploadChunkResultDTO, UploadSessionStatusDTO } from '../lib/openapi-dtos';
import { initChunkUploadSchema, completeChunkUploadSchema } from '@zenith/shared';
import {
  getStoredFileForRead, listManagedFiles, getManagedFile, uploadManagedFileFromBody, deleteManagedFile, batchDeleteFiles, getManagedFileBeforeAudit, batchDownloadFilesAsZip, browseStorageFiles, getFileStats, getSheetPreview,
} from '../services/files.service';
import { initChunkUpload, uploadChunk, completeChunkUpload, getUploadStatus, abortChunkUpload } from '../services/upload-sessions.service';
import { readStoredFile } from '../lib/file-storage';

const filesRouter = new OpenAPIHono({ defaultHook: validationHook });

const FileIdParam = z.object({
  id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' }, example: '018f6f8a-5f76-7d8c-9a1b-2c3d4e5f6789' }),
});

const FileBatchIdsBody = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

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

function supportsRange(provider: string): boolean {
  return provider === 'local' || provider === 's3';
}

function parseRangeHeader(rangeHeader: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return 'invalid';
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return 'invalid';

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid';
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

const contentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/content', tags: ['Files'], summary: '公开访问文件内容',
    request: { params: FileIdParam },
    responses: {
      ...commonErrorResponses,
      200: { content: { 'application/octet-stream': { schema: z.string() } }, description: '文件内容' },
      206: { content: { 'application/octet-stream': { schema: z.string() } }, description: '文件内容分片' },
      416: { content: jsonContent(ErrorResponse), description: 'Range 不合法' },
      404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { file, storageConfig } = await getStoredFileForRead(id);
    // 内容按 id 不可变（objectKey 上传时固定），用强 ETag + createdAt 支持条件请求缓存
    const etag = `"f${file.id}-${file.size}"`;
    const lastModifiedMs = Math.floor(file.createdAt.getTime() / 1000) * 1000;
    const cacheHeaders: Record<string, string> = {
      ETag: etag,
      'Last-Modified': new Date(lastModifiedMs).toUTCString(),
      'Cache-Control': 'private, max-age=3600',
      'Accept-Ranges': supportsRange(file.provider) ? 'bytes' : 'none',
    };
    const range = supportsRange(file.provider) ? parseRangeHeader(c.req.header('range'), file.size) : null;
    if (range === 'invalid') {
      return new Response(JSON.stringify(errBody('Range 不合法', 416)), {
        status: 416,
        headers: { 'Content-Type': 'application/json; charset=UTF-8', ...cacheHeaders, 'Content-Range': `bytes */${file.size}` },
      });
    }
    const ifNoneMatch = c.req.header('if-none-match');
    const ifModifiedSince = c.req.header('if-modified-since');
    const notModified = !range && (ifNoneMatch
      ? ifNoneMatch.split(',').some((t) => t.trim() === etag)
      : !!ifModifiedSince && new Date(ifModifiedSince).getTime() >= lastModifiedMs);
    if (notModified) {
      return new Response(null, { status: 304, headers: cacheHeaders });
    }
    const storedFile = await readStoredFile(file, storageConfig, range ?? undefined);
    const partialHeaders: Record<string, string> = range
      ? {
        'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`,
        'Content-Length': String(range.end - range.start + 1),
      }
      : { 'Content-Length': String(file.size) };
    return new Response(storedFile.stream, {
      status: range ? 206 : 200,
      headers: {
        'Content-Type': storedFile.contentType,
        'Content-Disposition': resolveContentDisposition(storedFile.contentType, storedFile.fileName),
        'X-Content-Type-Options': 'nosniff',
        ...partialHeaders,
        ...cacheHeaders,
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
    request: { params: FileIdParam },
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
    request: { params: FileIdParam },
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
        provider: z.enum(['local', 'oss', 's3', 'cos', 'obs', 'kodo', 'bos', 'azure', 'sftp']).optional(),
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
    request: { params: FileIdParam },
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
    request: { body: { content: jsonContent(FileBatchIdsBody), required: true } },
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

const uploadInitRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/upload/init', tags: ['Files'], summary: '初始化分片上传',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(initChunkUploadSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(UploadSessionInitDTO, '初始化成功'),
      400: { content: jsonContent(ErrorResponse), description: '无可用存储或超过大小上限' },
    },
  }),
  handler: async (c) => c.json(okBody(await initChunkUpload(c.req.valid('json'))), 200),
});

const uploadChunkRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/upload/chunk', tags: ['Files'], summary: '上传单个分片',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              uploadId: z.string(),
              index: z.string(),
              chunk: z.any().openapi({ type: 'string', format: 'binary' }),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(UploadChunkResultDTO, '分片已接收'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => {
    const body = await c.req.parseBody();
    const uploadId = String(body.uploadId ?? '');
    const index = Number(body.index);
    const chunk = body.chunk;
    if (!uploadId || !Number.isFinite(index) || typeof (chunk as File)?.arrayBuffer !== 'function') {
      return c.json(errBody('分片参数不完整', 400), 400);
    }
    return c.json(okBody(await uploadChunk(uploadId, index, chunk as File)), 200);
  },
});

const uploadCompleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/upload/complete', tags: ['Files'], summary: '完成分片上传',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(completeChunkUploadSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(ManagedFileDTO, '上传完成'),
      400: { content: jsonContent(ErrorResponse), description: '分片不完整或类型不允许' },
    },
  }),
  handler: async (c) => c.json(okBody(await completeChunkUpload(c.req.valid('json').uploadId), '上传成功'), 200),
});

const uploadStatusRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/upload/{uploadId}/status', tags: ['Files'], summary: '查询分片上传进度',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: z.object({ uploadId: z.string() }) },
    responses: {
      ...commonErrorResponses,
      ...ok(UploadSessionStatusDTO, '上传进度'),
      404: { content: jsonContent(ErrorResponse), description: '会话不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getUploadStatus(c.req.valid('param').uploadId)), 200),
});

const uploadAbortRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/upload/{uploadId}', tags: ['Files'], summary: '中止分片上传',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { params: z.object({ uploadId: z.string() }) },
    responses: { ...commonErrorResponses, ...okMsg('已中止') },
  }),
  handler: async (c) => {
    await abortChunkUpload(c.req.valid('param').uploadId);
    return c.json(okBody(null, '已中止'), 200);
  },
});

filesRouter.openapiRoutes([contentRoute, sheetPreviewRoute, statsRoute, listRoute, browseRoute, uploadInitRoute, uploadChunkRoute, uploadCompleteRoute, uploadStatusRoute, uploadAbortRoute, getOneRoute, uploadRoute, uploadOneRoute, batchDeleteRoute, deleteRoute] as const);

// 非 OpenAPI 路由：批量下载打包为 zip 流式响应
filesRouter.post('/batch-download', authMiddleware, guard({ permission: 'system:file:list' }), async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => ({ ids: [] }));
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((n): n is string => typeof n === 'string') : [];
  const { stream, filename } = await batchDownloadFilesAsZip(ids);
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
});

export default filesRouter;
