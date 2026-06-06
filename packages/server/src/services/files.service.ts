import { managedFiles, fileStorageConfigs, users } from '../db/schema';
import { buildManagedFileUrl, deleteStoredFile, readStoredFile, uploadFileByConfig } from '../lib/file-storage';
import { formatDateTime, parseDateTimeInput } from '../lib/datetime';
import { getConfigBoolean, getConfigValue } from '../lib/system-config';

export function mapManagedFile(row: typeof managedFiles.$inferSelect) {
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
    url: buildManagedFileUrl(row.id),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────
import { and, desc, asc, eq, inArray, like, or, gte, lte } from 'drizzle-orm';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { streamToExcel, formatDateTimeForExcel } from '../lib/excel-export';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';

export async function readFileContent(id: number) {
  const [file] = await db.select().from(managedFiles).where(eq(managedFiles.id, id)).limit(1);
  if (!file) throw new HTTPException(404, { message: '文件不存在' });
  const [storageConfig] = await db
    .select()
    .from(fileStorageConfigs)
    .where(eq(fileStorageConfigs.id, file.storageConfigId))
    .limit(1);
  if (!storageConfig) throw new HTTPException(404, { message: '文件存储配置不存在' });
  return readStoredFile(file, storageConfig);
}

export async function listManagedFiles(query: {
  page?: number; pageSize?: number; keyword?: string; provider?: 'local' | 'oss' | 's3' | 'cos';
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
  const [count, paginated] = await Promise.all([
    db.$count(managedFiles, finalWhere),
    withPagination(db.select().from(managedFiles).where(finalWhere).orderBy(desc(managedFiles.id)).$dynamic(), page, pageSize),
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
    list: paginated.map((f) => ({ ...mapManagedFile(f), uploaderName: f.createdBy ? (uploaderMap.get(f.createdBy) ?? null) : null })),
    total: count,
    page,
    pageSize,
  };
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

  // 基于 magic bytes 校验真实文件类型
  const validateEnabled = await getConfigBoolean('file_upload_validate_type', true);
  if (validateEnabled) {
    const allowedTypesRaw = await getConfigValue('file_upload_allowed_types', 'image/*,video/*,audio/*,application/pdf,text/plain,application/zip,application/x-zip-compressed');
    const allowedPatterns = allowedTypesRaw.split(',').map(s => s.trim()).filter(Boolean);
    // 只读前 4100 字节用于检测
    const { fileTypeFromBuffer } = await import('file-type');
    const headBytes = await file.slice(0, 4100).arrayBuffer();
    const detected = await fileTypeFromBuffer(Buffer.from(headBytes));
    // 如果无法检测（如纯文本文件），回退使用 MIME type 头
    const actualMime = detected?.mime ?? file.type;
    const allowed = allowedPatterns.some(pattern => {
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
      size: uploaded.size,
      mimeType: uploaded.mimeType,
      extension: uploaded.extension,
      tenantId: getCreateTenantId(user),
    })
    .returning();
  return mapManagedFile(created);
}

export async function batchDeleteFiles(ids: number[]) {
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

export async function deleteManagedFile(id: number) {
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

export async function getManagedFile(id: number) {
  const user = currentUser();
  const tc = tenantCondition(managedFiles, user);
  const where = tc ? and(eq(managedFiles.id, id), tc) : eq(managedFiles.id, id);
  const file = await db.query.managedFiles.findFirst({
    where,
    with: { createdByUser: { columns: { nickname: true, username: true } } },
  });
  if (!file) throw new HTTPException(404, { message: '文件不存在' });
  return {
    ...mapManagedFile(file),
    uploaderName: file.createdByUser?.nickname || file.createdByUser?.username || null,
  };
}

export async function getManagedFileBeforeAudit(id: number) {
  const user = currentUser();
  const tc = tenantCondition(managedFiles, user);
  const where = tc ? and(eq(managedFiles.id, id), tc) : eq(managedFiles.id, id);
  const [file] = await db.select().from(managedFiles).where(where).limit(1);
  if (!file) return null;
  return mapManagedFile(file);
}

function deduplicateEntryName(name: string, count: number): string {
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1) return `${name}_${count}`;
  return `${name.slice(0, lastDot)}_${count}${name.slice(lastDot)}`;
}

export async function batchDownloadFilesAsZip(ids: number[]): Promise<{ stream: ReadableStream; filename: string }> {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { ZipArchive } = await import('archiver') as any;
  const archive = new ZipArchive({ zlib: { level: 5 } });
  const passThrough = new PassThrough();
  archive.on('error', (err: Error) => passThrough.destroy(err));
  archive.pipe(passThrough);

  const nameCount: Record<string, number> = {};
  for (const file of files) {
    const config = configMap.get(file.storageConfigId);
    if (!config) continue;
    try {
      const { stream } = await readStoredFile(file, config);
      const chunks: Uint8Array[] = [];
      const reader = stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);
      const count = nameCount[file.originalName] ?? 0;
      nameCount[file.originalName] = count + 1;
      const entryName = count === 0 ? file.originalName : deduplicateEntryName(file.originalName, count);
      archive.append(buffer, { name: entryName });
    } catch {
      // 单个文件读取失败时跳过，不中断整体打包
    }
  }
  archive.finalize();

  const webStream = Readable.toWeb(passThrough) as ReadableStream;
  return { stream: webStream, filename: `files_${Date.now()}.zip` };
}

function normalizePath(value?: string | null): string {
  return (value ?? '').replace(/^\/+|\/+$/g, '');
}

export async function browseStorageFiles(query: { storageConfigId: number; path?: string }) {
  const user = currentUser();
  const basePath = normalizePath(
    (await db.select({ basePath: fileStorageConfigs.basePath }).from(fileStorageConfigs).where(eq(fileStorageConfigs.id, query.storageConfigId)).limit(1))[0]?.basePath,
  );

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
      ...mapManagedFile(f),
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
    .orderBy(desc(managedFiles.id));
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
