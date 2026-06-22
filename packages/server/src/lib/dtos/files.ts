/**
 * 文件存储相关 DTO
 */
import { z } from '@hono/zod-openapi';
import { auditFields } from './_audit';

export const FileStorageConfigDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    provider: z.enum(['local', 'oss', 's3', 'cos', 'obs', 'kodo', 'bos', 'azure', 'sftp']),
    status: z.enum(['enabled', 'disabled']),
    isDefault: z.boolean(),
    basePath: z.string().nullable().optional(),
    localRootPath: z.string().nullable().optional(),
    // 阿里云 OSS（不含 AccessKeySecret）
    ossRegion: z.string().nullable().optional(),
    ossEndpoint: z.string().nullable().optional(),
    ossBucket: z.string().nullable().optional(),
    ossAccessKeyId: z.string().nullable().optional(),
    // S3 兼容存储（不含 SecretAccessKey）
    s3Region: z.string().nullable().optional(),
    s3Endpoint: z.string().nullable().optional(),
    s3Bucket: z.string().nullable().optional(),
    s3AccessKeyId: z.string().nullable().optional(),
    s3ForcePathStyle: z.boolean().nullable().optional(),
    // 腾讯云 COS（不含 SecretKey）
    cosRegion: z.string().nullable().optional(),
    cosBucket: z.string().nullable().optional(),
    cosSecretId: z.string().nullable().optional(),
    // 华为云 OBS（不含 SecretAccessKey）
    obsEndpoint: z.string().nullable().optional(),
    obsBucket: z.string().nullable().optional(),
    obsAccessKeyId: z.string().nullable().optional(),
    // 七牛云 Kodo（不含 SecretKey）
    kodoAccessKey: z.string().nullable().optional(),
    kodoBucket: z.string().nullable().optional(),
    kodoRegion: z.string().nullable().optional(),
    kodoEndpoint: z.string().nullable().optional(),
    // 百度云 BOS（不含 SecretAccessKey）
    bosEndpoint: z.string().nullable().optional(),
    bosBucket: z.string().nullable().optional(),
    bosAccessKeyId: z.string().nullable().optional(),
    // Azure Blob（不含 AccountKey）
    azureAccountName: z.string().nullable().optional(),
    azureContainerName: z.string().nullable().optional(),
    azureEndpoint: z.string().nullable().optional(),
    // SFTP（不含 Password / PrivateKey）
    sftpHost: z.string().nullable().optional(),
    sftpPort: z.number().int().nullable().optional(),
    sftpUsername: z.string().nullable().optional(),
    sftpRootPath: z.string().nullable().optional(),
    sftpBaseUrl: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('FileStorageConfig');

export const FileStatsDTO = z
  .object({
    summary: z.object({
      totalFiles: z.number().int(),
      totalSize: z.number().int(),
      imageCount: z.number().int(),
      docCount: z.number().int(),
      videoCount: z.number().int(),
      audioCount: z.number().int(),
      todayCount: z.number().int(),
      thisMonthCount: z.number().int(),
    }),
    typeStats: z.array(z.object({ type: z.string(), label: z.string(), count: z.number().int(), size: z.number().int() })),
    providerStats: z.array(z.object({ provider: z.string(), count: z.number().int(), size: z.number().int() })),
    monthlyStats: z.array(z.object({ month: z.string(), count: z.number().int() })),
    uploaderStats: z.array(z.object({ username: z.string(), count: z.number().int(), size: z.number().int() })),
    sizeRangeStats: z.array(z.object({ range: z.string(), count: z.number().int() })),
  })
  .openapi('FileStats');

export const ManagedFileDTO = z
  .object({
    id: z.string().uuid(),
    storageConfigId: z.number().int(),
    storageName: z.string(),
    provider: z.enum(['local', 'oss', 's3', 'cos', 'obs', 'kodo', 'bos', 'azure', 'sftp']),
    originalName: z.string().openapi({ example: 'avatar.png' }),
    objectKey: z.string(),
    size: z.number().int().openapi({ example: 10240 }),
    mimeType: z.string().nullable().optional(),
    extension: z.string().nullable().optional(),
    url: z.string().openapi({ example: 'https://example.com/files/avatar.png' }),
    uploaderName: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ManagedFile');

export const FolderEntryDTO = z
  .object({
    name: z.string(),
    path: z.string(),
  })
  .openapi('FolderEntry');

export const StorageBrowseResultDTO = z
  .object({
    folders: z.array(FolderEntryDTO),
    files: z.array(ManagedFileDTO),
    currentPath: z.string(),
    basePath: z.string(),
  })
  .openapi('StorageBrowseResult');

export const SheetPreviewDTO = z
  .object({
    id: z.string(),
    name: z.string(),
    appVersion: z.string(),
    sheetOrder: z.array(z.string()),
    styles: z.record(z.string(), z.any()),
    sheets: z.record(z.string(), z.any()),
  })
  .openapi('SheetPreview');
