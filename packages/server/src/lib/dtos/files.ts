/**
 * 文件存储相关 DTO
 */
import { z } from '@hono/zod-openapi';

export const FileStorageConfigDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    provider: z.enum(['local', 'oss', 's3', 'cos']),
    status: z.enum(['active', 'disabled']),
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
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('FileStorageConfig');

export const ManagedFileDTO = z
  .object({
    id: z.number().int(),
    storageConfigId: z.number().int(),
    storageName: z.string(),
    provider: z.enum(['local', 'oss', 's3', 'cos']),
    originalName: z.string().openapi({ example: 'avatar.png' }),
    objectKey: z.string(),
    size: z.number().int().openapi({ example: 10240 }),
    mimeType: z.string().nullable().optional(),
    extension: z.string().nullable().optional(),
    url: z.string().openapi({ example: 'https://example.com/files/avatar.png' }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ManagedFile');
