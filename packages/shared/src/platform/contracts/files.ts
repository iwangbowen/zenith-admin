import * as z from 'zod';
import { dateRangeBound, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import {
  FILE_ACCESS_PURPOSES,
  FILE_STORAGE_PROVIDERS,
  FILE_TYPE_FILTERS,
  FILE_URL_STRATEGIES,
  FILE_VISIBILITIES,
  UPLOAD_SESSION_STATUSES,
} from '../constants';
import { completeChunkUploadSchema, initChunkUploadSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const managedFileSchema = z.object({
  id: z.uuid(),
  storageConfigId: z.int(),
  storageName: z.string(),
  provider: z.enum(FILE_STORAGE_PROVIDERS),
  originalName: z.string().meta({ example: 'avatar.png' }),
  objectKey: z.string(),
  size: z.int().meta({ example: 10240 }),
  mimeType: z.string().nullable().optional(),
  extension: z.string().nullable().optional(),
  visibility: z.enum(FILE_VISIBILITIES).meta({ description: 'restricted 文件不可经通用 content 接口读取' }),
  contentHash: z.string().nullable().optional().meta({ description: '内容 SHA-256（hex），未计算为 null' }),
  url: z.string().meta({ description: '稳定代理路径 /api/files/{id}/content，可持久化', example: '/api/files/018f.../content' }),
  directUrl: z.string().nullable().optional().meta({ description: 'public 策略的永久公开直链；仅渲染用，禁止持久化', example: 'https://cdn.example.com/2026/07/11/a.png' }),
  uploaderName: z.string().nullable().optional().meta({ description: '上传人（列表 / 详情 / 目录浏览返回）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ManagedFile' });

export type ManagedFile = z.infer<typeof managedFileSchema>;

/** access-url 接口返回的文件访问地址（presigned 每次返回新鲜签名，禁止长期缓存） */
export const fileAccessUrlSchema = z.object({
  url: z.string().meta({ example: 'https://bucket.oss-cn-hangzhou.aliyuncs.com/2026/07/11/a.png?Expires=...' }),
  strategy: z.enum(FILE_URL_STRATEGIES),
  expiresAt: z.string().nullable().meta({ description: '签名过期时间（YYYY-MM-DD HH:mm:ss）；public/proxy 为 null' }),
}).meta({ id: 'FileAccessUrl' });

export type FileAccessUrl = z.infer<typeof fileAccessUrlSchema>;

export const folderEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
}).meta({ id: 'FolderEntry' });

export type FolderEntry = z.infer<typeof folderEntrySchema>;

export const storageBrowseResultSchema = z.object({
  folders: z.array(folderEntrySchema),
  files: z.array(managedFileSchema),
  currentPath: z.string(),
  basePath: z.string(),
}).meta({ id: 'StorageBrowseResult' });

export type StorageBrowseResult = z.infer<typeof storageBrowseResultSchema>;

export const fileStatsSchema = z.object({
  summary: z.object({
    totalFiles: z.int(),
    totalSize: z.int(),
    imageCount: z.int(),
    docCount: z.int(),
    videoCount: z.int(),
    audioCount: z.int(),
    todayCount: z.int(),
    thisMonthCount: z.int(),
  }),
  typeStats: z.array(z.object({ type: z.string(), label: z.string(), count: z.int(), size: z.int() })),
  providerStats: z.array(z.object({ provider: z.string(), count: z.int(), size: z.int() })),
  monthlyStats: z.array(z.object({ month: z.string(), count: z.int() })),
  uploaderStats: z.array(z.object({ username: z.string(), count: z.int(), size: z.int() })),
  sizeRangeStats: z.array(z.object({ range: z.string(), count: z.int() })),
}).meta({ id: 'FileStats' });

export type FileStats = z.infer<typeof fileStatsSchema>;

// ─── 分片上传会话 ─────────────────────────────────────────────────────────────

export const uploadSessionInitSchema = z.object({
  uploadId: z.string(),
  chunkSize: z.int(),
  totalChunks: z.int(),
  received: z.array(z.int()).meta({ description: '已接收的分片序号（从 0 计），用于断点续传' }),
}).meta({ id: 'UploadSessionInit' });

export type UploadSessionInit = z.infer<typeof uploadSessionInitSchema>;

export const uploadChunkResultSchema = z.object({
  index: z.int(),
  receivedCount: z.int().meta({ description: '当前已接收的分片数；完整序号列表经 status 接口获取，避免万片级会话每片回传整表' }),
}).meta({ id: 'UploadChunkResult' });

export type UploadChunkResult = z.infer<typeof uploadChunkResultSchema>;

export const uploadSessionStatusSchema = z.object({
  uploadId: z.string(),
  status: z.enum(UPLOAD_SESSION_STATUSES),
  chunkSize: z.int(),
  totalChunks: z.int(),
  received: z.array(z.int()),
}).meta({ id: 'UploadSessionStatus' });

export type UploadSessionStatus = z.infer<typeof uploadSessionStatusSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

const FILE_ID_EXAMPLE = '018f6f8a-5f76-7d8c-9a1b-2c3d4e5f6789';

/** `{id}` 路径参数：托管文件 ID（UUID v7） */
export const fileIdParam = z.object({
  id: z.uuid().meta({ description: '文件 ID', example: FILE_ID_EXAMPLE }),
});

const uploadIdParam = z.object({
  uploadId: z.string().meta({ description: '分片上传会话 ID', example: '3f1c2b7e-9d4a-4c5b-8e6f-1a2b3c4d5e6f' }),
});

export const fileListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按文件名 / 对象键 / 文件服务模糊匹配' }),
  provider: z.enum(FILE_STORAGE_PROVIDERS).optional(),
  fileType: z.enum(FILE_TYPE_FILTERS).optional(),
  startTime: dateRangeBound('上传时间起'),
  endTime: dateRangeBound('上传时间止'),
});

export const fileAccessUrlQuery = z.object({
  purpose: z.enum(FILE_ACCESS_PURPOSES).optional(),
});

export const storageBrowseQuery = z.object({
  storageConfigId: z.coerce.number().int().positive().meta({ description: '存储配置 ID', example: 1 }),
  path: z.string().optional().meta({ description: '相对存储根路径的目录，空表示根目录' }),
});

/** 批量删除的文件 ID 列表 */
export const fileIdsBody = z.object({
  ids: z.array(z.uuid()).min(1),
});

/** 批量下载的文件 ID 列表；空列表由服务端按业务规则拒绝 */
const batchDownloadBody = z.object({
  ids: z.array(z.uuid()),
});

const uploadBody = multipart(z.object({
  file: z.unknown().meta({ type: 'array', items: { type: 'string', format: 'binary' }, description: '文件，可多选' }),
}));

const uploadOneBody = multipart(z.object({
  file: fileField(),
}));

/** 分片上传单片的表单体（uploadId + index + chunk），供各归属模块的 chunk 操作复用 */
export const uploadChunkBody = multipart(z.object({
  uploadId: z.string(),
  index: z.string().meta({ description: '分片序号（从 0 计）' }),
  chunk: fileField('分片内容'),
}));

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const fileContract = defineContract('/api/files', {
  content: op.get('/{id}/content', { params: fileIdParam, kind: 'file', public: true, summary: '公开访问文件内容' }),
  accessUrl: op.get('/{id}/access-url', {
    params: fileIdParam,
    query: fileAccessUrlQuery,
    response: fileAccessUrlSchema,
    summary: '解析文件访问直链（按存储配置策略，presigned 每次签发新鲜 URL）',
  }),
  stats: op.get('/stats', { response: fileStatsSchema, summary: '文件统计分析' }),
  list: op.get('/', { query: fileListQuery, response: paginated(managedFileSchema), summary: '文件分页列表' }),
  browse: op.get('/browse', { query: storageBrowseQuery, response: storageBrowseResultSchema, summary: '按存储配置浏览文件目录' }),
  uploadInit: op.post('/upload/init', { body: initChunkUploadSchema, response: uploadSessionInitSchema, summary: '初始化分片上传' }),
  uploadChunk: op.post('/upload/chunk', { body: uploadChunkBody, response: uploadChunkResultSchema, summary: '上传单个分片' }),
  uploadComplete: op.post('/upload/complete', { body: completeChunkUploadSchema, response: managedFileSchema, summary: '完成分片上传' }),
  uploadStatus: op.get('/upload/{uploadId}/status', { params: uploadIdParam, response: uploadSessionStatusSchema, summary: '查询分片上传进度' }),
  uploadAbort: op.delete('/upload/{uploadId}', { params: uploadIdParam, summary: '中止分片上传' }),
  detail: op.get('/{id}', { params: fileIdParam, response: managedFileSchema, summary: '获取文件详情' }),
  upload: op.post('/upload', { body: uploadBody, response: z.array(managedFileSchema), summary: '上传文件' }),
  uploadOne: op.post('/upload-one', { body: uploadOneBody, response: managedFileSchema, summary: '上传单个文件' }),
  batchDownload: op.post('/batch-download', { body: batchDownloadBody, kind: 'file', summary: '批量下载文件（zip）' }),
  removeBatch: op.delete('/batch', { body: fileIdsBody, summary: '批量删除文件' }),
  remove: op.delete('/{id}', { params: fileIdParam, summary: '删除文件' }),
}, { tags: ['Files'] });
