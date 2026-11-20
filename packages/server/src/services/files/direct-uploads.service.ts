import { and, asc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import type { z } from '@hono/zod-openapi';
import {
  countUploadChunks,
  expectedUploadChunkSize,
  FILE_DIRECT_UPLOAD_SUPPORT,
  resolveUploadChunkSize,
  UPLOAD_MAX_CHUNKS,
  type directUploadInitSchema,
  type directUploadCompleteSchema,
} from '@zenith/shared/platform';
import { db } from '../../db';
import { fileStorageConfigs, uploadChunks, uploadSessions, type UploadSessionRow } from '../../db/schema';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { buildUploadObjectKey, createDirectPartTarget, extractBucketName, getDirectMultipartDriver, mapObjectAclError, resolveObjectAcl, resolvePublicAccess, withFileBucket } from '../../lib/file-storage';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { formatDateTime } from '../../lib/datetime';
import { getSettings } from '../../lib/settings';
import { buildWhere } from '../../lib/where-helpers';
import { assertUploadSizeAllowed } from './files.service';
import { abortChunkUpload, completeChunkUpload } from './upload-sessions.service';

type DirectUploadInit = z.infer<typeof directUploadInitSchema>;
type DirectUploadComplete = z.infer<typeof directUploadCompleteSchema>;

const KODO_CHUNK_SIZE = 4 * 1024 * 1024;

async function resolveConfig(storageConfigId?: number) {
  const where = storageConfigId
    ? and(eq(fileStorageConfigs.id, storageConfigId), eq(fileStorageConfigs.status, 'enabled'))
    : and(eq(fileStorageConfigs.isDefault, true), eq(fileStorageConfigs.status, 'enabled'));
  const [config] = await db.select().from(fileStorageConfigs).where(where).limit(1);
  return requireRow(config, storageConfigId ? '文件存储配置不存在或未启用' : '当前没有可用的默认文件服务', 400);
}

async function ensureDirectSession(uploadId: string) {
  const user = currentUser();
  const where = buildWhere(eq(uploadSessions.uploadId, uploadId), eq(uploadSessions.createdBy, user.userId), tenantCondition(uploadSessions, user));
  const session = await requireFirstRow(db.select().from(uploadSessions).where(where).limit(1), '直传会话不存在或已过期');
  if (session.uploadMode !== 'browser-direct') throw new HTTPException(404, { message: '直传会话不存在或已过期' });
  return session;
}

async function getSessionConfig(session: UploadSessionRow) {
  const [config] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, session.storageConfigId)).limit(1);
  const current = requireRow(config, '文件存储配置不存在', 400);
  if (current.provider !== session.provider) throw new HTTPException(400, { message: '存储类型已变更，请重新上传' });
  return withFileBucket(session, current);
}

export async function createDirectUpload(input: DirectUploadInit) {
  const user = currentUser();
  const settings = await getSettings('files');
  await assertUploadSizeAllowed(input.fileSize, settings);
  if (settings.directUploadMaxActiveSessions > 0) {
    const activeSessions = await db.$count(uploadSessions, and(
      eq(uploadSessions.createdBy, user.userId),
      eq(uploadSessions.uploadMode, 'browser-direct'),
      inArray(uploadSessions.status, ['uploading', 'completing']),
    ));
    if (activeSessions >= settings.directUploadMaxActiveSessions) {
      throw new HTTPException(429, {
        message: `同时进行的浏览器直传会话过多（上限 ${settings.directUploadMaxActiveSessions} 个），请完成或取消后再试`,
      });
    }
  }

  const config = await resolveConfig(input.storageConfigId);
  const driver = getDirectMultipartDriver(config.provider);
  if (config.uploadMode !== 'browser-direct' || !FILE_DIRECT_UPLOAD_SUPPORT[config.provider] || !driver) {
    throw new HTTPException(400, { message: '该文件服务不支持浏览器分片直传，请使用服务端中转' });
  }

  const chunkSize = config.provider === 'kodo'
    ? KODO_CHUNK_SIZE
    : resolveUploadChunkSize(input.fileSize, settings.chunkSizeMb * 1024 * 1024);
  if (chunkSize === null) throw new HTTPException(400, { message: '文件过大，超过分片上传上限' });
  const totalChunks = countUploadChunks(input.fileSize, chunkSize);
  if (totalChunks > UPLOAD_MAX_CHUNKS) {
    throw new HTTPException(400, { message: `文件过大：超过分片上传上限（${UPLOAD_MAX_CHUNKS} 片）` });
  }

  const { objectKey } = buildUploadObjectKey(input.fileName, config.basePath);
  const uploadId = randomUUID();
  const multipartUploadId = await driver.init(config, objectKey, input.mimeType).catch((error) => { throw mapObjectAclError(error); });
  const objectAcl = resolveObjectAcl(config);
  const publicAccess = resolvePublicAccess(config, objectAcl);
  const bucketName = extractBucketName(config);

  try {
    await db.insert(uploadSessions).values({
      uploadId,
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType ?? null,
      chunkSize,
      totalChunks,
      storageConfigId: config.id,
      provider: config.provider,
      objectKey,
      bucketName,
      multipartUploadId,
      objectAcl,
      publicAccess,
      accessStrategy: config.accessStrategy,
      uploadMode: 'browser-direct',
      tenantId: getCreateTenantId(user),
    });
  } catch (error) {
    await driver.abort(config, objectKey, multipartUploadId).catch(() => {});
    throw error;
  }

  return {
    uploadId,
    provider: config.provider,
    objectKey,
    bucketName,
    chunkSize,
    totalChunks,
    received: [] as number[],
    publicAccess,
    accessStrategy: config.accessStrategy,
  };
}

export async function getDirectUploadPartUrl(uploadId: string, partNumber: number) {
  const session = await ensureDirectSession(uploadId);
  if (session.status !== 'uploading') throw new HTTPException(400, { message: '上传会话已结束' });
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > session.totalChunks) {
    throw new HTTPException(400, { message: '分片序号越界' });
  }
  if (!session.multipartUploadId) throw new HTTPException(400, { message: '分片上传会话无效' });
  const config = await getSessionConfig(session);
  const target = await createDirectPartTarget(config, session.objectKey, session.multipartUploadId,
    partNumber, config.presignedExpirySeconds || 900);
  return { partNumber, url: target.url, method: target.method, headers: target.headers, partTag: target.partTag, expiresAt: formatDateTime(target.expiresAt) };
}

export async function acknowledgeDirectUploadPart(uploadId: string, partNumber: number, input: { etag: string; size: number }) {
  const session = await ensureDirectSession(uploadId);
  if (session.status !== 'uploading') throw new HTTPException(400, { message: '上传会话已结束' });
  const index = partNumber - 1;
  if (!Number.isInteger(partNumber) || index < 0 || index >= session.totalChunks) throw new HTTPException(400, { message: '分片序号越界' });
  const expectedSize = expectedUploadChunkSize(session.fileSize, session.chunkSize, index);
  if (input.size !== expectedSize) throw new HTTPException(400, { message: `分片 ${partNumber} 大小不匹配：期望 ${expectedSize} 字节，实际 ${input.size} 字节` });
  await db.transaction(async (tx) => {
    const [locked] = await tx.select({ status: uploadSessions.status }).from(uploadSessions)
      .where(eq(uploadSessions.id, session.id)).for('update');
    if (!locked || locked.status !== 'uploading') throw new HTTPException(409, { message: '上传正在合并或会话已结束' });
    await tx.insert(uploadChunks).values({ uploadSessionId: session.id, index, size: input.size, etag: input.etag })
      .onConflictDoUpdate({ target: [uploadChunks.uploadSessionId, uploadChunks.index], set: { size: input.size, etag: input.etag, createdAt: new Date() } });
  });
  const rows = await db.select({ index: uploadChunks.index }).from(uploadChunks)
    .where(eq(uploadChunks.uploadSessionId, session.id)).orderBy(asc(uploadChunks.index));
  return { index, receivedCount: rows.length };
}

export async function getDirectUploadStatus(uploadId: string) {
  const session = await ensureDirectSession(uploadId);
  const rows = await db.select({ index: uploadChunks.index }).from(uploadChunks)
    .where(eq(uploadChunks.uploadSessionId, session.id)).orderBy(asc(uploadChunks.index));
  return { uploadId, status: session.status, chunkSize: session.chunkSize, totalChunks: session.totalChunks, received: rows.map((row) => row.index) };
}

export async function completeDirectUpload(uploadId: string, input: DirectUploadComplete) {
  await ensureDirectSession(uploadId);
  const file = await completeChunkUpload(uploadId, { expectedHash: input.contentHash, allowBrowserDirect: true });
  return file;
}

export async function abortDirectUpload(uploadId: string) {
  await ensureDirectSession(uploadId);
  await abortChunkUpload(uploadId, { allowBrowserDirect: true });
}
