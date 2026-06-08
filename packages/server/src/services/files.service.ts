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
import { and, desc, asc, eq, inArray, like, or, gte, lte, sql } from 'drizzle-orm';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { streamToExcel, formatDateTimeForExcel } from '../lib/excel-export';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';
import { xlsxBufferToWorkbookData } from '../lib/xlsx-to-univer';

const SPREADSHEET_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

/** 校验文件为可预览的 .xlsx 表格 */
function ensureSpreadsheetPreviewable(mimeType: string | null, extension: string | null) {
  const mime = (mimeType ?? '').toLowerCase();
  const ext = (extension ?? '').toLowerCase();
  if (!mime.includes('spreadsheetml') && ext !== 'xlsx') {
    throw new HTTPException(400, { message: '该文件不是可预览的 Excel(.xlsx) 表格' });
  }
}

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

/** 读取 .xlsx 文件并转换为 Univer 只读预览数据 */
export async function getSheetPreview(id: number) {
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

  try {
    return await xlsxBufferToWorkbookData(arrayBuffer, { fileName: file.originalName });
  } catch {
    throw new HTTPException(400, { message: 'Excel 文件解析失败，可能已损坏或格式不受支持' });
  }
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
    const allowedTypesRaw = await getConfigValue('file_upload_allowed_types', 'image/*,video/*,audio/*,application/pdf,text/plain,application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/msword,application/vnd.ms-powerpoint');
    const allowedPatterns = allowedTypesRaw.split(',').map(s => s.trim()).filter(Boolean);
    // 只读前 4100 字节用于检测
    const { fileTypeFromBuffer } = await import('file-type');
    const headBytes = await file.slice(0, 4100).arrayBuffer();
    const detected = await fileTypeFromBuffer(Buffer.from(headBytes));
    // 如果无法检测（如纯文本文件），回退使用 MIME type 头
    const actualMime = detected?.mime ?? file.type;
    const allowed = allowedPatterns.some(pattern => {
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

  const s = summary[0] ?? { totalFiles: 0, totalSize: 0, imageCount: 0, docCount: 0 };
  return {
    summary: { totalFiles: Number(s.totalFiles), totalSize: Number(s.totalSize), imageCount: Number(s.imageCount), docCount: Number(s.docCount) },
    typeStats: Object.entries(typeMap).map(([type, v]) => ({ type, label: v.label, count: v.count, size: v.size })),
    providerStats: Object.entries(providerMap).map(([provider, v]) => ({ provider, count: v.count, size: v.size })).sort((a, b) => b.count - a.count),
    monthlyStats: monthlyRows.map((r) => ({ month: r.month, count: Number(r.count) })),
    uploaderStats: uploaderRows.map((r) => ({ username: userMap.get(r.userId ?? 0) ?? '未知', count: Number(r.count), size: Number(r.size) })),
    sizeRangeStats: sizeRanges.map((r) => ({ range: r.range, count: sizeRangeMap[r.range] })),
  };
}
