import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import type { z } from '@hono/zod-openapi';
import type { directUploadInitSchema, directUploadCompleteSchema } from '@zenith/shared/platform';
import { db } from '../../db';
import { fileStorageConfigs, managedFiles, uploadSessions } from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { getCreateTenantId } from '../../lib/tenant';
import { formatDateTime } from '../../lib/datetime';
import {
  applyObjectAcl,
  buildUploadObjectKey,
  createDirectUploadTarget,
  deleteObjectByConfig,
  extractBucketName,
  headStoredObject,
  resolveObjectAcl,
  resolvePublicAccess,
} from '../../lib/file-storage';

type DirectUploadInit = z.infer<typeof directUploadInitSchema>;
type DirectUploadComplete = z.infer<typeof directUploadCompleteSchema>;

async function resolveConfig(storageConfigId?: number) {
  const where = storageConfigId
    ? and(eq(fileStorageConfigs.id, storageConfigId), eq(fileStorageConfigs.status, 'enabled'))
    : and(eq(fileStorageConfigs.isDefault, true), eq(fileStorageConfigs.status, 'enabled'));
  const [config] = await db.select().from(fileStorageConfigs).where(where).limit(1);
  return requireRow(config, storageConfigId ? '文件存储配置不存在或未启用' : '当前没有可用的默认文件服务', 400);
}

export async function createDirectUpload(input: DirectUploadInit) {
  const user = currentUser();
  const config = await resolveConfig(input.storageConfigId);
  if (config.uploadMode !== 'browser-direct') {
    throw new HTTPException(400, { message: '该文件服务未开启浏览器直传，请使用服务端上传' });
  }
  const objectKey = buildUploadObjectKey(input.fileName, config.basePath).objectKey;
  const expirySeconds = config.presignedExpirySeconds || 900;
  const target = await createDirectUploadTarget(config, objectKey, input.mimeType, expirySeconds);
  const objectAcl = resolveObjectAcl(config);
  const publicAccess = resolvePublicAccess(config, objectAcl);
  const uploadId = randomUUID();

  await db.insert(uploadSessions).values({
    uploadId,
    fileName: input.fileName,
    fileSize: input.fileSize,
    mimeType: input.mimeType ?? null,
    chunkSize: input.fileSize,
    totalChunks: 1,
    storageConfigId: config.id,
    provider: config.provider,
    objectKey,
    bucketName: extractBucketName(config),
    multipartUploadId: null,
    objectAcl,
    publicAccess,
    accessStrategy: config.accessStrategy,
    uploadMode: config.uploadMode,
    tenantId: getCreateTenantId(user),
  });

  return {
    uploadId,
    provider: config.provider,
    objectKey,
    bucketName: extractBucketName(config),
    uploadUrl: target.url,
    method: 'PUT' as const,
    headers: target.headers,
    expiresAt: formatDateTime(target.expiresAt),
    publicAccess,
    accessStrategy: config.accessStrategy,
  };
}

export async function completeDirectUpload(uploadId: string, input: DirectUploadComplete) {
  const [session] = await db.select().from(uploadSessions).where(eq(uploadSessions.uploadId, uploadId)).limit(1);
  const current = requireRow(session, '直传会话不存在', 404);
  if (current.status !== 'uploading') {
    throw new HTTPException(400, { message: current.status === 'completed' ? '直传会话已完成' : '直传会话已结束' });
  }
  const [config] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, current.storageConfigId)).limit(1);
  const storage = requireRow(config, '文件存储配置不存在', 400);
  const head = await headStoredObject(storage, current.objectKey);
  const expectedSize = input.size ?? current.fileSize;
  if (head.size !== expectedSize) {
    throw new HTTPException(400, { message: `对象大小校验失败（期望 ${expectedSize}，实际 ${head.size}）` });
  }
  if (current.mimeType && head.mimeType && !head.mimeType.toLowerCase().startsWith(current.mimeType.toLowerCase())) {
    throw new HTTPException(400, { message: `对象类型校验失败（期望 ${current.mimeType}，实际 ${head.mimeType}）` });
  }
  if (input.etag) {
    const normalize = (value: string) => value.replaceAll('"', '');
    if (head.etag && normalize(head.etag) !== normalize(input.etag)) {
      throw new HTTPException(400, { message: '对象 ETag 校验失败' });
    }
  }

  const objectAcl = resolveObjectAcl(storage);
  if (storage.accessStrategy === 'public-object' && objectAcl) {
    await applyObjectAcl(storage, current.objectKey, objectAcl);
  }
  const publicAccess = resolvePublicAccess(storage, objectAcl);
  const extension = current.fileName.includes('.')
    ? current.fileName.slice(current.fileName.lastIndexOf('.') + 1).toLowerCase()
    : undefined;

  const [created] = await db.transaction(async (tx) => {
    const [row] = await tx.insert(managedFiles).values({
      storageConfigId: storage.id,
      storageName: storage.name,
      provider: storage.provider,
      originalName: current.fileName,
      objectKey: current.objectKey,
      bucketName: current.bucketName,
      size: head.size,
      mimeType: head.mimeType ?? current.mimeType,
      extension,
      objectAcl,
      publicAccess,
      accessStrategy: storage.accessStrategy,
      visibility: 'public',
      gcState: 'live',
      contentHash: input.contentHash ?? null,
      tenantId: current.tenantId,
    }).returning();
    await tx.update(uploadSessions).set({ status: 'completed' }).where(eq(uploadSessions.id, current.id));
    return [row] as const;
  });
  return created;
}

export async function abortDirectUpload(uploadId: string) {
  const [session] = await db.select().from(uploadSessions).where(eq(uploadSessions.uploadId, uploadId)).limit(1);
  const current = requireRow(session, '直传会话不存在', 404);
  if (current.status !== 'uploading') return;
  const [config] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, current.storageConfigId)).limit(1);
  if (config) await deleteObjectByConfig(config, current.objectKey).catch(() => { /* 对象可能尚未上传 */ });
  await db.update(uploadSessions).set({ status: 'aborted' }).where(eq(uploadSessions.id, current.id));
}
