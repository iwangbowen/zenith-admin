import { OpenAPIHono, z } from '@hono/zod-openapi';
import { fileContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  getStoredFileForRead, listManagedFiles, getManagedFile, uploadManagedFileFromBody, deleteManagedFile, batchDeleteFiles, getManagedFileBeforeAudit, getManagedFilesBeforeAudit, batchDownloadFilesAsZip, browseStorageFiles, getFileStats, getFileAccessUrl,
} from '../../services/files/files.service';
import { initChunkUpload, uploadChunk, completeChunkUpload, getUploadStatus, abortChunkUpload } from '../../services/files/upload-sessions.service';
import { readStoredFile } from '../../lib/file-storage';
import { parseRangeHeader, rangeContentHeaders, rangeNotSatisfiable, supportsRange } from '../../lib/http-range';
import { attachmentDisposition, inlineOrAttachmentDisposition } from '../../lib/content-disposition';

const filesRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'system:file:list' })] as const;

const contentRoute = defineContractRoute(fileContract.content, {
  middleware: [],
  responses: {
    206: { content: { 'application/octet-stream': { schema: z.string() } }, description: '文件内容分片' },
    404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
    416: { content: jsonContent(ErrorResponse), description: 'Range 不合法' },
  },
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
    if (range === 'invalid') return rangeNotSatisfiable(file.size, cacheHeaders);
    const ifNoneMatch = c.req.header('if-none-match');
    const ifModifiedSince = c.req.header('if-modified-since');
    const notModified = !range && (ifNoneMatch
      ? ifNoneMatch.split(',').some((t) => t.trim() === etag)
      : !!ifModifiedSince && new Date(ifModifiedSince).getTime() >= lastModifiedMs);
    if (notModified) {
      return new Response(null, { status: 304, headers: cacheHeaders });
    }
    const storedFile = await readStoredFile(file, storageConfig, range ?? undefined);
    return new Response(storedFile.stream, {
      status: range ? 206 : 200,
      headers: {
        'Content-Type': storedFile.contentType,
        'Content-Disposition': inlineOrAttachmentDisposition(storedFile.contentType, storedFile.fileName),
        'X-Content-Type-Options': 'nosniff',
        ...rangeContentHeaders(range, file.size),
        ...cacheHeaders,
      },
    });
  },
});

const accessUrlRoute = defineContractRoute(fileContract.accessUrl, {
  middleware: [authMiddleware],
  responses: { 404: { content: jsonContent(ErrorResponse), description: '文件不存在' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { purpose } = c.req.valid('query');
    const access = await getFileAccessUrl(id, purpose);
    // 签名 URL 属敏感短时凭证，禁止任何中间层缓存
    return c.json(okBody(access), 200, { 'Cache-Control': 'private, no-store' });
  },
});

const browseRoute = defineContractRoute(fileContract.browse, {
  middleware: read,
  handler: async (c) => c.json(okBody(await browseStorageFiles(c.req.valid('query'))), 200),
});

const getOneRoute = defineContractRoute(fileContract.detail, {
  middleware: read,
  responses: { 404: { content: jsonContent(ErrorResponse), description: '文件不存在' } },
  handler: async (c) => c.json(okBody(await getManagedFile(c.req.valid('param').id)), 200),
});

const statsRoute = defineContractRoute(fileContract.stats, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getFileStats()), 200),
});

const listRoute = defineContractRoute(fileContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listManagedFiles(c.req.valid('query'))), 200),
});

const uploadRoute = defineContractRoute(fileContract.upload, {
  middleware: [authMiddleware, guard({ permission: 'system:file:upload', audit: { description: '上传文件', module: '文件管理', recordBody: false } })],
  responses: { 400: { content: jsonContent(ErrorResponse), description: '未选择文件或无可用存储' } },
  handler: async (c) => {
    const body = await c.req.parseBody({ all: true });
    const fileValues = Array.isArray(body.file) ? body.file : [body.file];
    const results = await Promise.all(fileValues.map((f) => uploadManagedFileFromBody(f)));
    return c.json(okBody(results, `成功上传 ${results.length} 个文件`), 200);
  },
});

const deleteRoute = defineContractRoute(fileContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'system:file:delete', audit: { description: '删除文件', module: '文件管理', recordBody: false } })],
  responses: { 404: { content: jsonContent(ErrorResponse), description: '文件不存在' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getManagedFileBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteManagedFile(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchDeleteRoute = defineContractRoute(fileContract.removeBatch, {
  middleware: [authMiddleware, guard({ permission: 'system:file:delete', audit: { description: '批量删除文件', module: '文件管理', recordBody: false } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getManagedFilesBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await batchDeleteFiles(ids);
    return c.json(okBody(null, `已删除 ${count} 个文件`), 200);
  },
});

const uploadOneRoute = defineContractRoute(fileContract.uploadOne, {
  middleware: [authMiddleware, guard({ permission: 'system:file:upload', audit: { description: '上传单个文件', module: '文件管理', recordBody: false } })],
  responses: { 400: { content: jsonContent(ErrorResponse), description: '未选择文件或无可用存储' } },
  handler: async (c) => {
    const body = await c.req.parseBody();
    const result = await uploadManagedFileFromBody(body.file);
    return c.json(okBody(result, '上传成功'), 200);
  },
});

const uploadInitRoute = defineContractRoute(fileContract.uploadInit, {
  middleware: [authMiddleware, guard({ permission: 'system:file:upload', audit: { description: '初始化分片上传', module: '文件管理' } })],
  responses: { 400: { content: jsonContent(ErrorResponse), description: '无可用存储或超过大小上限' } },
  handler: async (c) => c.json(okBody(await initChunkUpload(c.req.valid('json'))), 200),
});

const uploadChunkRoute = defineContractRoute(fileContract.uploadChunk, {
  middleware: [authMiddleware, guard({ permission: 'system:file:upload' })],
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

const uploadCompleteRoute = defineContractRoute(fileContract.uploadComplete, {
  middleware: [authMiddleware, guard({ permission: 'system:file:upload', audit: { description: '完成分片上传', module: '文件管理' } })],
  responses: { 400: { content: jsonContent(ErrorResponse), description: '分片不完整或类型不允许' } },
  handler: async (c) => c.json(okBody(await completeChunkUpload(c.req.valid('json').uploadId), '上传成功'), 200),
});

const uploadStatusRoute = defineContractRoute(fileContract.uploadStatus, {
  middleware: [authMiddleware],
  responses: { 404: { content: jsonContent(ErrorResponse), description: '会话不存在' } },
  handler: async (c) => c.json(okBody(await getUploadStatus(c.req.valid('param').uploadId)), 200),
});

const uploadAbortRoute = defineContractRoute(fileContract.uploadAbort, {
  middleware: [authMiddleware, guard({ permission: 'system:file:upload', audit: { description: '中止分片上传', module: '文件管理' } })],
  handler: async (c) => {
    const { uploadId } = c.req.valid('param');
    const before = await getUploadStatus(uploadId);
    setAuditBeforeData(c, before);
    await abortChunkUpload(uploadId);
    setAuditAfterData(c, { uploadId, status: 'aborted' });
    return c.json(okBody(null, '已中止'), 200);
  },
});

// 批量下载打包为 zip 流式响应
const batchDownloadRoute = defineContractRoute(fileContract.batchDownload, {
  middleware: read,
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const { stream, filename } = await batchDownloadFilesAsZip(ids);
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': attachmentDisposition(filename),
      },
    });
  },
});

filesRouter.openapiRoutes([
  contentRoute, accessUrlRoute, statsRoute, listRoute, browseRoute,
  uploadInitRoute, uploadChunkRoute, uploadCompleteRoute, uploadStatusRoute, uploadAbortRoute,
  getOneRoute, uploadRoute, uploadOneRoute, batchDownloadRoute, batchDeleteRoute, deleteRoute,
] as const);

export default filesRouter;
