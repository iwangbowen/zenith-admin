import { randomUUID } from 'node:crypto';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { and, asc, eq, lt } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { InitChunkUploadInput } from '@zenith/shared';
import { db } from '../db';
import { uploadSessions, uploadChunks, managedFiles, fileStorageConfigs } from '../db/schema';
import { buildUploadObjectKey, uploadObjectByConfig, extractBucketName, getMultipartDriver } from '../lib/file-storage';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { currentUser } from '../lib/context';
import { getConfigNumber } from '../lib/system-config';
import { assertUploadSizeAllowed, assertUploadTypeAllowed, mapManagedFile } from './files.service';

const UPLOAD_TEMP_ROOT = path.resolve(process.cwd(), 'storage/tmp/uploads');

function sessionTempDir(uploadId: string) {
  return path.join(UPLOAD_TEMP_ROOT, uploadId);
}

function chunkPath(uploadId: string, index: number) {
  return path.join(sessionTempDir(uploadId), String(index));
}

async function ensureSession(uploadId: string) {
  const user = currentUser();
  const tc = tenantCondition(uploadSessions, user);
  const where = tc ? and(eq(uploadSessions.uploadId, uploadId), tc) : eq(uploadSessions.uploadId, uploadId);
  const [session] = await db.select().from(uploadSessions).where(where).limit(1);
  if (!session) throw new HTTPException(404, { message: '上传会话不存在或已过期' });
  return session;
}

async function getReceivedIndices(sessionId: number): Promise<number[]> {
  const rows = await db
    .select({ index: uploadChunks.index })
    .from(uploadChunks)
    .where(eq(uploadChunks.uploadSessionId, sessionId))
    .orderBy(asc(uploadChunks.index));
  return rows.map((r) => r.index);
}

async function cleanupSession(uploadId: string) {
  await fs.rm(sessionTempDir(uploadId), { recursive: true, force: true });
}

/** 统计某个临时目录下所有分片文件的总字节数（用于清理统计） */
async function dirSize(dir: string): Promise<number> {
  try {
    const files = await fs.readdir(dir);
    let total = 0;
    for (const f of files) {
      try { total += (await fs.stat(path.join(dir, f))).size; } catch { /* 忽略单个文件 stat 失败 */ }
    }
    return total;
  } catch {
    return 0;
  }
}

async function getSessionConfig(storageConfigId: number) {
  const [config] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, storageConfigId)).limit(1);
  if (!config) throw new HTTPException(400, { message: '存储配置不存在' });
  return config;
}

export async function initChunkUpload(input: InitChunkUploadInput) {
  const user = currentUser();
  await assertUploadSizeAllowed(input.fileSize);

  const [defaultConfig] = await db
    .select()
    .from(fileStorageConfigs)
    .where(and(eq(fileStorageConfigs.isDefault, true), eq(fileStorageConfigs.status, 'enabled')))
    .limit(1);
  if (!defaultConfig) throw new HTTPException(400, { message: '当前没有可用的默认文件服务，请先在文件配置中启用并设置默认服务' });

  const { objectKey } = buildUploadObjectKey(input.fileName, defaultConfig.basePath);
  const totalChunks = Math.max(1, Math.ceil(input.fileSize / input.chunkSize));
  const uploadId = randomUUID();

  // 云原生 multipart：先在云端初始化拿到 multipartUploadId；否则走本地暂存
  const driver = getMultipartDriver(defaultConfig.provider);
  const multipartUploadId = driver
    ? await driver.init(defaultConfig, objectKey, input.mimeType ?? undefined)
    : null;

  await db.insert(uploadSessions).values({
    uploadId,
    fileName: input.fileName,
    fileSize: input.fileSize,
    mimeType: input.mimeType ?? null,
    chunkSize: input.chunkSize,
    totalChunks,
    storageConfigId: defaultConfig.id,
    provider: defaultConfig.provider,
    objectKey,
    bucketName: extractBucketName(defaultConfig),
    multipartUploadId,
    tenantId: getCreateTenantId(user),
  });
  if (!driver) await fs.mkdir(sessionTempDir(uploadId), { recursive: true });

  return { uploadId, chunkSize: input.chunkSize, totalChunks, received: [] as number[] };
}

export async function uploadChunk(uploadId: string, index: number, chunk: File) {
  const session = await ensureSession(uploadId);
  if (session.status !== 'uploading') throw new HTTPException(400, { message: '上传会话已结束' });
  if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
    throw new HTTPException(400, { message: '分片序号越界' });
  }

  const driver = getMultipartDriver(session.provider);
  if (driver && session.multipartUploadId) {
    // 云原生 multipart：分片直传云端，记录 ETag（首片做真实类型校验，快速失败）
    const body = Buffer.from(await chunk.arrayBuffer());
    if (index === 0) await assertUploadTypeAllowed(body.subarray(0, 4100), session.mimeType ?? '');
    const config = await getSessionConfig(session.storageConfigId);
    const etag = await driver.uploadPart(config, session.objectKey, session.multipartUploadId, index + 1, body);
    await db
      .insert(uploadChunks)
      .values({ uploadSessionId: session.id, index, size: body.length, etag })
      .onConflictDoUpdate({ target: [uploadChunks.uploadSessionId, uploadChunks.index], set: { size: body.length, etag } });
    return { index, received: await getReceivedIndices(session.id) };
  }

  // 本地暂存：流式写入临时分片文件，不整片进内存
  const dest = chunkPath(uploadId, index);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(chunk.stream() as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest));
  const size = (await fs.stat(dest)).size;

  // 幂等记录已收分片，唯一约束保证并发安全
  await db
    .insert(uploadChunks)
    .values({ uploadSessionId: session.id, index, size })
    .onConflictDoUpdate({ target: [uploadChunks.uploadSessionId, uploadChunks.index], set: { size } });

  const received = await getReceivedIndices(session.id);
  return { index, received };
}

export async function getUploadStatus(uploadId: string) {
  const session = await ensureSession(uploadId);
  const received = await getReceivedIndices(session.id);
  return { uploadId, status: session.status, chunkSize: session.chunkSize, totalChunks: session.totalChunks, received };
}

/** 按序拼接各分片临时文件为单一可读流，逐片流式读取（内存占用受单片大小限制） */
async function* mergedChunkStream(uploadId: string, totalChunks: number) {
  for (let i = 0; i < totalChunks; i++) {
    yield* createReadStream(chunkPath(uploadId, i));
  }
}

export async function completeChunkUpload(uploadId: string) {
  const user = currentUser();
  const session = await ensureSession(uploadId);
  if (session.status === 'completed') throw new HTTPException(400, { message: '上传已完成' });

  const received = await getReceivedIndices(session.id);
  if (received.length !== session.totalChunks) {
    throw new HTTPException(400, { message: `分片不完整：已接收 ${received.length}/${session.totalChunks}` });
  }

  const config = await getSessionConfig(session.storageConfigId);
  const driver = getMultipartDriver(session.provider);

  if (driver && session.multipartUploadId) {
    // 云原生 multipart：用各分片 ETag 完成合并（类型校验已在首片上传时完成）
    const chunkRows = await db
      .select()
      .from(uploadChunks)
      .where(eq(uploadChunks.uploadSessionId, session.id))
      .orderBy(asc(uploadChunks.index));
    const parts = chunkRows.map((r) => ({ partNumber: r.index + 1, etag: r.etag ?? '' }));
    await driver.complete(config, session.objectKey, session.multipartUploadId, parts, session.mimeType ?? undefined);
  } else {
    // 本地暂存：首片真实类型校验 + 按序流式合并上传
    const head = await fs.readFile(chunkPath(uploadId, 0));
    await assertUploadTypeAllowed(head.subarray(0, 4100), session.mimeType ?? '');
    const mergedStream = Readable.from(mergedChunkStream(uploadId, session.totalChunks));
    await uploadObjectByConfig(config, {
      objectKey: session.objectKey,
      stream: mergedStream,
      size: session.fileSize,
      mimeType: session.mimeType ?? undefined,
    });
  }

  const extension = path.extname(session.fileName).replace('.', '').toLowerCase() || null;
  const [created] = await db
    .insert(managedFiles)
    .values({
      storageConfigId: config.id,
      storageName: config.name,
      provider: config.provider,
      originalName: session.fileName,
      objectKey: session.objectKey,
      bucketName: session.bucketName,
      size: session.fileSize,
      mimeType: session.mimeType,
      extension,
      tenantId: getCreateTenantId(user),
    })
    .returning();

  await db.update(uploadSessions).set({ status: 'completed' }).where(eq(uploadSessions.id, session.id));
  await cleanupSession(uploadId);

  return mapManagedFile(created);
}

export async function abortChunkUpload(uploadId: string) {
  const session = await ensureSession(uploadId);
  const driver = getMultipartDriver(session.provider);
  if (driver && session.multipartUploadId) {
    const config = await getSessionConfig(session.storageConfigId);
    await driver.abort(config, session.objectKey, session.multipartUploadId).catch(() => { /* 忽略云端中止失败 */ });
  }
  await db.update(uploadSessions).set({ status: 'aborted' }).where(eq(uploadSessions.id, session.id));
  await cleanupSession(uploadId);
}

/**
 * 清理过期的分片上传会话（定时任务）：
 * 1. 删除创建时间超过 TTL 的会话（任意状态），级联删除 upload_chunks 并移除临时目录；
 * 2. 扫描临时根目录，删除无活跃会话对应、且修改时间超过 TTL 的孤儿目录（mtime 校验避免误删进行中上传）。
 */
export async function cleanupStaleUploadSessions(): Promise<{ staleSessions: number; orphanDirs: number; freedBytes: number }> {
  const ttlHours = await getConfigNumber('upload_session_ttl_hours', 24);
  const cutoff = new Date(Date.now() - ttlHours * 3600 * 1000);
  let freedBytes = 0;

  // 1. 过期会话：中止云端 multipart（如有）→ 删临时目录 → 删 DB 行（级联删 upload_chunks）
  const stale = await db
    .select({
      uploadId: uploadSessions.uploadId,
      provider: uploadSessions.provider,
      multipartUploadId: uploadSessions.multipartUploadId,
      objectKey: uploadSessions.objectKey,
      storageConfigId: uploadSessions.storageConfigId,
    })
    .from(uploadSessions)
    .where(lt(uploadSessions.createdAt, cutoff));
  for (const s of stale) {
    const driver = getMultipartDriver(s.provider);
    if (driver && s.multipartUploadId) {
      const [config] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, s.storageConfigId)).limit(1);
      if (config) await driver.abort(config, s.objectKey, s.multipartUploadId).catch(() => { /* 忽略云端中止失败 */ });
    }
    freedBytes += await dirSize(sessionTempDir(s.uploadId));
    await cleanupSession(s.uploadId);
  }
  if (stale.length > 0) {
    await db.delete(uploadSessions).where(lt(uploadSessions.createdAt, cutoff));
  }

  // 2. 孤儿临时目录：磁盘上存在但无对应会话、且修改时间已超过 TTL
  const activeIds = new Set(
    (await db.select({ uploadId: uploadSessions.uploadId }).from(uploadSessions)).map((r) => r.uploadId),
  );
  let orphanDirs = 0;
  try {
    const entries = await fs.readdir(UPLOAD_TEMP_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || activeIds.has(entry.name)) continue;
      const dirPath = path.join(UPLOAD_TEMP_ROOT, entry.name);
      const st = await fs.stat(dirPath).catch(() => null);
      if (!st || st.mtimeMs >= cutoff.getTime()) continue; // 太新，可能正在上传，跳过
      freedBytes += await dirSize(dirPath);
      await fs.rm(dirPath, { recursive: true, force: true });
      orphanDirs++;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  return { staleSessions: stale.length, orphanDirs, freedBytes };
}
