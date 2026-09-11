import * as z from 'zod';
import { auditFieldsSchema, dateRangeBound, entityStatusQuery, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { FILE_OBJECT_ACLS, FILE_STORAGE_PROVIDERS, FILE_URL_STRATEGIES } from '../constants';
import { createFileStorageConfigSchema, updateFileStorageConfigSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/**
 * 文件存储配置。各 provider 的密钥字段（AccessKeySecret / SecretKey / AccountKey / SFTP 密码与私钥）
 * 为 write-only：任何接口都不返回，编辑时留空即保留原值。
 */
export const fileStorageConfigSchema = z.object({
  id: z.int(),
  name: z.string().meta({ example: '本地磁盘' }),
  provider: z.enum(FILE_STORAGE_PROVIDERS),
  status: entityStatusSchema,
  isDefault: z.boolean(),
  basePath: z.string().nullable().optional(),
  objectAcl: z.enum(FILE_OBJECT_ACLS).meta({ description: '对象读写权限（仅 oss/s3/cos/obs/bos 生效）；default = 继承 Bucket' }),
  urlStrategy: z.enum(FILE_URL_STRATEGIES).meta({ description: '文件访问 URL 策略' }),
  publicBaseUrl: z.string().nullable().optional().meta({ description: '自定义访问域名（CDN/加速域名），public 策略优先使用' }),
  presignedExpirySeconds: z.int().meta({ description: '临时签名有效期（秒）' }),
  localRootPath: z.string().nullable().optional(),
  // 阿里云 OSS
  ossRegion: z.string().nullable().optional(),
  ossEndpoint: z.string().nullable().optional(),
  ossBucket: z.string().nullable().optional(),
  ossAccessKeyId: z.string().nullable().optional(),
  // S3 兼容存储
  s3Region: z.string().nullable().optional(),
  s3Endpoint: z.string().nullable().optional(),
  s3Bucket: z.string().nullable().optional(),
  s3AccessKeyId: z.string().nullable().optional(),
  s3ForcePathStyle: z.boolean().nullable().optional(),
  // 腾讯云 COS
  cosRegion: z.string().nullable().optional(),
  cosBucket: z.string().nullable().optional(),
  cosSecretId: z.string().nullable().optional(),
  // 华为云 OBS
  obsEndpoint: z.string().nullable().optional(),
  obsBucket: z.string().nullable().optional(),
  obsAccessKeyId: z.string().nullable().optional(),
  // 七牛云 Kodo
  kodoAccessKey: z.string().nullable().optional(),
  kodoBucket: z.string().nullable().optional(),
  kodoRegion: z.string().nullable().optional(),
  kodoEndpoint: z.string().nullable().optional(),
  // 百度云 BOS
  bosEndpoint: z.string().nullable().optional(),
  bosBucket: z.string().nullable().optional(),
  bosAccessKeyId: z.string().nullable().optional(),
  // Azure Blob Storage
  azureAccountName: z.string().nullable().optional(),
  azureContainerName: z.string().nullable().optional(),
  azureEndpoint: z.string().nullable().optional(),
  // SFTP
  sftpHost: z.string().nullable().optional(),
  sftpPort: z.int().nullable().optional(),
  sftpUsername: z.string().nullable().optional(),
  sftpRootPath: z.string().nullable().optional(),
  sftpBaseUrl: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'FileStorageConfig' });

export type FileStorageConfig = z.infer<typeof fileStorageConfigSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const fileStorageConfigListQuery = paginationQuery.extend({
  status: entityStatusQuery,
  startTime: dateRangeBound('更新时间起'),
  endTime: dateRangeBound('更新时间止'),
});

export const fileStorageConfigContract = defineContract('/api/file-storage-configs', {
  list: op.get('/', { query: fileStorageConfigListQuery, response: paginated(fileStorageConfigSchema), summary: '存储配置列表' }),
  defaultConfig: op.get('/default', { response: fileStorageConfigSchema.nullable(), summary: '默认配置' }),
  test: op.post('/test', { body: createFileStorageConfigSchema, summary: '测试存储配置连接' }),
  testExisting: op.post('/{id}/test', { params: idParam, body: updateFileStorageConfigSchema, summary: '测试已保存存储配置连接' }),
  detail: op.get('/{id}', { params: idParam, response: fileStorageConfigSchema, summary: '存储配置详情' }),
  create: op.post('/', { body: createFileStorageConfigSchema, response: fileStorageConfigSchema, summary: '创建配置' }),
  update: op.put('/{id}', { params: idParam, body: updateFileStorageConfigSchema, response: fileStorageConfigSchema, summary: '更新配置' }),
  setDefault: op.put('/{id}/default', { params: idParam, response: fileStorageConfigSchema, summary: '设为默认' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除配置' }),
}, { tags: ['FileStorageConfigs'] });
