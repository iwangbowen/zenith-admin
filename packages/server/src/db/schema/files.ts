import { pgTable, serial, varchar, timestamp, pgEnum, integer, bigint, boolean, unique, text, smallint, uuid as pgUuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';
import { statusEnum } from './common';
import { auditColumns, tenants } from './core';

export const fileStorageProviderEnum = pgEnum('file_storage_provider', ['local', 'oss', 's3', 'cos', 'obs', 'kodo', 'bos', 'azure', 'sftp']);

// ─── 文件存储配置表 ──────────────────────────────────────────────────────────
export const fileStorageConfigs = pgTable('file_storage_configs', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  provider: fileStorageProviderEnum('provider').notNull().default('local'),
  status: statusEnum('status').notNull().default('enabled'),
  isDefault: boolean('is_default').notNull().default(false),
  basePath: varchar('base_path', { length: 256 }),
  localRootPath: varchar('local_root_path', { length: 512 }),
  ossRegion: varchar('oss_region', { length: 64 }),
  ossEndpoint: varchar('oss_endpoint', { length: 128 }),
  ossBucket: varchar('oss_bucket', { length: 128 }),
  ossAccessKeyId: varchar('oss_access_key_id', { length: 128 }),
  ossAccessKeySecret: varchar('oss_access_key_secret', { length: 256 }),
  // S3 兼容存储（AWS S3 / MinIO / Cloudflare R2 等）
  s3Region: varchar('s3_region', { length: 64 }),
  s3Endpoint: varchar('s3_endpoint', { length: 256 }),
  s3Bucket: varchar('s3_bucket', { length: 128 }),
  s3AccessKeyId: varchar('s3_access_key_id', { length: 128 }),
  s3SecretAccessKey: varchar('s3_secret_access_key', { length: 256 }),
  s3ForcePathStyle: boolean('s3_force_path_style').default(false),
  // 腾讯云 COS
  cosRegion: varchar('cos_region', { length: 64 }),
  cosBucket: varchar('cos_bucket', { length: 128 }),
  cosSecretId: varchar('cos_secret_id', { length: 128 }),
  cosSecretKey: varchar('cos_secret_key', { length: 256 }),
  // 华为云 OBS
  obsEndpoint: varchar('obs_endpoint', { length: 256 }),
  obsBucket: varchar('obs_bucket', { length: 128 }),
  obsAccessKeyId: varchar('obs_access_key_id', { length: 128 }),
  obsSecretAccessKey: varchar('obs_secret_access_key', { length: 256 }),
  // 七牛云 Kodo
  kodoAccessKey: varchar('kodo_access_key', { length: 128 }),
  kodoSecretKey: varchar('kodo_secret_key', { length: 256 }),
  kodoBucket: varchar('kodo_bucket', { length: 128 }),
  kodoRegion: varchar('kodo_region', { length: 64 }),
  kodoEndpoint: varchar('kodo_endpoint', { length: 256 }),
  // 百度云 BOS
  bosEndpoint: varchar('bos_endpoint', { length: 256 }),
  bosBucket: varchar('bos_bucket', { length: 128 }),
  bosAccessKeyId: varchar('bos_access_key_id', { length: 128 }),
  bosSecretAccessKey: varchar('bos_secret_access_key', { length: 256 }),
  // Azure Blob Storage
  azureAccountName: varchar('azure_account_name', { length: 128 }),
  azureAccountKey: varchar('azure_account_key', { length: 256 }),
  azureContainerName: varchar('azure_container_name', { length: 128 }),
  azureEndpoint: varchar('azure_endpoint', { length: 256 }),
  // SFTP
  sftpHost: varchar('sftp_host', { length: 256 }),
  sftpPort: integer('sftp_port').default(22),
  sftpUsername: varchar('sftp_username', { length: 128 }),
  sftpPassword: varchar('sftp_password', { length: 256 }),
  sftpPrivateKey: text('sftp_private_key'),
  sftpRootPath: varchar('sftp_root_path', { length: 512 }),
  sftpBaseUrl: varchar('sftp_base_url', { length: 512 }),
  remark: varchar('remark', { length: 256 }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type FileStorageConfigRow = typeof fileStorageConfigs.$inferSelect;

export type NewFileStorageConfig = typeof fileStorageConfigs.$inferInsert;

// ─── 文件记录表 ──────────────────────────────────────────────────────────────
export const managedFiles = pgTable('managed_files', {
  id: pgUuid('id').primaryKey().$defaultFn(() => uuidv7()),
  storageConfigId: integer('storage_config_id').notNull().references(() => fileStorageConfigs.id, { onDelete: 'restrict' }),
  storageName: varchar('storage_name', { length: 64 }).notNull(),
  provider: fileStorageProviderEnum('provider').notNull(),
  originalName: varchar('original_name', { length: 256 }).notNull(),
  objectKey: varchar('object_key', { length: 512 }).notNull(),
  bucketName: varchar('bucket_name', { length: 256 }),
  size: integer('size').notNull().default(0),
  mimeType: varchar('mime_type', { length: 128 }),
  extension: varchar('extension', { length: 32 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type ManagedFileRow = typeof managedFiles.$inferSelect;

export type NewManagedFile = typeof managedFiles.$inferInsert;

// ─── 分片上传会话表 ──────────────────────────────────────────────────────────
export const uploadSessionStatusEnum = pgEnum('upload_session_status', ['uploading', 'completed', 'aborted']);

export const uploadSessions = pgTable('upload_sessions', {
  id: serial('id').primaryKey(),
  uploadId: varchar('upload_id', { length: 64 }).notNull().unique(),
  fileName: varchar('file_name', { length: 256 }).notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  mimeType: varchar('mime_type', { length: 128 }),
  chunkSize: integer('chunk_size').notNull(),
  totalChunks: integer('total_chunks').notNull(),
  storageConfigId: integer('storage_config_id').notNull().references(() => fileStorageConfigs.id, { onDelete: 'cascade' }),
  provider: fileStorageProviderEnum('provider').notNull(),
  objectKey: varchar('object_key', { length: 512 }).notNull(),
  bucketName: varchar('bucket_name', { length: 256 }),
  // 云原生 multipart 的 uploadId；local/sftp 及回退暂存为 null
  multipartUploadId: varchar('multipart_upload_id', { length: 512 }),
  status: uploadSessionStatusEnum('status').notNull().default('uploading'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type UploadSessionRow = typeof uploadSessions.$inferSelect;

export type NewUploadSession = typeof uploadSessions.$inferInsert;

/** 已上传分片记录；index 从 0 计，etag 供云原生 multipart 使用，唯一约束保证并发幂等 */
export const uploadChunks = pgTable('upload_chunks', {
  id: serial('id').primaryKey(),
  uploadSessionId: integer('upload_session_id').notNull().references(() => uploadSessions.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  size: integer('size').notNull(),
  etag: varchar('etag', { length: 256 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique('uniq_upload_chunk').on(t.uploadSessionId, t.index),
]);

export type UploadChunkRow = typeof uploadChunks.$inferSelect;

export type NewUploadChunk = typeof uploadChunks.$inferInsert;

// ─── 业务文件关联表（通用，多态关联）─────────────────────────────────────────
export const businessTypeEnum = pgEnum('business_type', ['announcement']);

export const businessFiles = pgTable('business_files', {
  id: serial('id').primaryKey(),
  businessType: businessTypeEnum('business_type').notNull(),
  businessId: integer('business_id').notNull(),
  fileId: pgUuid('file_id').notNull().references(() => managedFiles.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 256 }),
  category: varchar('category', { length: 64 }),
  sortOrder: smallint('sort_order').default(0),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique('uniq_business_file').on(t.businessType, t.businessId, t.fileId),
]);

export type BusinessFileRow = typeof businessFiles.$inferSelect;

export type NewBusinessFile = typeof businessFiles.$inferInsert;
