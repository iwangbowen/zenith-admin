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
    ossRegion: z.string().nullable().optional(),
    ossEndpoint: z.string().nullable().optional(),
    ossBucket: z.string().nullable().optional(),
    ossAccessKeyId: z.string().nullable().optional(),
    ossAccessKeySecret: z.string().nullable().optional(),
    s3Region: z.string().nullable().optional(),
    s3Endpoint: z.string().nullable().optional(),
    s3Bucket: z.string().nullable().optional(),
    s3AccessKeyId: z.string().nullable().optional(),
    s3SecretAccessKey: z.string().nullable().optional(),
    s3ForcePathStyle: z.boolean().nullable().optional(),
    cosRegion: z.string().nullable().optional(),
    cosBucket: z.string().nullable().optional(),
    cosSecretId: z.string().nullable().optional(),
    cosSecretKey: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    ...auditFields,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('FileStorageConfig');

export const ManagedFileDTO = z
  .object({
    id: z.number().int(),
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
