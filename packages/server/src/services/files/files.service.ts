import { managedFiles, fileStorageConfigs, users } from '../../db/schema';
import type { FileStorageConfigRow } from '../../db/schema';
import { buildManagedFileProxyUrl, buildPublicFileUrl, deleteStoredFile, readStoredFile, resolveFileAccessUrl, resolveObjectAcl, uploadFileByConfig } from '../../lib/file-storage';
import { formatDateTime, parseDateTimeInput } from '../../lib/datetime';
import { getConfigBoolean, getConfigValue, getConfigNumber } from '../../lib/system-config';

export function mapManagedFile(row: typeof managedFiles.$inferSelect, config?: FileStorageConfigRow) {
  return {
    id: row.id,
    storageConfigId: row.storageConfigId,
    storageName: row.storageName,
    provider: row.provider,
    originalName: row.originalName,
    objectKey: row.objectKey,
    size: row.size,
    mimeType: row.mimeType ?? null,
    extension: row.extension ?? null,
    // url 为稳定代理路径（合同：可持久化、永不失效）；directUrl 为 public 策略的永久直链（仅渲染用，禁止持久化）
    url: buildManagedFileProxyUrl(row.id),
    directUrl: buildPublicFileUrl(row, config),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────
import { and, desc, asc, eq, inArray, isNull, like, or, gte, lte, sql } from 'drizzle-orm';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { db } from '../../db';
import { streamToExcel, formatDateTimeForExcel } from '../../lib/excel-export';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { xlsxBufferToWorkbookData } from '../../lib/xlsx-to-univer';
import { csvTextToWorkbookData } from '../../lib/csv-to-univer';
import { runAsUser } from '../../lib/audit-context';

const SPREADSHEET_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

/** 全量存储配置 id→row 映射（配置表行数极少），供列表映射直链使用 */
export async function getStorageConfigMap(): Promise<Map<number, FileStorageConfigRow>> {
  const rows = await db.select().from(fileStorageConfigs);
  return new Map(rows.map((r) => [r.id, r]));
}

/** 校验文件为可预览的表格（.xlsx 或 .csv） */
function ensureSpreadsheetPreviewable(mimeType: string | null, extension: string | null) {
  const mime = (mimeType ?? '').toLowerCase();
  const ext = (extension ?? '').toLowerCase();
  const isXlsx = mime.includes('spreadsheetml') || ext === 'xlsx';
  const isCsv = mime === 'text/csv' || mime === 'application/csv' || ext === 'csv';
  if (!isXlsx && !isCsv) {
    throw new HTTPException(400, { message: '该文件不是可预览的 Excel(.xlsx) 或 CSV 表格' });
  }
}

export async function getStoredFileForRead(id: string) {
  const [file] = await db.select().from(managedFiles).where(eq(managedFiles.id, id)).limit(1);
  if (!file) throw new HTTPException(404, { message: '文件不存在' });
  const [storageConfig] = await db
    .select()
    .from(fileStorageConfigs)
    .where(eq(fileStorageConfigs.id, file.storageConfigId))
    .limit(1);
  if (!storageConfig) throw new HTTPException(404, { message: '文件存储配置不存在' });
  return { file, storageConfig };
}

/** 按存储配置策略解析文件访问直链（presigned 每次签发新鲜 URL，调用方不得长期缓存） */
export async function getFileAccessUrl(id: string, purpose?: 'preview' | 'download') {
  const { file, storageConfig } = await getStoredFileForRead(id);
  const contentDisposition = purpose === 'download'
    ? `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`
    : undefined;
  const result = await resolveFileAccessUrl(file, storageConfig, { contentDisposition });
  return {
    url: result.url,
    strategy: result.strategy,
    expiresAt: result.expiresAt ? formatDateTime(result.expiresAt) : null,
  };
}

export async function readFileContent(id: string) {
  const { file, storageConfig } = await getStoredFileForRead(id);
  return readStoredFile(file, storageConfig);
}

export async function readGeneratedManagedFile(id: string, tenantId: number | null) {
  const tenantWhere = tenantId === null ? isNull(managedFiles.tenantId) : eq(managedFiles.tenantId, tenantId);
  const [file] = await db.select().from(managedFiles)
    .where(and(eq(managedFiles.id, id), tenantWhere))
    .limit(1);
  if (!file) throw new HTTPException(404, { message: '生成文件不存在' });
  const [storageConfig] = await db.select().from(fileStorageConfigs)
    .where(eq(fileStorageConfigs.id, file.storageConfigId))
    .limit(1);
  if (!storageConfig) throw new HTTPException(404, { message: '文件存储配置不存在' });
  return readStoredFile(file, storageConfig);
}

/** 读取 .xlsx 文件并转换为 Univer 只读预览数据 */
export async function getSheetPreview(id: string) {
  const user = currentUser();
  const tc = tenantCondition(managedFiles, user);
  const where = tc ? and(eq(managedFiles.id, id), tc) : eq(managedFiles.id, id);
  const [file] = await db.select().from(managedFiles).where(where).limit(1);
  if (!file) throw new HTTPException(404, { message: '文件不存在' });

  ensureSpreadsheetPreviewable(file.mimeType, file.extension);
  if (file.size > SPREADSHEET_PREVIEW_MAX_BYTES) {
    throw new HTTPException(400, { message: 'Excel 文件过大，暂不支持在线预览' });
  }

  const [storageConfig] = await db
    .select()
    .from(fileStorageConfigs)
    .where(eq(fileStorageConfigs.id, file.storageConfigId))
    .limit(1);
  if (!storageConfig) throw new HTTPException(404, { message: '文件存储配置不存在' });

  const stored = await readStoredFile(file, storageConfig);
  const arrayBuffer = await new Response(stored.stream).arrayBuffer();

  // CSV 与 xlsx 走不同处理分支
  const mime = (file.mimeType ?? '').toLowerCase();
  const ext = (file.extension ?? '').toLowerCase();
  const isCsv = mime === 'text/csv' || mime === 'application/csv' || ext === 'csv';

  try {
    if (isCsv) {
      const text = Buffer.from(arrayBuffer).toString('utf-8');
      return csvTextToWorkbookData(text, { fileName: file.originalName });
    }
    return await xlsxBufferToWorkbookData(arrayBuffer, { fileName: file.originalName });
  } catch {
    throw new HTTPException(400, { message: isCsv ? 'CSV 文件解析失败' : 'Excel 文件解析失败，可能已损坏或格式不受支持' });
  }
}

export async function listManagedFiles(query: {
  page?: number; pageSize?: number; keyword?: string; provider?: 'local' | 'oss' | 's3' | 'cos' | 'obs' | 'kodo' | 'bos' | 'azure' | 'sftp';
  fileType?: 'image' | 'video' | 'audio' | 'document'; startTime?: string; endTime?: string;
}) {
  const user = currentUser();
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 10);
  const conditions = [];
  if (query.keyword) {
    conditions.push(
      or(
        like(managedFiles.originalName, `%${escapeLike(query.keyword)}%`),
        like(managedFiles.objectKey, `%${escapeLike(query.keyword)}%`),
        like(managedFiles.storageName, `%${escapeLike(query.keyword)}%`),
      ),
    );
  }
  if (query.provider) conditions.push(eq(managedFiles.provider, query.provider));
  if (query.fileType) {
    if (query.fileType === 'image') conditions.push(like(managedFiles.mimeType, 'image/%'));
    else if (query.fileType === 'video') conditions.push(like(managedFiles.mimeType, 'video/%'));
    else if (query.fileType === 'audio') conditions.push(like(managedFiles.mimeType, 'audio/%'));
    else if (query.fileType === 'document') {
      conditions.push(
        or(
          like(managedFiles.mimeType, 'text/%'),
          like(managedFiles.mimeType, 'application/pdf%'),
          like(managedFiles.mimeType, '%msword%'),
          like(managedFiles.mimeType, '%wordprocessingml%'),
          like(managedFiles.mimeType, '%spreadsheetml%'),
          like(managedFiles.mimeType, '%presentationml%'),
          like(managedFiles.mimeType, '%powerpoint%'),
          like(managedFiles.mimeType, '%excel%'),
        )!,
      );
    }
  }
  const startTime = parseDateTimeInput(query.startTime);
  const endTime = parseDateTimeInput(query.endTime);
  if (startTime) conditions.push(gte(managedFiles.createdAt, startTime));
  if (endTime) conditions.push(lte(managedFiles.createdAt, endTime));
  const where = and(...conditions);
  const tc = tenantCondition(managedFiles, user);
  const finalWhere = mergeWhere(where, tc);
  const [count, paginated, configMap] = await Promise.all([
    db.$count(managedFiles, finalWhere),
    withPagination(db.select().from(managedFiles).where(finalWhere).orderBy(desc(managedFiles.createdAt)).$dynamic(), page, pageSize),
    getStorageConfigMap(),
  ]);
  const uploaderIds = [...new Set(paginated.map((f) => f.createdBy).filter((id): id is number => id != null))];
  const uploaderMap = new Map<number, string>();
  if (uploaderIds.length > 0) {
    const uploaders = await db
      .select({ id: users.id, nickname: users.nickname, username: users.username })
      .from(users)
      .where(inArray(users.id, uploaderIds));
    for (const u of uploaders) uploaderMap.set(u.id, u.nickname || u.username);
  }
  return {
    list: paginated.map((f) => ({ ...mapManagedFile(f, configMap.get(f.storageConfigId)), uploaderName: f.createdBy ? (uploaderMap.get(f.createdBy) ?? null) : null })),
    total: count,
    page,
    pageSize,
  };
}

const DEFAULT_ALLOWED_TYPES = 'image/*,video/*,audio/*,application/pdf,text/plain,application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/msword,application/vnd.ms-powerpoint';

/** 校验上传大小是否超过系统配置上限（file_upload_max_size_mb，0 表示不限制） */
export async function assertUploadSizeAllowed(size: number) {
  const maxMb = await getConfigNumber('file_upload_max_size_mb', 0);
  if (maxMb > 0 && size > maxMb * 1024 * 1024) {
    throw new HTTPException(400, { message: `文件大小超过上限（${maxMb}MB）` });
  }
}

/** 基于 magic bytes 校验真实文件类型；headBytes 为文件前若干字节，fallbackMime 用于无法识别时回退 */
export async function assertUploadTypeAllowed(headBytes: Buffer, fallbackMime: string) {
  const validateEnabled = await getConfigBoolean('file_upload_validate_type', true);
  if (!validateEnabled) return;
  const allowedTypesRaw = await getConfigValue('file_upload_allowed_types', DEFAULT_ALLOWED_TYPES);
  const allowedPatterns = allowedTypesRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(headBytes);
  // 无法识别（如纯文本）时回退使用调用方提供的 MIME
  const actualMime = detected?.mime ?? fallbackMime;
  const allowed = allowedPatterns.some((pattern) => {
    if (pattern === '*' || pattern === '*/*') return true;
    if (pattern.endsWith('/*')) {
      const mainType = pattern.slice(0, -2);
      return actualMime.startsWith(`${mainType}/`);
    }
    return actualMime === pattern;
  });
  if (!allowed) {
    throw new HTTPException(400, { message: `文件类型不允许：检测到 ${actualMime}，不在允许类型列表中` });
  }
}

function normalizeUploadFile(value: unknown): File {
  const rawFile = Array.isArray(value) ? value[0] : value;
  if (!rawFile || typeof (rawFile as File).arrayBuffer !== 'function' || typeof (rawFile as File).name !== 'string') {
    throw new HTTPException(400, { message: '请选择要上传的文件' });
  }
  return rawFile as File;
}

export async function uploadManagedFileFromBody(fileValue: unknown) {
  return uploadManagedFile(normalizeUploadFile(fileValue));
}

export async function uploadManagedFile(file: File) {
  const user = currentUser();

  // 大小上限 + 基于 magic bytes 的真实类型校验
  await assertUploadSizeAllowed(file.size);
  await assertUploadTypeAllowed(Buffer.from(await file.slice(0, 4100).arrayBuffer()), file.type);
  const [defaultConfig] = await db
    .select()
    .from(fileStorageConfigs)
    .where(and(eq(fileStorageConfigs.isDefault, true), eq(fileStorageConfigs.status, 'enabled')))
    .limit(1);
  if (!defaultConfig) throw new HTTPException(400, { message: '当前没有可用的默认文件服务，请先在文件配置中启用并设置默认服务' });
  const uploaded = await uploadFileByConfig(defaultConfig, file);
  const [created] = await db
    .insert(managedFiles)
    .values({
      storageConfigId: defaultConfig.id,
      storageName: defaultConfig.name,
      provider: defaultConfig.provider,
      originalName: file.name,
      objectKey: uploaded.objectKey,
      bucketName: uploaded.bucketName,
      size: uploaded.size,
      mimeType: uploaded.mimeType,
      extension: uploaded.extension,
      objectAcl: resolveObjectAcl(defaultConfig),
      tenantId: getCreateTenantId(user),
    })
    .returning();
  return mapManagedFile(created, defaultConfig);
}

export async function saveGeneratedManagedFile(input: {
  buffer: Buffer | Uint8Array | ArrayBuffer;
  filename: string;
  mimeType: string;
  tenantId: number | null;
  createdBy: number;
}) {
  const bytes = input.buffer instanceof ArrayBuffer ? new Uint8Array(input.buffer) : input.buffer;
  const blob = new Blob([bytes as BlobPart], { type: input.mimeType });
  const file = new File([blob], input.filename, { type: input.mimeType });
  const [defaultConfig] = await db
    .select()
    .from(fileStorageConfigs)
    .where(and(eq(fileStorageConfigs.isDefault, true), eq(fileStorageConfigs.status, 'enabled')))
    .limit(1);
  if (!defaultConfig) throw new HTTPException(400, { message: '当前没有可用的默认文件服务，请先在文件配置中启用并设置默认服务' });
  const uploaded = await uploadFileByConfig(defaultConfig, file);
  const [created] = await runAsUser(input.createdBy, () =>
    db
      .insert(managedFiles)
      .values({
        storageConfigId: defaultConfig.id,
        storageName: defaultConfig.name,
        provider: defaultConfig.provider,
        originalName: input.filename,
        objectKey: uploaded.objectKey,
        bucketName: uploaded.bucketName,
        size: uploaded.size,
        mimeType: uploaded.mimeType,
        extension: uploaded.extension,
        objectAcl: resolveObjectAcl(defaultConfig),
        tenantId: input.tenantId,
      })
      .returning(),
  );
  return created;
}

export async function batchDeleteFiles(ids: string[]) {
  if (ids.length === 0) return 0;
  const user = currentUser();
  const tc = tenantCondition(managedFiles, user);
  const idCondition = inArray(managedFiles.id, ids);
  const where = tc ? and(idCondition, tc) : idCondition;
  const files = await db.select().from(managedFiles).where(where);
  const configIds = [...new Set(files.map((f) => f.storageConfigId))];
  const configs = await db.select().from(fileStorageConfigs).where(inArray(fileStorageConfigs.id, configIds));
  const configMap = new Map(configs.map((c) => [c.id, c]));
  await Promise.allSettled(
    files.map(async (file) => {
      const storageConfig = configMap.get(file.storageConfigId);
      if (storageConfig) await deleteStoredFile(file, storageConfig);
    }),
  );
  await db.delete(managedFiles).where(where);
  return files.length;
}

export async function deleteManagedFile(id: string) {
  const user = currentUser();
  const tc = tenantCondition(managedFiles, user);
  const where = tc ? and(eq(managedFiles.id, id), tc) : eq(managedFiles.id, id);
  const [file] = await db.select().from(managedFiles).where(where).limit(1);
  if (!file) throw new HTTPException(404, { message: '文件不存在' });
  const [storageConfig] = await db
    .select()
    .from(fileStorageConfigs)
    .where(eq(fileStorageConfigs.id, file.storageConfigId))
    .limit(1);
  if (storageConfig) {
    await deleteStoredFile(file, storageConfig);
  }
  await db.delete(managedFiles).where(where);
}

export async function deleteGeneratedManagedFile(id: string, tenantId: number | null): Promise<void> {
  const tenantWhere = tenantId === null ? isNull(managedFiles.tenantId) : eq(managedFiles.tenantId, tenantId);
  const where = and(eq(managedFiles.id, id), tenantWhere);
  const [file] = await db.select().from(managedFiles).where(where).limit(1);
  if (!file) return;
  const [storageConfig] = await db.select().from(fileStorageConfigs)
    .where(eq(fileStorageConfigs.id, file.storageConfigId))
    .limit(1);
  if (storageConfig) await deleteStoredFile(file, storageConfig);
  await db.delete(managedFiles).where(where);
}

export async function getManagedFile(id: string) {
  const user = currentUser();
  const tc = tenantCondition(managedFiles, user);
  const where = tc ? and(eq(managedFiles.id, id), tc) : eq(managedFiles.id, id);
  const file = await db.query.managedFiles.findFirst({
    where,
    with: { createdByUser: { columns: { nickname: true, username: true } } },
  });
  if (!file) throw new HTTPException(404, { message: '文件不存在' });
  const [config] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, file.storageConfigId)).limit(1);
  return {
    ...mapManagedFile(file, config),
    uploaderName: file.createdByUser?.nickname || file.createdByUser?.username || null,
  };
}

export async function getManagedFileBeforeAudit(id: string) {
  const user = currentUser();
  const tc = tenantCondition(managedFiles, user);
  const where = tc ? and(eq(managedFiles.id, id), tc) : eq(managedFiles.id, id);
  const [file] = await db.select().from(managedFiles).where(where).limit(1);
  if (!file) return null;
  return mapManagedFile(file);
}

export async function getManagedFilesBeforeAudit(ids: string[]) {
  const user = currentUser();
  const tc = tenantCondition(managedFiles, user);
  const idCondition = inArray(managedFiles.id, ids);
  const where = tc ? and(idCondition, tc) : idCondition;
  const rows = await db.select().from(managedFiles).where(where);
  return rows.map((row) => mapManagedFile(row));
}

function deduplicateEntryName(name: string, count: number): string {
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1) return `${name}_${count}`;
  return `${name.slice(0, lastDot)}_${count}${name.slice(lastDot)}`;
}

export async function batchDownloadFilesAsZip(ids: string[]): Promise<{ stream: ReadableStream; filename: string }> {
  if (ids.length === 0) throw new HTTPException(400, { message: '请选择要下载的文件' });
  const user = currentUser();
  const tc = tenantCondition(managedFiles, user);
  const idCondition = inArray(managedFiles.id, ids);
  const where = tc ? and(idCondition, tc) : idCondition;
  const files = await db.select().from(managedFiles).where(where);
  if (files.length === 0) throw new HTTPException(400, { message: '未找到可下载的文件' });

  const configIds = [...new Set(files.map((f) => f.storageConfigId))];
  const configs = await db.select().from(fileStorageConfigs).where(inArray(fileStorageConfigs.id, configIds));
  const configMap = new Map(configs.map((c) => [c.id, c]));

  const { Readable, PassThrough } = await import('node:stream');
  const archiver = (await import('archiver')).default;
  const archive = archiver('zip', { zlib: { level: 5 } });
  const passThrough = new PassThrough();
  archive.on('error', (err: Error) => passThrough.destroy(err));
  archive.pipe(passThrough);

  // 逐个文件流式写入 ZIP：等待上一个 entry 处理完再打开下一个远端连接，
  // 同一时刻只持有一个源流，既不把整文件读进内存，也不并发打开全部连接。
  void (async () => {
    const nameCount: Record<string, number> = {};
    for (const file of files) {
      const config = configMap.get(file.storageConfigId);
      if (!config) continue;
      try {
        const { stream } = await readStoredFile(file, config);
        const nodeStream = Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]);
        const count = nameCount[file.originalName] ?? 0;
        nameCount[file.originalName] = count + 1;
        const entryName = count === 0 ? file.originalName : deduplicateEntryName(file.originalName, count);
        archive.append(nodeStream, { name: entryName });
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { archive.off('entry', onEntry); archive.off('error', onError); };
          const onEntry = () => { cleanup(); resolve(); };
          const onError = (err: Error) => { cleanup(); reject(err); };
          archive.once('entry', onEntry);
          archive.once('error', onError);
        });
      } catch {
        // 单个文件读取失败时跳过，不中断整体打包
      }
    }
    await archive.finalize();
  })().catch((err) => passThrough.destroy(err instanceof Error ? err : new Error(String(err))));

  const webStream = Readable.toWeb(passThrough) as ReadableStream;
  return { stream: webStream, filename: `files_${Date.now()}.zip` };
}

function normalizePath(value?: string | null): string {
  return (value ?? '').replace(/^\/+|\/+$/g, '');
}

export async function browseStorageFiles(query: { storageConfigId: number; path?: string }) {
  const user = currentUser();
  const [storageConfig] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, query.storageConfigId)).limit(1);
  const basePath = normalizePath(storageConfig?.basePath);

  // Sanitize browsing path — reject traversal attempts
  const rawPath = normalizePath(query.path);
  if (rawPath.split('/').some((seg) => seg === '..' || seg === '.')) {
    throw new HTTPException(400, { message: '路径不合法' });
  }

  // The full object-key prefix that scopes this browsing level
  const fullPrefix = [basePath, rawPath].filter(Boolean).join('/');

  const tc = tenantCondition(managedFiles, user);
  const conditions = [eq(managedFiles.storageConfigId, query.storageConfigId)];
  if (fullPrefix) conditions.push(like(managedFiles.objectKey, `${escapeLike(fullPrefix)}/%`));
  const where = tc ? and(...conditions, tc) : and(...conditions);

  const allFiles = await db.select().from(managedFiles).where(where).orderBy(asc(managedFiles.objectKey));

  const folderSet = new Set<string>();
  const levelFileRows: (typeof allFiles)[number][] = [];

  const prefixWithSlash = fullPrefix ? `${fullPrefix}/` : '';
  for (const file of allFiles) {
    let relKey = file.objectKey;
    if (prefixWithSlash) {
      if (!relKey.startsWith(prefixWithSlash)) continue;
      relKey = relKey.slice(prefixWithSlash.length);
    }
    const slashIdx = relKey.indexOf('/');
    if (slashIdx === -1) {
      levelFileRows.push(file);
    } else {
      const folderName = relKey.slice(0, slashIdx);
      if (folderName) folderSet.add(folderName);
    }
  }

  const uploaderIds = [...new Set(levelFileRows.map((f) => f.createdBy).filter((id): id is number => id != null))];
  const uploaderMap = new Map<number, string>();
  if (uploaderIds.length > 0) {
    const uploaders = await db
      .select({ id: users.id, nickname: users.nickname, username: users.username })
      .from(users)
      .where(inArray(users.id, uploaderIds));
    for (const u of uploaders) uploaderMap.set(u.id, u.nickname || u.username);
  }

  const folders = [...folderSet].sort().map((name) => ({
    name,
    path: rawPath ? `${rawPath}/${name}` : name,
  }));

  return {
    folders,
    files: levelFileRows.map((f) => ({
      ...mapManagedFile(f, storageConfig),
      uploaderName: f.createdBy ? (uploaderMap.get(f.createdBy) ?? null) : null,
    })),
    currentPath: rawPath,
    basePath,
  };
}

export async function exportManagedFiles(): Promise<{ stream: ReadableStream; filename: string }> {
  const user = currentUser();
  const rows = await db
    .select()
    .from(managedFiles)
    .where(tenantCondition(managedFiles, user))
    .orderBy(desc(managedFiles.createdAt));
  const stream = await streamToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '文件名', key: 'originalName', width: 28 },
      { header: '类型', key: 'mimeType', width: 18 },
      { header: '大小(bytes)', key: 'size', width: 14 },
      { header: '存储方式', key: 'storageProvider', width: 12 },
      { header: '上传时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, createdAt: formatDateTimeForExcel(r.createdAt) })),
    '文件列表',
  );
  return { stream, filename: 'files.xlsx' };
}

export async function getFileStats() {
  const user = currentUser();
  const tc = tenantCondition(managedFiles, user);

  const [
    summary,
    allFiles,
    uploaderRows,
    monthlyRows,
  ] = await Promise.all([
    // 汇总卡片：总数、总大小、图片数、文档数
    db.select({
      totalFiles: sql<number>`CAST(COUNT(*) AS int)`,
      totalSize: sql<number>`CAST(COALESCE(SUM(${managedFiles.size}), 0) AS bigint)`,
      imageCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${managedFiles.mimeType} LIKE 'image/%') AS int)`,
      docCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${managedFiles.mimeType} LIKE 'text/%' OR ${managedFiles.mimeType} LIKE 'application/pdf%' OR ${managedFiles.mimeType} LIKE '%msword%' OR ${managedFiles.mimeType} LIKE '%wordprocessingml%' OR ${managedFiles.mimeType} LIKE '%spreadsheetml%' OR ${managedFiles.mimeType} LIKE '%presentationml%') AS int)`,
      videoCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${managedFiles.mimeType} LIKE 'video/%') AS int)`,
      audioCount: sql<number>`CAST(COUNT(*) FILTER (WHERE ${managedFiles.mimeType} LIKE 'audio/%') AS int)`,
      todayCount: sql<number>`CAST(COUNT(*) FILTER (WHERE DATE(${managedFiles.createdAt}) = CURRENT_DATE) AS int)`,
      thisMonthCount: sql<number>`CAST(COUNT(*) FILTER (WHERE DATE_TRUNC('month', ${managedFiles.createdAt}) = DATE_TRUNC('month', CURRENT_DATE)) AS int)`,
    }).from(managedFiles).where(tc),

    // 全量文件（用于按类型/provider/大小分区统计）
    db.select({ mimeType: managedFiles.mimeType, provider: managedFiles.provider, size: managedFiles.size }).from(managedFiles).where(tc),

    // 上传人 Top 10
    db.select({
      userId: managedFiles.createdBy,
      count: sql<number>`CAST(COUNT(*) AS int)`,
      size: sql<number>`CAST(COALESCE(SUM(${managedFiles.size}), 0) AS bigint)`,
    }).from(managedFiles).where(tc)
      .groupBy(managedFiles.createdBy)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(10),

    // 近 12 个月每月新增数量
    db.select({
      month: sql<string>`to_char(date_trunc('month', ${managedFiles.createdAt}), 'YYYY-MM')`,
      count: sql<number>`CAST(COUNT(*) AS int)`,
    }).from(managedFiles)
      .where(tc ? and(gte(managedFiles.createdAt, sql`NOW() - INTERVAL '12 months'`), tc) : gte(managedFiles.createdAt, sql`NOW() - INTERVAL '12 months'`))
      .groupBy(sql`date_trunc('month', ${managedFiles.createdAt})`)
      .orderBy(sql`date_trunc('month', ${managedFiles.createdAt})`),
  ]);

  // 文件类型分布
  const typeMap: Record<string, { label: string; count: number; size: number }> = {
    image: { label: '图片', count: 0, size: 0 },
    video: { label: '视频', count: 0, size: 0 },
    audio: { label: '音频', count: 0, size: 0 },
    document: { label: '文档', count: 0, size: 0 },
    other: { label: '其他', count: 0, size: 0 },
  };
  for (const f of allFiles) {
    const m = f.mimeType ?? '';
    const s = f.size ?? 0;
    if (m.startsWith('image/')) { typeMap.image.count++; typeMap.image.size += s; }
    else if (m.startsWith('video/')) { typeMap.video.count++; typeMap.video.size += s; }
    else if (m.startsWith('audio/')) { typeMap.audio.count++; typeMap.audio.size += s; }
    else if (m.startsWith('text/') || m.includes('pdf') || m.includes('msword') || m.includes('wordprocessingml') || m.includes('spreadsheetml') || m.includes('presentationml')) { typeMap.document.count++; typeMap.document.size += s; }
    else { typeMap.other.count++; typeMap.other.size += s; }
  }

  // 存储类型分布
  const providerMap: Record<string, { count: number; size: number }> = {};
  for (const f of allFiles) {
    const p = f.provider;
    if (!providerMap[p]) providerMap[p] = { count: 0, size: 0 };
    providerMap[p].count++;
    providerMap[p].size += f.size ?? 0;
  }

  // 文件大小区间分布
  const sizeRanges = [
    { range: '<1MB', min: 0, max: 1024 * 1024 },
    { range: '1-10MB', min: 1024 * 1024, max: 10 * 1024 * 1024 },
    { range: '10-100MB', min: 10 * 1024 * 1024, max: 100 * 1024 * 1024 },
    { range: '>100MB', min: 100 * 1024 * 1024, max: Infinity },
  ];
  const sizeRangeMap: Record<string, number> = {};
  for (const r of sizeRanges) sizeRangeMap[r.range] = 0;
  for (const f of allFiles) {
    const s = f.size ?? 0;
    for (const r of sizeRanges) {
      if (s >= r.min && s < r.max) { sizeRangeMap[r.range]++; break; }
    }
  }

  // 上传人用户名映射
  const uploaderIds = uploaderRows.map((r) => r.userId).filter((id): id is number => id !== null);
  const uploaderUsers = uploaderIds.length > 0
    ? await db.select({ id: users.id, nickname: users.nickname, username: users.username }).from(users).where(inArray(users.id, uploaderIds))
    : [];
  const userMap = new Map(uploaderUsers.map((u) => [u.id, u.nickname || u.username]));

  const s = summary[0] ?? { totalFiles: 0, totalSize: 0, imageCount: 0, docCount: 0, videoCount: 0, audioCount: 0, todayCount: 0, thisMonthCount: 0 };
  return {
    summary: { totalFiles: Number(s.totalFiles), totalSize: Number(s.totalSize), imageCount: Number(s.imageCount), docCount: Number(s.docCount), videoCount: Number(s.videoCount), audioCount: Number(s.audioCount), todayCount: Number(s.todayCount), thisMonthCount: Number(s.thisMonthCount) },
    typeStats: Object.entries(typeMap).map(([type, v]) => ({ type, label: v.label, count: v.count, size: v.size })),
    providerStats: Object.entries(providerMap).map(([provider, v]) => ({ provider, count: v.count, size: v.size })).sort((a, b) => b.count - a.count),
    monthlyStats: monthlyRows.map((r) => ({ month: r.month, count: Number(r.count) })),
    uploaderStats: uploaderRows.map((r) => ({ username: userMap.get(r.userId ?? 0) ?? '未知', count: Number(r.count), size: Number(r.size) })),
    sizeRangeStats: sizeRanges.map((r) => ({ range: r.range, count: sizeRangeMap[r.range] })),
  };
}
