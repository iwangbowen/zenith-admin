import { pgTable, varchar, timestamp, pgEnum, integer, bigint, boolean, unique, text, smallint, uuid as pgUuid, index } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { statusEnum } from './common';
import { auditColumns, tenants } from './core';

export const fileStorageProviderEnum = pgEnum('file_storage_provider', ['local', 'oss', 's3', 'cos', 'obs', 'kodo', 'bos', 'azure', 'sftp']);

/** 对象读写权限（canned ACL）；default = 继承 Bucket（上传时不发送 ACL 参数） */
export const fileObjectAclEnum = pgEnum('file_object_acl', ['default', 'private', 'public-read', 'public-read-write']);

/** 文件访问 URL 策略：proxy=服务端代理（兜底）；public=永久公开直链；presigned=临时签名直链 */
export const fileUrlStrategyEnum = pgEnum('file_url_strategy', ['proxy', 'public', 'presigned']);

/**
 * 托管文件可见性：public=持有文件 ID 即可经 `fileContract.content` 读取（附件、头像等）；
 * restricted=仅归属模块（如企业网盘）经自身鉴权接口读取，通用内容接口一律 404。
 */
export const fileVisibilityEnum = pgEnum('file_visibility', ['public', 'restricted']);

// ─── 文件存储配置表 ──────────────────────────────────────────────────────────
export const fileStorageConfigs = pgTable('file_storage_configs', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  provider: fileStorageProviderEnum().notNull().default('local'),
  status: statusEnum().notNull().default('enabled'),
  isDefault: boolean().notNull().default(false),
  basePath: varchar({ length: 256 }),
  // 上传对象的读写权限，仅 oss/s3/cos/obs/bos 生效
  objectAcl: fileObjectAclEnum().notNull().default('default'),
  // 文件访问 URL 策略
  urlStrategy: fileUrlStrategyEnum().notNull().default('proxy'),
  // 自定义访问域名（CDN/加速域名），public 策略优先使用
  publicBaseUrl: varchar({ length: 512 }),
  // 临时签名有效期（秒）
  presignedExpirySeconds: integer().notNull().default(1800),
  localRootPath: varchar({ length: 512 }),
  ossRegion: varchar({ length: 64 }),
  ossEndpoint: varchar({ length: 128 }),
  ossBucket: varchar({ length: 128 }),
  ossAccessKeyId: varchar({ length: 128 }),
  ossAccessKeySecret: varchar({ length: 256 }),
  // S3 兼容存储（AWS S3 / MinIO / Cloudflare R2 等）
  s3Region: varchar({ length: 64 }),
  s3Endpoint: varchar({ length: 256 }),
  s3Bucket: varchar({ length: 128 }),
  s3AccessKeyId: varchar({ length: 128 }),
  s3SecretAccessKey: varchar({ length: 256 }),
  s3ForcePathStyle: boolean().default(false),
  // 腾讯云 COS
  cosRegion: varchar({ length: 64 }),
  cosBucket: varchar({ length: 128 }),
  cosSecretId: varchar({ length: 128 }),
  cosSecretKey: varchar({ length: 256 }),
  // 华为云 OBS
  obsEndpoint: varchar({ length: 256 }),
  obsBucket: varchar({ length: 128 }),
  obsAccessKeyId: varchar({ length: 128 }),
  obsSecretAccessKey: varchar({ length: 256 }),
  // 七牛云 Kodo
  kodoAccessKey: varchar({ length: 128 }),
  kodoSecretKey: varchar({ length: 256 }),
  kodoBucket: varchar({ length: 128 }),
  kodoRegion: varchar({ length: 64 }),
  kodoEndpoint: varchar({ length: 256 }),
  // 百度云 BOS
  bosEndpoint: varchar({ length: 256 }),
  bosBucket: varchar({ length: 128 }),
  bosAccessKeyId: varchar({ length: 128 }),
  bosSecretAccessKey: varchar({ length: 256 }),
  // Azure Blob Storage
  azureAccountName: varchar({ length: 128 }),
  azureAccountKey: varchar({ length: 256 }),
  azureContainerName: varchar({ length: 128 }),
  azureEndpoint: varchar({ length: 256 }),
  // SFTP
  sftpHost: varchar({ length: 256 }),
  sftpPort: integer().default(22),
  sftpUsername: varchar({ length: 128 }),
  sftpPassword: varchar({ length: 256 }),
  sftpPrivateKey: text(),
  sftpRootPath: varchar({ length: 512 }),
  sftpBaseUrl: varchar({ length: 512 }),
  remark: varchar({ length: 256 }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type FileStorageConfigRow = typeof fileStorageConfigs.$inferSelect;

export type NewFileStorageConfig = typeof fileStorageConfigs.$inferInsert;

// ─── 文件记录表 ──────────────────────────────────────────────────────────────
export const managedFiles = pgTable('managed_files', {
  id: pgUuid().primaryKey().$defaultFn(() => uuidv7()),
  storageConfigId: integer().notNull().references(() => fileStorageConfigs.id, { onDelete: 'restrict' }),
  storageName: varchar({ length: 64 }).notNull(),
  provider: fileStorageProviderEnum().notNull(),
  originalName: varchar({ length: 256 }).notNull(),
  objectKey: varchar({ length: 512 }).notNull(),
  bucketName: varchar({ length: 256 }),
  size: bigint({ mode: 'number' }).notNull().default(0),
  mimeType: varchar({ length: 128 }),
  extension: varchar({ length: 32 }),
  // 上传时实际发送的对象 ACL 快照；null = 继承 Bucket（公开性未知）
  objectAcl: fileObjectAclEnum(),
  visibility: fileVisibilityEnum().notNull().default('public'),
  /** 内容 SHA-256（hex）；由归属模块按需写入，用于秒传 / 去重，null = 未计算 */
  contentHash: varchar({ length: 64 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  index('managed_files_tenant_idx').on(t.tenantId),
  index('managed_files_content_hash_idx').on(t.tenantId, t.contentHash),
]);

export type ManagedFileRow = typeof managedFiles.$inferSelect;

export type NewManagedFile = typeof managedFiles.$inferInsert;

// ─── 分片上传会话表 ──────────────────────────────────────────────────────────
export const uploadSessionStatusEnum = pgEnum('upload_session_status', ['uploading', 'completed', 'aborted']);

export const uploadSessions = pgTable('upload_sessions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  uploadId: varchar({ length: 64 }).notNull().unique('upload_sessions_upload_id_unique'),
  fileName: varchar({ length: 256 }).notNull(),
  fileSize: bigint({ mode: 'number' }).notNull(),
  mimeType: varchar({ length: 128 }),
  chunkSize: integer().notNull(),
  totalChunks: integer().notNull(),
  storageConfigId: integer().notNull().references(() => fileStorageConfigs.id, { onDelete: 'cascade' }),
  provider: fileStorageProviderEnum().notNull(),
  objectKey: varchar({ length: 512 }).notNull(),
  bucketName: varchar({ length: 256 }),
  // 云原生 multipart 的 uploadId；local/sftp 及回退暂存为 null
  multipartUploadId: varchar({ length: 512 }),
  // 初始化时实际发送的对象 ACL 快照，完成上传时拷贝到 managed_files
  objectAcl: fileObjectAclEnum(),
  status: uploadSessionStatusEnum().notNull().default('uploading'),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [index('upload_sessions_tenant_idx').on(t.tenantId), 
  index('upload_sessions_created_at_idx').on(t.createdAt),
  index('upload_sessions_status_idx').on(t.status),
]);

export type UploadSessionRow = typeof uploadSessions.$inferSelect;

export type NewUploadSession = typeof uploadSessions.$inferInsert;

/** 已上传分片记录；index 从 0 计，etag 供云原生 multipart 使用，唯一约束保证并发幂等 */
export const uploadChunks = pgTable('upload_chunks', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  uploadSessionId: integer().notNull().references(() => uploadSessions.id, { onDelete: 'cascade' }),
  index: integer().notNull(),
  size: integer().notNull(),
  etag: varchar({ length: 256 }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  unique('uniq_upload_chunk').on(t.uploadSessionId, t.index),
]);

export type UploadChunkRow = typeof uploadChunks.$inferSelect;

export type NewUploadChunk = typeof uploadChunks.$inferInsert;

// ─── 业务文件关联表（通用，多态关联）─────────────────────────────────────────
export const businessTypeEnum = pgEnum('business_type', ['announcement', 'wiki_doc']);

export const businessFiles = pgTable('business_files', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  businessType: businessTypeEnum().notNull(),
  businessId: integer().notNull(),
  fileId: pgUuid().notNull().references(() => managedFiles.id, { onDelete: 'cascade' }),
  name: varchar({ length: 256 }),
  category: varchar({ length: 64 }),
  sortOrder: smallint().default(0),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [index('business_files_tenant_idx').on(t.tenantId), 
  unique('uniq_business_file').on(t.businessType, t.businessId, t.fileId),
]);

export type BusinessFileRow = typeof businessFiles.$inferSelect;

export type NewBusinessFile = typeof businessFiles.$inferInsert;
