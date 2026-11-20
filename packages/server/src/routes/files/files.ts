import { OpenAPIHono, z } from '@hono/zod-openapi';
import { fileContract } from '@zenith/shared/platform';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  getStoredFileForRead,
  listManagedFiles,
  getManagedFile,
  uploadManagedFileFromBody,
  deleteManagedFile,
  batchDeleteFiles,
  getManagedFilesBeforeAudit,
  batchDownloadFilesAsZip,
  browseStorageFiles,
  getFileStats,
  getFileAccessUrl,
  findReusableFileByHash,
} from '../../services/files/files.service';
import { initChunkUpload, uploadChunk, completeChunkUpload, getUploadStatus, abortChunkUpload } from '../../services/files/upload-sessions.service';
import { abortDirectUpload, acknowledgeBusinessUploadPart, acknowledgeDirectUploadPart, abortBusinessUpload, completeDirectUpload, createDirectUpload, getBusinessUploadPartUrl, getBusinessUploadStatus, getDirectUploadPartUrl, getDirectUploadStatus } from '../../services/files/direct-uploads.service';
import { browseStorageObjects, getStorageObjectAccessUrl, readStorageObject, registerStorageObject, registerStorageObjects, removeStorageObject, removeStorageObjects } from '../../services/files/storage-browse.service';
import { extractBucketName, readStoredFile } from '../../lib/file-storage';
import { parseRangeHeader, rangeNotSatisfiable, supportsRange, rangeContentHeaders } from '../../lib/http-range';
import { attachmentDisposition, inlineOrAttachmentDisposition } from '../../lib/content-disposition';
import { mountCrud } from '../_crud';
import { recordCmsDownloadResponse } from '../../services/cms/cms-telemetry-download';

const filesRouter = new OpenAPIHono({ defaultHook: validationHook });

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
    await recordCmsDownloadResponse(id, c.req.query('cmsTelemetry'));
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
  handler: async (c) => c.json(okBody(await browseStorageFiles(c.req.valid('query'))), 200),
});

const browseStorageRoute = defineContractRoute(fileContract.browseStorage, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '路径或游标不合法' } },
  handler: async (c) => c.json(okBody(await browseStorageObjects(c.req.valid('query'))), 200),
});

const storageObjectAccessUrlRoute = defineContractRoute(fileContract.storageObjectAccessUrl, {
  responses: { 403: { content: jsonContent(ErrorResponse), description: '对象不在浏览范围内' }, 404: { content: jsonContent(ErrorResponse), description: '对象不存在' } },
  handler: async (c) => c.json(okBody(await getStorageObjectAccessUrl(c.req.valid('query'))), 200),
});

const storageObjectContentRoute = defineContractRoute(fileContract.storageObjectContent, {
  middleware: [],
  responses: {
    206: { content: { 'application/octet-stream': { schema: z.string() } }, description: '对象内容分片' },
    404: { content: jsonContent(ErrorResponse), description: '对象不存在' },
    416: { content: jsonContent(ErrorResponse), description: 'Range 不合法' },
  },
  handler: async (c) => {
    const { token } = c.req.valid('query');
    const object = await readStorageObject(token);
    const etag = `"obj-${object.key}-${object.size}"`;
    const cacheHeaders: Record<string, string> = {
      ETag: etag,
      'Cache-Control': 'private, no-store',
      'Accept-Ranges': supportsRange(object.config.provider) ? 'bytes' : 'none',
      'X-Content-Type-Options': 'nosniff',
    };
    const range = supportsRange(object.config.provider) ? parseRangeHeader(c.req.header('range'), object.size) : null;
    if (range === 'invalid') return rangeNotSatisfiable(object.size, cacheHeaders);
    const storedFile = await readStoredFile({
      objectKey: object.key,
      bucketName: extractBucketName(object.config),
      provider: object.config.provider,
      mimeType: object.mimeType,
      originalName: object.originalName,
    }, object.config, range ?? undefined);
    return new Response(storedFile.stream, {
      status: range ? 206 : 200,
      headers: {
        'Content-Type': storedFile.contentType,
        'Content-Disposition': object.download
          ? attachmentDisposition(object.originalName)
          : inlineOrAttachmentDisposition(storedFile.contentType, storedFile.fileName),
        ...rangeContentHeaders(range, object.size),
        ...cacheHeaders,
      },
    });
  },
});

const registerStorageObjectRoute = defineContractRoute(fileContract.registerStorageObject, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '对象不合法或存储不支持' }, 409: { content: jsonContent(ErrorResponse), description: '对象已收录' } },
  handler: async (c) => c.json(okBody(await registerStorageObject(c.req.valid('json')), '收录成功'), 200),
});

const registerStorageObjectsRoute = defineContractRoute(fileContract.registerStorageObjects, {
  handler: async (c) => c.json(okBody(await registerStorageObjects(c.req.valid('json')), '批量收录完成'), 200),
});

const removeStorageObjectRoute = defineContractRoute(fileContract.removeStorageObject, {
  handler: async (c) => {
    const body = c.req.valid('json');
    setAuditBeforeData(c, body);
    await removeStorageObject(body);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const removeStorageObjectsRoute = defineContractRoute(fileContract.removeStorageObjects, {
  handler: async (c) => {
    const body = c.req.valid('json');
    setAuditBeforeData(c, { storageConfigId: body.storageConfigId, keys: body.keys });
    return c.json(okBody(await removeStorageObjects(body), '批量删除完成'), 200);
  },
});

const statsRoute = defineContractRoute(fileContract.stats, {
  handler: async (c) => c.json(okBody(await getFileStats()), 200),
});
const uploadRoute = defineContractRoute(fileContract.upload, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '未选择文件或无可用存储' } },
  handler: async (c) => {
    const body = await c.req.parseBody({ all: true });
    const fileValues = Array.isArray(body.file) ? body.file : [body.file];
    const visibility = body.visibility === 'restricted' ? 'restricted' as const : undefined;
    const results = await Promise.all(fileValues.map((f) => uploadManagedFileFromBody(f, { visibility })));
    return c.json(okBody(results, `成功上传 ${results.length} 个文件`), 200);
  },
});
const batchDeleteRoute = defineContractRoute(fileContract.removeBatch, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getManagedFilesBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await batchDeleteFiles(ids);
    return c.json(okBody(null, `已删除 ${count} 个文件`), 200);
  },
});

const uploadOneRoute = defineContractRoute(fileContract.uploadOne, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '未选择文件或无可用存储' } },
  handler: async (c) => {
    const body = await c.req.parseBody();
    const result = await uploadManagedFileFromBody(body.file);
    return c.json(okBody(result, '上传成功'), 200);
  },
});

const uploadInitRoute = defineContractRoute(fileContract.uploadInit, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '无可用存储或超过大小上限' } },
  handler: async (c) => c.json(okBody(await initChunkUpload(c.req.valid('json'))), 200),
});

const uploadChunkRoute = defineContractRoute(fileContract.uploadChunk, {
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
  responses: { 400: { content: jsonContent(ErrorResponse), description: '分片不完整或类型不允许' } },
  handler: async (c) => c.json(okBody(await completeChunkUpload(c.req.valid('json').uploadId), '上传成功'), 200),
});

const uploadStatusRoute = defineContractRoute(fileContract.uploadStatus, {
  responses: { 404: { content: jsonContent(ErrorResponse), description: '会话不存在' } },
  handler: async (c) => c.json(okBody(await getUploadStatus(c.req.valid('param').uploadId)), 200),
});

const uploadAbortRoute = defineContractRoute(fileContract.uploadAbort, {
  handler: async (c) => {
    const { uploadId } = c.req.valid('param');
    const before = await getUploadStatus(uploadId);
    setAuditBeforeData(c, before);
    await abortChunkUpload(uploadId);
    setAuditAfterData(c, { uploadId, status: 'aborted' });
    return c.json(okBody(null, '已中止'), 200);
  },
});

const directUploadInitRoute = defineContractRoute(fileContract.directUploadInit, {
  handler: async (c) => c.json(okBody(await createDirectUpload(c.req.valid('json'))), 200),
});

const directUploadPartUrlRoute = defineContractRoute(fileContract.directUploadPartUrl, {
  handler: async (c) => {
    const { uploadId, partNumber } = c.req.valid('param');
    return c.json(okBody(await getDirectUploadPartUrl(uploadId, partNumber)), 200);
  },
});

const directUploadPartAckRoute = defineContractRoute(fileContract.directUploadPartAck, {
  handler: async (c) => {
    const { uploadId, partNumber } = c.req.valid('param');
    return c.json(okBody(await acknowledgeDirectUploadPart(uploadId, partNumber, c.req.valid('json'))), 200);
  },
});

const directUploadStatusRoute = defineContractRoute(fileContract.directUploadStatus, {
  handler: async (c) => c.json(okBody(await getDirectUploadStatus(c.req.valid('param').uploadId)), 200),
});

const directUploadCompleteRoute = defineContractRoute(fileContract.directUploadComplete, {
  responses: { 400: { content: jsonContent(ErrorResponse), description: '对象校验失败或会话已结束' } },
  handler: async (c) => c.json(okBody(await completeDirectUpload(c.req.valid('param').uploadId, c.req.valid('json')), '上传成功'), 200),
});

const directUploadAbortRoute = defineContractRoute(fileContract.directUploadAbort, {
  handler: async (c) => {
    const { uploadId } = c.req.valid('param');
    setAuditBeforeData(c, { uploadId, status: 'uploading' });
    await abortDirectUpload(uploadId);
    setAuditAfterData(c, { uploadId, status: 'aborted' });
    return c.json(okBody(null, '已中止'), 200);
  },
});

// ─── 业务上传会话的直传通道 ─────────────────────────────────────────────────
// init / complete 由各业务模块的契约承载（业务权限与落库语义在那边），这里只提供
// 「当前用户 + 业务会话」的分片地址、确认、进度与中止。
const businessUploadPartUrlRoute = defineContractRoute(fileContract.businessUploadPartUrl, {
  handler: async (c) => {
    const { uploadId, partNumber } = c.req.valid('param');
    return c.json(okBody(await getBusinessUploadPartUrl(uploadId, partNumber)), 200);
  },
});

const businessUploadPartAckRoute = defineContractRoute(fileContract.businessUploadPartAck, {
  handler: async (c) => {
    const { uploadId, partNumber } = c.req.valid('param');
    return c.json(okBody(await acknowledgeBusinessUploadPart(uploadId, partNumber, c.req.valid('json'))), 200);
  },
});

const businessUploadStatusRoute = defineContractRoute(fileContract.businessUploadStatus, {
  handler: async (c) => c.json(okBody(await getBusinessUploadStatus(c.req.valid('param').uploadId)), 200),
});

const businessUploadAbortRoute = defineContractRoute(fileContract.businessUploadAbort, {
  handler: async (c) => {
    await abortBusinessUpload(c.req.valid('param').uploadId);
    return c.json(okBody(null, '已中止'), 200);
  },
});

const quickUploadRoute = defineContractRoute(fileContract.quickUpload, {
  handler: async (c) => c.json(okBody(await findReusableFileByHash(c.req.valid('json'))), 200),
});

// 批量下载打包为 zip 流式响应
const batchDownloadRoute = defineContractRoute(fileContract.batchDownload, {
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

mountCrud(filesRouter, fileContract,
  { list: listManagedFiles, get: getManagedFile, remove: deleteManagedFile },
  {
    exclude: ['removeBatch'],
    responses: { detail: { 404: { content: jsonContent(ErrorResponse), description: '文件不存在' } }, remove: { 404: { content: jsonContent(ErrorResponse), description: '文件不存在' } } },
  },
  [
    contentRoute,
    accessUrlRoute,
    statsRoute,
    browseRoute,
    browseStorageRoute,
    storageObjectAccessUrlRoute,
    storageObjectContentRoute,
    registerStorageObjectRoute,
    registerStorageObjectsRoute,
    removeStorageObjectRoute,
    removeStorageObjectsRoute,
    uploadInitRoute,
    uploadChunkRoute,
    uploadCompleteRoute,
    uploadStatusRoute,
    uploadAbortRoute,
    directUploadInitRoute,
    directUploadPartUrlRoute,
    directUploadPartAckRoute,
    directUploadStatusRoute,
    directUploadCompleteRoute,
    directUploadAbortRoute,
    businessUploadPartUrlRoute,
    businessUploadPartAckRoute,
    businessUploadStatusRoute,
    businessUploadAbortRoute,
    quickUploadRoute,
    uploadRoute,
    uploadOneRoute,
    batchDownloadRoute,
    batchDeleteRoute,
  ],
);

export default filesRouter;
