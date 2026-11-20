import * as z from 'zod';
import { auditFieldsSchema, dateRangeQuery, entityStatusQuery, entityStatusSchema, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { FILE_ACCESS_STRATEGIES, FILE_BUCKET_ACLS, FILE_OBJECT_ACLS, FILE_STORAGE_PROVIDERS, FILE_UPLOAD_MODES } from '../constants';
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
  accessStrategy: z.enum(FILE_ACCESS_STRATEGIES).meta({ description: '文件下载方式' }),
  uploadMode: z.enum(FILE_UPLOAD_MODES).meta({ description: '文件上传方式' }),
  /** 最近一次探测的 Bucket / Container 读写权限 */
  bucketAcl: z.enum(FILE_BUCKET_ACLS).nullable().optional(),
  /** 最近一次探测的阻止公共访问状态；null = 该 provider 无此能力或尚未探测 */
  bucketBlockPublicAccess: z.boolean().nullable().optional(),
  /** 最近一次探测的 Bucket Policy 是否允许匿名公共访问 */
  bucketPolicyPublic: z.boolean().nullable().optional(),
  /** provider 返回的 Bucket 综合公共访问状态（目前 OBS 提供该接口） */
  bucketPublicStatus: z.boolean().nullable().optional(),
  bucketAccessCheckedAt: z.string().nullable().optional(),
  bucketAccessError: z.string().nullable().optional(),
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

/** Bucket / Container 级访问状态探测结果 */
export const fileBucketAccessInfoSchema = z.object({
  bucketAcl: z.enum(FILE_BUCKET_ACLS).nullable(),
  blockPublicAccess: z.boolean().nullable(),
  /** Bucket Policy 是否允许匿名公共访问；null = 未探测或 provider 未提供该状态 */
  policyPublic: z.boolean().nullable(),
  /** provider 返回的综合公共访问状态；null = 未探测或 provider 未提供该接口 */
  publicStatus: z.boolean().nullable(),
  effectivePublic: z.boolean(),
  checkedAt: z.string(),
}).meta({ id: 'FileBucketAccessInfo' });

export type FileBucketAccessInfo = z.infer<typeof fileBucketAccessInfoSchema>;

export const updateFileBucketAccessSchema = z.object({
  acl: z.enum(FILE_BUCKET_ACLS).optional(),
  blockPublicAccess: z.boolean().optional(),
}).refine((value) => value.acl !== undefined || value.blockPublicAccess !== undefined, {
  message: '至少提供一个要修改的权限项',
});

export const updateDraftFileBucketAccessSchema = z.object({
  config: createFileStorageConfigSchema,
  changes: updateFileBucketAccessSchema,
}).meta({ id: 'UpdateDraftFileBucketAccess' });

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const fileStorageConfigListQuery = paginationQuery.extend({
  status: entityStatusQuery,
  ...dateRangeQuery('更新时间'),
});

export const fileStorageConfigContract = defineContract('/api/file-storage-configs', {
  list: op.get('/', { access: { permission: 'system:file:config' }, query: fileStorageConfigListQuery, response: paginated(fileStorageConfigSchema), summary: '存储配置列表' }),
  defaultConfig: op.get('/default', { access: { permission: 'system:file:config' }, response: fileStorageConfigSchema.nullable(), summary: '默认配置' }),
  test: op.post('/test', { access: { permission: 'system:file:config' }, audit: { description: '测试文件存储连接', recordBody: false }, body: createFileStorageConfigSchema, summary: '测试存储配置连接' }),
  testExisting: op.post('/{id}/test', { access: { permission: 'system:file:config' }, audit: { description: '测试文件存储连接', recordBody: false }, params: idParam, body: updateFileStorageConfigSchema, summary: '测试已保存存储配置连接' }),
  detail: op.get('/{id}', { access: { permission: 'system:file:config' }, params: idParam, response: fileStorageConfigSchema, summary: '存储配置详情' }),
  probeDraftBucketAccess: op.post('/test/bucket-access/probe', { access: { permission: 'system:file:config:create' }, body: createFileStorageConfigSchema, response: fileBucketAccessInfoSchema, summary: '探测新配置的 Bucket 访问权限' }),
  updateDraftBucketAccess: op.put('/test/bucket-access', { access: { permission: 'system:file:config:bucket-access' }, audit: { description: '修改新配置的 Bucket 访问权限', recordBody: false }, body: updateDraftFileBucketAccessSchema, response: fileBucketAccessInfoSchema, summary: '修改新配置的 Bucket 访问权限' }),
  probeBucketAccess: op.post('/{id}/bucket-access/probe', { access: { permission: 'system:file:config' }, params: idParam, response: fileBucketAccessInfoSchema, summary: '探测 Bucket 访问权限' }),
  updateBucketAccess: op.put('/{id}/bucket-access', { access: { permission: 'system:file:config:bucket-access' }, audit: '修改 Bucket 访问权限', params: idParam, body: updateFileBucketAccessSchema, response: fileBucketAccessInfoSchema, summary: '修改 Bucket 访问权限' }),
  create: op.post('/', { access: { permission: 'system:file:config:create' }, audit: '创建文件存储配置', body: createFileStorageConfigSchema, response: fileStorageConfigSchema, summary: '创建配置' }),
  update: op.put('/{id}', { access: { permission: 'system:file:config:update' }, audit: '更新文件存储配置', params: idParam, body: updateFileStorageConfigSchema, response: fileStorageConfigSchema, summary: '更新配置' }),
  setDefault: op.put('/{id}/default', { access: { permission: 'system:file:config:default' }, audit: { description: '设置默认文件存储', recordBody: false }, params: idParam, response: fileStorageConfigSchema, summary: '设为默认' }),
  remove: op.delete('/{id}', { access: { permission: 'system:file:config:delete' }, audit: '删除文件存储配置', params: idParam, summary: '删除配置' }),
}, { auditModule: '文件存储配置', tags: ['FileStorageConfigs'] });
