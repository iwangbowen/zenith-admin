import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
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
  type FileVisibility,
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
import { assertRestrictedStorageSafe, assertUploadSizeAllowed } from './files.service';
import { abortChunkUpload, completeChunkUpload } from './upload-sessions.service';
import { unbindUploadSession } from './upload-bindings.service';
import { recordDirectUploadBytes, recordFileUploadMetric } from '../../lib/file-upload-metrics';

type DirectUploadInit = z.infer<typeof directUploadInitSchema>;
type DirectUploadComplete = z.infer<typeof directUploadCompleteSchema>;

const KODO_CHUNK_SIZE = 4 * 1024 * 1024;

/** 业务会话在直传通道上的附加属性；通用直传不传 */
export interface DirectUploadSessionOptions {
  module?: string | null;
  visibility?: FileVisibility;
  expectedHash?: string | null;
  computeHash?: boolean;
  skipTypeCheck?: boolean;
}

async function resolveConfig(storageConfigId?: number) {
  const where = storageConfigId
    ? and(eq(fileStorageConfigs.id, storageConfigId), eq(fileStorageConfigs.status, 'enabled'))
    : and(eq(fileStorageConfigs.isDefault, true), eq(fileStorageConfigs.status, 'enabled'));
  const [config] = await db.select().from(fileStorageConfigs).where(where).limit(1);
  return requireRow(config, storageConfigId ? '文件存储配置不存在或未启用' : '当前没有可用的默认文件服务', 400);
}

async function ensureOwnedSession(uploadId: string) {
  const user = currentUser();
  const where = buildWhere(eq(uploadSessions.uploadId, uploadId), eq(uploadSessions.createdBy, user.userId), tenantCondition(uploadSessions, user));
  return requireFirstRow(db.select().from(uploadSessions).where(where).limit(1), '直传会话不存在或已过期');
}

async function ensureDirectSession(uploadId: string) {
  const session = await ensureOwnedSession(uploadId);
  if (session.uploadMode !== 'browser-direct') throw new HTTPException(404, { message: '直传会话不存在或已过期' });
  return session;
}

/** 业务会话：已完成业务 init（有 module 绑定），通用直传接口不得接管 */
async function ensureBusinessSession(uploadId: string) {
  const session = await ensureOwnedSession(uploadId);
  if (!session.module) throw new HTTPException(404, { message: '上传会话不存在或已过期' });
  return session;
}

async function getSessionConfig(session: UploadSessionRow) {
  const [config] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, session.storageConfigId)).limit(1);
  const current = requireRow(config, '文件存储配置不存在', 400);
  if (current.provider !== session.provider) throw new HTTPException(400, { message: '存储类型已变更，请重新上传' });
  return withFileBucket(session, current);
}

export async function createDirectUpload(input: DirectUploadInit, options: DirectUploadSessionOptions = {}) {
  const user = currentUser();
  const settings = await getSettings('files');
  await assertUploadSizeAllowed(input.fileSize, settings);
  if (settings.directUploadMaxActiveSessions > 0) {
    const activeSessions = await db.$count(uploadSessions, and(
      eq(uploadSessions.createdBy, user.userId),
      eq(uploadSessions.uploadMode, 'browser-direct'),
      options.module ? eq(uploadSessions.module, options.module) : isNull(uploadSessions.module),
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

  // restricted 会话必须落到私有对象：强制 private ACL + proxy 访问策略
  if (options.visibility === 'restricted') assertRestrictedStorageSafe(config);
  const uploadConfig = options.visibility === 'restricted'
    ? { ...config, objectAcl: 'private' as const, accessStrategy: 'proxy' as const }
    : config;

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
  const multipartUploadId = await driver.init(uploadConfig, objectKey, input.mimeType).catch((error) => { throw mapObjectAclError(error); });
  const objectAcl = resolveObjectAcl(uploadConfig);
  const publicAccess = resolvePublicAccess(uploadConfig, objectAcl);
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
      accessStrategy: uploadConfig.accessStrategy,
      uploadMode: 'browser-direct',
      module: options.module ?? null,
      visibility: options.visibility ?? 'public',
      expectedHash: options.expectedHash?.toLowerCase() ?? null,
      computeHash: options.computeHash ?? false,
      skipTypeCheck: options.skipTypeCheck ?? false,
      tenantId: getCreateTenantId(user),
    });
  } catch (error) {
    await driver.abort(config, objectKey, multipartUploadId).catch(() => {});
    throw error;
  }
  recordFileUploadMetric('directStarted');
  recordDirectUploadBytes(input.fileSize);

  return {
    uploadId,
    mode: 'browser-direct' as const,
    provider: config.provider,
    objectKey,
    bucketName,
    chunkSize,
    totalChunks,
    received: [] as number[],
    publicAccess,
    accessStrategy: uploadConfig.accessStrategy,
  };
}

async function partUrlForSession(session: UploadSessionRow, partNumber: number) {
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

export async function getDirectUploadPartUrl(uploadId: string, partNumber: number) {
  return partUrlForSession(await ensureDirectSession(uploadId), partNumber);
}

async function acknowledgePartForSession(session: UploadSessionRow, partNumber: number, input: { etag: string; size: number }) {
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

export async function acknowledgeDirectUploadPart(uploadId: string, partNumber: number, input: { etag: string; size: number }) {
  return acknowledgePartForSession(await ensureDirectSession(uploadId), partNumber, input);
}

async function statusForSession(session: UploadSessionRow) {
  const rows = await db.select({ index: uploadChunks.index }).from(uploadChunks)
    .where(eq(uploadChunks.uploadSessionId, session.id)).orderBy(asc(uploadChunks.index));
  return { uploadId: session.uploadId, status: session.status, chunkSize: session.chunkSize, totalChunks: session.totalChunks, received: rows.map((row) => row.index) };
}

export async function getDirectUploadStatus(uploadId: string) {
  return statusForSession(await ensureDirectSession(uploadId));
}

// ─── 业务上传会话的分片通道 ──────────────────────────────────────────────────

/** 业务直传分片地址：会话必须由当前用户为某个业务模块创建 */
export async function getBusinessUploadPartUrl(uploadId: string, partNumber: number) {
  const session = await ensureBusinessSession(uploadId);
  if (session.uploadMode !== 'browser-direct') throw new HTTPException(404, { message: '该会话不是浏览器直传' });
  return partUrlForSession(session, partNumber);
}

export async function acknowledgeBusinessUploadPart(uploadId: string, partNumber: number, input: { etag: string; size: number }) {
  const session = await ensureBusinessSession(uploadId);
  if (session.uploadMode !== 'browser-direct') throw new HTTPException(404, { message: '该会话不是浏览器直传' });
  return acknowledgePartForSession(session, partNumber, input);
}

export async function getBusinessUploadStatus(uploadId: string) {
  return statusForSession(await ensureBusinessSession(uploadId));
}

export async function abortBusinessUpload(uploadId: string) {
  const session = await ensureBusinessSession(uploadId);
  await abortChunkUpload(uploadId, { allowBrowserDirect: true });
  await unbindUploadSession(session.uploadId, session.module!);
}

export async function completeDirectUpload(uploadId: string, input: DirectUploadComplete) {
  const session = await ensureDirectSession(uploadId);
  if (session.module) throw new HTTPException(400, { message: '该上传会话属于业务模块，请在业务页面完成上传' });
  try {
    const file = await completeChunkUpload(uploadId, { expectedHash: input.contentHash, allowBrowserDirect: true });
    recordFileUploadMetric('directCompleted');
    return file;
  } catch (error) {
    recordFileUploadMetric('directFailed');
    throw error;
  }
}

export async function abortDirectUpload(uploadId: string) {
  await ensureDirectSession(uploadId);
  await abortChunkUpload(uploadId, { allowBrowserDirect: true });
  recordFileUploadMetric('directAborted');
}
