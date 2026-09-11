import { requireRow } from '../../lib/db-assert';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { and, asc, eq, gte, inArray, lt, notExists, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { countUploadChunks, expectedUploadChunkSize, resolveUploadChunkSize, UPLOAD_CHUNK_MAX_BYTES, UPLOAD_MAX_CHUNKS, type InitChunkUploadInput } from '@zenith/shared/platform';
import { db } from '../../db';
import { uploadSessions, uploadChunks, managedFiles, fileStorageConfigs, type FileStorageConfigRow, type UploadSessionRow } from '../../db/schema';
import { buildUploadObjectKey, uploadObjectByConfig, extractBucketName, getMultipartDriver, mapObjectAclError, resolveObjectAcl, readStoredFile, deleteObjectByConfig } from '../../lib/file-storage';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { currentUser } from '../../lib/context';
import { config } from '../../config';
import { getSettings } from '../../lib/settings';
import { assertUploadSizeAllowed, assertUploadTypeAllowed, mapManagedFile, type ManagedFileUploadOptions } from './files.service';
import { buildWhere } from '../../lib/where-helpers';

/** 完成分片上传时归属模块可指定的属性 */
export interface ChunkUploadCompleteOptions extends Pick<ManagedFileUploadOptions, 'visibility' | 'skipTypeCheck'> {
  /**
   * 客户端预先声明的内容 SHA-256（hex）。提供时服务端按实际落地内容重新计算并比对：
   * 一致才写入 `managed_files.contentHash` 参与秒传 / 去重，不一致则中止会话；不提供则不记录哈希。
   */
  expectedHash?: string | null;
  /** 无客户端声明值时也由服务端计算 SHA-256 并写入 `contentHash`（制品 / 固件等需要服务端可信摘要的模块） */
  computeHash?: boolean;
}

/**
 * 本地暂存根目录（UPLOAD_TEMP_DIR，默认 storage/tmp/uploads）。只有 local / kodo / sftp 走此路径；
 * 云原生 multipart 的分片直传云端，不落本地。多实例部署时该目录必须为共享卷，见 docs/guide/deployment.md。
 */
const UPLOAD_TEMP_ROOT = config.uploadTempDir;

function sessionTempDir(uploadId: string) {
  return path.join(UPLOAD_TEMP_ROOT, uploadId);
}

function chunkPath(uploadId: string, index: number) {
  return path.join(sessionTempDir(uploadId), String(index));
}

async function ensureSession(uploadId: string) {
  const user = currentUser();
  const tc = tenantCondition(uploadSessions, user);
  const where = buildWhere(eq(uploadSessions.uploadId, uploadId), tc);
  const [session] = await db.select().from(uploadSessions).where(where).limit(1);
  return requireRow(session, '上传会话不存在或已过期');
}

async function getReceivedIndices(sessionId: number): Promise<number[]> {
  const rows = await db
    .select({ index: uploadChunks.index })
    .from(uploadChunks)
    .where(eq(uploadChunks.uploadSessionId, sessionId))
    .orderBy(asc(uploadChunks.index));
  return rows.map((r) => r.index);
}

function countReceivedChunks(sessionId: number) {
  return db.$count(uploadChunks, eq(uploadChunks.uploadSessionId, sessionId));
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
  const [maybeConfig] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, storageConfigId)).limit(1);
  const config = requireRow(maybeConfig, '存储配置不存在', 400);
  return config;
}

async function abortCloudMultipart(
  session: Pick<UploadSessionRow, 'provider' | 'multipartUploadId' | 'objectKey'>,
  config: FileStorageConfigRow | null | undefined,
) {
  const driver = getMultipartDriver(session.provider);
  if (!driver || !session.multipartUploadId || !config) return;
  await driver.abort(config, session.objectKey, session.multipartUploadId).catch(() => { /* 忽略云端中止失败 */ });
}

/** 中止会话：中止云端 multipart（尚未合并时）、删除本地临时分片、状态置 aborted */
async function abortSession(session: UploadSessionRow, config: FileStorageConfigRow | null | undefined, opts: { multipartCompleted?: boolean } = {}) {
  if (!opts.multipartCompleted) await abortCloudMultipart(session, config);
  await db.update(uploadSessions).set({ status: 'aborted' }).where(eq(uploadSessions.id, session.id));
  await cleanupSession(session.uploadId);
}

/** 标记「会话已被本次 complete 置为 aborted」的错误，complete 的兜底回滚据此跳过 */
const SESSION_ABORTED = Symbol('upload-session-aborted');
function markSessionAborted<T>(err: T): T {
  if (typeof err === 'object' && err !== null) Object.defineProperty(err, SESSION_ABORTED, { value: true });
  return err;
}
function isSessionAbortedError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && SESSION_ABORTED in err;
}

/** 会话遇到不可恢复的校验失败：先中止再抛 400，避免客户端拿着「已完整」的分片反复 complete */
async function failSession(session: UploadSessionRow, config: FileStorageConfigRow, message: string, opts: { multipartCompleted?: boolean } = {}): Promise<never> {
  await abortSession(session, config, opts);
  throw markSessionAborted(new HTTPException(400, { message }));
}

/** 按序拼接各分片临时文件为单一可读流，逐片流式读取（内存占用受单片大小限制） */
async function* mergedChunkStream(uploadId: string, totalChunks: number) {
  for (let i = 0; i < totalChunks; i++) {
    yield* createReadStream(chunkPath(uploadId, i));
  }
}

async function sha256OfChunkFiles(uploadId: string, totalChunks: number) {
  const hash = createHash('sha256');
  for await (const part of mergedChunkStream(uploadId, totalChunks)) hash.update(part as Buffer);
  return hash.digest('hex');
}

/** 分片已直传云端，服务端没有完整内容：合并后读回一遍计算哈希 */
async function sha256OfStoredObject(session: UploadSessionRow, config: FileStorageConfigRow) {
  const { stream } = await readStoredFile({
    objectKey: session.objectKey,
    bucketName: session.bucketName,
    provider: session.provider,
    mimeType: session.mimeType,
    originalName: session.fileName,
  }, config);
  const hash = createHash('sha256');
  for await (const part of Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0])) hash.update(part as Buffer);
  return hash.digest('hex');
}

const HASH_MISMATCH_MESSAGE = '文件内容校验失败：实际内容的 SHA-256 与声明不一致，请重新上传';

export async function initChunkUpload(input: InitChunkUploadInput) {
  const user = currentUser();
  const settings = await getSettings('files');
  await assertUploadSizeAllowed(input.fileSize, settings);

  // 分片大小由服务端最终裁定（客户端按 init 响应中的 chunkSize 切片）：
  // 以运行时设置为基线，且保证不低于 provider 下限、总片数不超上限
  const chunkSize = resolveUploadChunkSize(input.fileSize, Math.max(input.chunkSize, settings.chunkSizeMb * 1024 * 1024));
  if (chunkSize === null) {
    throw new HTTPException(400, { message: `文件过大：超过分片上传上限（${UPLOAD_MAX_CHUNKS} 片 × ${UPLOAD_CHUNK_MAX_BYTES / 1024 / 1024}MB）` });
  }
  const totalChunks = countUploadChunks(input.fileSize, chunkSize);

  const [maybeDefaultConfig] = await db
    .select()
    .from(fileStorageConfigs)
    .where(and(eq(fileStorageConfigs.isDefault, true), eq(fileStorageConfigs.status, 'enabled')))
    .limit(1);
  const defaultConfig = requireRow(maybeDefaultConfig, '当前没有可用的默认文件服务，请先在文件配置中启用并设置默认服务', 400);

  const { objectKey } = buildUploadObjectKey(input.fileName, defaultConfig.basePath);
  const uploadId = randomUUID();

  // 云原生 multipart：先在云端初始化拿到 multipartUploadId；否则走本地暂存
  const driver = getMultipartDriver(defaultConfig.provider);
  const multipartUploadId = driver
    ? await driver.init(defaultConfig, objectKey, input.mimeType ?? undefined).catch((err) => { throw mapObjectAclError(err); })
    : null;

  await db.insert(uploadSessions).values({
    uploadId,
    fileName: input.fileName,
    fileSize: input.fileSize,
    mimeType: input.mimeType ?? null,
    chunkSize,
    totalChunks,
    storageConfigId: defaultConfig.id,
    provider: defaultConfig.provider,
    objectKey,
    bucketName: extractBucketName(defaultConfig),
    multipartUploadId,
    objectAcl: resolveObjectAcl(defaultConfig),
    tenantId: getCreateTenantId(user),
  });
  if (!driver) await fs.mkdir(sessionTempDir(uploadId), { recursive: true });

  return { uploadId, chunkSize, totalChunks, received: [] as number[] };
}

export async function uploadChunk(uploadId: string, index: number, chunk: File, options: Pick<ManagedFileUploadOptions, 'skipTypeCheck'> = {}) {
  const session = await ensureSession(uploadId);
  if (session.status !== 'uploading') {
    throw new HTTPException(400, { message: session.status === 'completing' ? '上传正在合并中，不能再上传分片' : '上传会话已结束' });
  }
  if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
    throw new HTTPException(400, { message: '分片序号越界' });
  }
  // 声明的 fileSize 是大小上限与配额检查的依据，每一片都必须与之吻合，否则实际落地字节数可任意超出声明
  const expectedSize = expectedUploadChunkSize(session.fileSize, session.chunkSize, index);
  if (chunk.size !== expectedSize) {
    throw new HTTPException(400, { message: `分片 ${index} 大小不匹配：期望 ${expectedSize} 字节，实际 ${chunk.size} 字节` });
  }

  const driver = getMultipartDriver(session.provider);
  if (driver && session.multipartUploadId) {
    // 云原生 multipart：分片直传云端，记录 ETag（首片做真实类型校验，快速失败）
    const body = Buffer.from(await chunk.arrayBuffer());
    if (index === 0 && !options.skipTypeCheck) await assertUploadTypeAllowed(body.subarray(0, 4100), session.mimeType ?? '');
    const config = await getSessionConfig(session.storageConfigId);
    const etag = await driver.uploadPart(config, session.objectKey, session.multipartUploadId, index + 1, body);
    await db
      .insert(uploadChunks)
      .values({ uploadSessionId: session.id, index, size: body.length, etag })
      .onConflictDoUpdate({ target: [uploadChunks.uploadSessionId, uploadChunks.index], set: { size: body.length, etag } });
    return { index, receivedCount: await countReceivedChunks(session.id) };
  }

  // 本地暂存：分片写入临时文件后再登记（路由层 parseBody 已把整个请求体读入内存，此处只是避免二次拷贝）
  const dest = chunkPath(uploadId, index);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(chunk.stream() as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest));
  const size = (await fs.stat(dest)).size;

  // 幂等记录已收分片，唯一约束保证并发安全
  await db
    .insert(uploadChunks)
    .values({ uploadSessionId: session.id, index, size })
    .onConflictDoUpdate({ target: [uploadChunks.uploadSessionId, uploadChunks.index], set: { size } });

  return { index, receivedCount: await countReceivedChunks(session.id) };
}

export async function getUploadStatus(uploadId: string) {
  const session = await ensureSession(uploadId);
  const received = await getReceivedIndices(session.id);
  return { uploadId, status: session.status, chunkSize: session.chunkSize, totalChunks: session.totalChunks, received };
}

const COMPLETING_MESSAGE = '上传正在合并中，请稍后查询状态';
/** completing 状态的租约：超过该时长仍未结束视为合并进程已崩溃，允许新的 complete 接管 */
const COMPLETING_LEASE_MS = 30 * 60 * 1000;

export async function completeChunkUpload(uploadId: string, options: ChunkUploadCompleteOptions = {}) {
  const user = currentUser();
  const session = await ensureSession(uploadId);
  const leaseCutoff = new Date(Date.now() - COMPLETING_LEASE_MS);
  if (session.status === 'completed') throw new HTTPException(400, { message: '上传已完成' });
  if (session.status === 'completing' && session.updatedAt >= leaseCutoff) throw new HTTPException(409, { message: COMPLETING_MESSAGE });
  if (session.status === 'aborted') throw new HTTPException(400, { message: '上传会话已中止，请重新上传' });

  const chunkRows = await db
    .select({ index: uploadChunks.index, size: uploadChunks.size, etag: uploadChunks.etag })
    .from(uploadChunks)
    .where(eq(uploadChunks.uploadSessionId, session.id))
    .orderBy(asc(uploadChunks.index));
  if (chunkRows.length !== session.totalChunks) {
    throw new HTTPException(400, { message: `分片不完整：已接收 ${chunkRows.length}/${session.totalChunks}` });
  }

  // 抢占合并权：并发到达的 complete 只有一个能把 uploading（或租约过期的 completing）改成 completing，其余拿 409 去轮询状态
  const [claimed] = await db
    .update(uploadSessions)
    .set({ status: 'completing' })
    .where(and(
      eq(uploadSessions.id, session.id),
      or(eq(uploadSessions.status, 'uploading'), and(eq(uploadSessions.status, 'completing'), lt(uploadSessions.updatedAt, leaseCutoff))),
    ))
    .returning({ id: uploadSessions.id });
  if (!claimed) throw new HTTPException(409, { message: COMPLETING_MESSAGE });

  try {
    return await mergeAndRegister(session, chunkRows, options, user);
  } catch (err) {
    // 终态失败已由 failSession / abortSession 置 aborted；其余（网络、云端瞬时错误）放回 uploading 允许客户端重试
    if (!isSessionAbortedError(err)) {
      await db
        .update(uploadSessions)
        .set({ status: 'uploading' })
        .where(and(eq(uploadSessions.id, session.id), eq(uploadSessions.status, 'completing')));
    }
    throw err;
  }
}

async function mergeAndRegister(
  session: UploadSessionRow,
  chunkRows: Array<{ index: number; size: number; etag: string | null }>,
  options: ChunkUploadCompleteOptions,
  user: ReturnType<typeof currentUser>,
) {
  const { uploadId } = session;
  const config = await getSessionConfig(session.storageConfigId);
  // 逐片校验之外再核对总量：声明大小写入 managed_files.size 并用于配额与上限检查，不允许与实际字节数不一致
  const receivedBytes = chunkRows.reduce((sum, row) => sum + row.size, 0);
  if (receivedBytes !== session.fileSize) {
    await failSession(session, config, `分片总大小（${receivedBytes} 字节）与声明的文件大小（${session.fileSize} 字节）不一致`);
  }
  const expectedHash = options.expectedHash?.toLowerCase() ?? null;
  const needHash = expectedHash !== null || options.computeHash === true;
  let contentHash: string | null = null;
  const driver = getMultipartDriver(session.provider);

  if (driver && session.multipartUploadId) {
    // 云原生 multipart：用各分片 ETag 完成合并（类型校验已在首片上传时完成）
    const parts = chunkRows.map((r) => ({ partNumber: r.index + 1, etag: r.etag ?? '' }));
    await driver.complete(config, session.objectKey, session.multipartUploadId, parts, session.mimeType ?? undefined);
    if (needHash) {
      contentHash = await sha256OfStoredObject(session, config);
      if (expectedHash && contentHash !== expectedHash) {
        await deleteObjectByConfig(config, session.objectKey, session.bucketName).catch(() => { /* 对象清理失败不掩盖校验错误 */ });
        await failSession(session, config, HASH_MISMATCH_MESSAGE, { multipartCompleted: true });
      }
    }
  } else {
    // 本地暂存：首片真实类型校验 + 内容哈希校验 + 按序流式合并上传
    if (!options.skipTypeCheck) {
      const head = await fs.readFile(chunkPath(uploadId, 0));
      try {
        await assertUploadTypeAllowed(head.subarray(0, 4100), session.mimeType ?? '');
      } catch (err) {
        // 类型不允许是确定性失败，继续保留会话只会让客户端反复 complete
        await abortSession(session, config);
        throw markSessionAborted(err);
      }
    }
    if (needHash) {
      contentHash = await sha256OfChunkFiles(uploadId, session.totalChunks);
      if (expectedHash && contentHash !== expectedHash) await failSession(session, config, HASH_MISMATCH_MESSAGE);
    }
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
      objectAcl: session.objectAcl,
      visibility: options.visibility ?? 'public',
      gcState: options.visibility === 'restricted' ? 'orphan' : 'live',
      orphanedAt: options.visibility === 'restricted' ? new Date() : null,
      contentHash,
      tenantId: getCreateTenantId(user),
    })
    .returning();

  await db.update(uploadSessions).set({ status: 'completed' }).where(eq(uploadSessions.id, session.id));
  await cleanupSession(uploadId);

  return mapManagedFile(created, config);
}

export async function abortChunkUpload(uploadId: string) {
  const session = await ensureSession(uploadId);
  if (session.status === 'completed') throw new HTTPException(400, { message: '上传已完成，无法中止' });
  if (session.status === 'completing' && session.updatedAt >= new Date(Date.now() - COMPLETING_LEASE_MS)) {
    throw new HTTPException(409, { message: '上传正在合并中，无法中止' });
  }
  const [config] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, session.storageConfigId)).limit(1);
  await abortSession(session, config);
}

/**
 * 清理超时未完成的分片上传（数据保留策略 upload_sessions 的 custom 实现，
 * ttlHours = 策略保留天数 × 24）：
 * 1. 删除「最近一次活动」（会话创建或最后一片到达，取较晚者）超过 TTL 的会话（任意状态），
 *    级联删除 upload_chunks 并移除临时目录——进行中的大文件只要还在持续上传就不会被误清；
 * 2. 扫描临时根目录，删除无活跃会话对应、且修改时间超过 TTL 的孤儿目录（mtime 校验避免误删进行中上传）。
 */
export async function cleanupStaleUploadSessions(ttlHours = 24): Promise<{ staleSessions: number; orphanDirs: number; freedBytes: number }> {
  const cutoff = new Date(Date.now() - ttlHours * 3600 * 1000);
  let freedBytes = 0;

  // 1. 过期会话：中止云端 multipart（如有）→ 删临时目录 → 删 DB 行（级联删 upload_chunks）
  const recentChunkExists = db
    .select({ id: uploadChunks.id })
    .from(uploadChunks)
    .where(and(eq(uploadChunks.uploadSessionId, uploadSessions.id), gte(uploadChunks.createdAt, cutoff)));
  const stale = await db
    .select({
      id: uploadSessions.id,
      uploadId: uploadSessions.uploadId,
      provider: uploadSessions.provider,
      multipartUploadId: uploadSessions.multipartUploadId,
      objectKey: uploadSessions.objectKey,
      storageConfigId: uploadSessions.storageConfigId,
    })
    .from(uploadSessions)
    .where(and(lt(uploadSessions.createdAt, cutoff), notExists(recentChunkExists)));
  for (const s of stale) {
    if (getMultipartDriver(s.provider) && s.multipartUploadId) {
      const [config] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, s.storageConfigId)).limit(1);
      await abortCloudMultipart(s, config);
    }
    freedBytes += await dirSize(sessionTempDir(s.uploadId));
    await cleanupSession(s.uploadId);
  }
  if (stale.length > 0) {
    await db.delete(uploadSessions).where(inArray(uploadSessions.id, stale.map((s) => s.id)));
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
