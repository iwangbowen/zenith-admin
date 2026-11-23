/**
 * 真实存储对象浏览：默认列 provider 中的对象，并把 managed_files 记录作为标注合并进来。
 * `registered` 模式仍走数据库；`all` / `unregistered` 走 provider List API。
 */
import path from 'node:path';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import { FILE_OBJECT_ACL_SUPPORT, fileContract, registerStorageObjectSchema, registerStorageObjectsSchema, removeStorageObjectSchema, removeStorageObjectsSchema } from '@zenith/shared/platform';
import type { QueryOutputOf } from '@zenith/shared/core';
import { db } from '../../db';
import { fileStorageConfigs, managedFiles, type FileStorageConfigRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { createSignedTokenCodec } from '../../lib/signed-token';
import { attachmentDisposition } from '../../lib/content-disposition';
import {
  applyObjectAcl,
  deleteObjectByConfig,
  extractBucketName,
  headStoredObject,
  listStorageObjects,
  resolveObjectAcl,
  resolvePublicAccess,
  resolveStorageObjectDirectUrl,
  sha256OfStorageObject,
  type StorageListCursor,
  type StorageListObject,
} from '../../lib/file-storage';
import { deleteGeneratedManagedFile, mapManagedFile } from './files.service';
import { releaseManagedFiles } from './file-gc.service';

type BrowseQuery = QueryOutputOf<typeof fileContract.browseStorage>;
type AccessQuery = QueryOutputOf<typeof fileContract.storageObjectAccessUrl>;
type RegisterInput = z.output<typeof registerStorageObjectSchema>;
type RegisterBatchInput = z.output<typeof registerStorageObjectsSchema>;
type RemoveInput = z.output<typeof removeStorageObjectSchema>;
type RemoveBatchInput = z.output<typeof removeStorageObjectsSchema>;

interface StorageBrowseFile {
  key: string;
  name: string;
  size: number | null;
  lastModified: string | null;
  etag: string | null;
  registered: boolean;
  canDelete: boolean;
  file: ReturnType<typeof mapManagedFile> | null;
}

interface StorageBrowsePage {
  mode: BrowseQuery['mode'];
  folders: Array<{ name: string; path: string }>;
  files: StorageBrowseFile[];
  currentPath: string;
  basePath: string;
  nextCursor: string | null;
  hasMore: boolean;
}

interface StorageObjectToken {
  configId: number;
  key: string;
  exp: number;
  download?: boolean;
}

const STORAGE_OBJECT_TOKEN_TTL_MS = 10 * 60 * 1000;
const UNREGISTERED_SCAN_LIMIT = 5;
const storageObjectToken = createSignedTokenCodec<StorageObjectToken>({ purpose: 'storage-object' });

function encodeCursor(cursor: StorageListCursor | null): string | null {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value?: string): StorageListCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid cursor');
    const cursor: StorageListCursor = {};
    if (typeof parsed.marker === 'string') cursor.marker = parsed.marker;
    if (typeof parsed.token === 'string') cursor.token = parsed.token;
    if (typeof parsed.offset === 'number' && Number.isInteger(parsed.offset) && parsed.offset >= 0) cursor.offset = parsed.offset;
    return cursor;
  } catch {
    throw new HTTPException(400, { message: '浏览游标无效，请刷新后重试' });
  }
}

function normalizePart(value?: string | null): string {
  return (value ?? '').replace(/^\/+|\/+$/g, '');
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', xml: 'application/xml',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

/** HEAD 未返回 MIME（local / SFTP）或仅返回 octet-stream 时按扩展名回退，保证预览走正确的 Content-Type */
function inferMimeType(fileName: string, headMimeType?: string | null): string | null {
  if (headMimeType && headMimeType !== 'application/octet-stream') return headMimeType;
  const extension = path.extname(fileName).replace('.', '').toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? headMimeType ?? null;
}

function resolveBrowsePath(config: FileStorageConfigRow, inputPath?: string) {
  const basePath = normalizePart(config.basePath);
  const currentPath = normalizePart(inputPath);
  if (currentPath.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new HTTPException(400, { message: '浏览路径不合法' });
  }
  const prefix = currentPath
    ? `${basePath ? `${basePath}/` : ''}${currentPath}/`
    : basePath ? `${basePath}/` : '';
  return { basePath, currentPath, prefix };
}

function assertKeyInScope(config: FileStorageConfigRow, key: string): string {
  const normalized = key.replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new HTTPException(400, { message: '对象 Key 不合法' });
  }
  const basePath = normalizePart(config.basePath);
  if (basePath && normalized !== basePath && !normalized.startsWith(`${basePath}/`)) {
    throw new HTTPException(403, { message: '对象不在当前存储配置的浏览范围内' });
  }
  return normalized;
}

async function getConfig(id: number) {
  const [config] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  return requireRow(config, '存储配置不存在');
}

async function findManagedFile(configId: number, key: string) {
  const [row] = await db.select().from(managedFiles)
    .where(and(eq(managedFiles.storageConfigId, configId), eq(managedFiles.objectKey, key)))
    .limit(1);
  return row ?? null;
}

function folderOf(fullPrefix: string, currentPath: string): { name: string; path: string } {
  const name = fullPrefix.replace(/\/$/, '').split('/').pop() ?? '';
  return { name, path: currentPath ? `${currentPath}/${name}` : name };
}

function toBrowseFile(
  entry: StorageListObject,
  row: typeof managedFiles.$inferSelect | null,
  config: FileStorageConfigRow,
): StorageBrowseFile {
  const file = row ? mapManagedFile(row, config) : null;
  return {
    key: entry.key,
    name: entry.key.split('/').pop() ?? entry.key,
    size: entry.size ?? file?.size ?? null,
    lastModified: entry.lastModified ? formatDateTime(entry.lastModified) : file?.createdAt ?? null,
    etag: entry.etag ?? null,
    registered: file !== null,
    canDelete: row?.origin === 'storage-register',
    file,
  };
}

async function annotateObjects(config: FileStorageConfigRow, keys: string[]) {
  const map = new Map<string, typeof managedFiles.$inferSelect>();
  if (keys.length === 0) return map;
  const rows = await db.select().from(managedFiles).where(and(
    eq(managedFiles.storageConfigId, config.id),
    inArray(managedFiles.objectKey, keys),
    tenantCondition(managedFiles, currentUser()),
  ));
  for (const row of rows) {
    if (!map.has(row.objectKey)) map.set(row.objectKey, row);
  }
  return map;
}

async function browseRegistered(
  config: FileStorageConfigRow,
  currentPath: string,
  basePath: string,
  prefix: string,
  cursor: string | undefined,
  limit: number,
): Promise<StorageBrowsePage> {
  const offset = decodeCursor(cursor)?.offset ?? 0;
  const relativeKey = sql`substr(${managedFiles.objectKey}, length(${prefix}::text) + 1)`;
  const folderName = sql<string>`split_part(${relativeKey}, '/', 1)`;
  const where = buildWhere(
    eq(managedFiles.storageConfigId, config.id),
    keywordCondition(prefix || undefined, [managedFiles.objectKey], 'like', 'prefix'),
    tenantCondition(managedFiles, currentUser()),
  );
  const [folderRows, rows] = await Promise.all([
    db.selectDistinct({ name: folderName }).from(managedFiles)
      .where(and(where, sql`strpos(${relativeKey}, '/') > 0`, sql`${folderName} <> ''`)),
    db.select().from(managedFiles)
      .where(and(where, sql`strpos(${relativeKey}, '/') = 0`))
      .orderBy(asc(managedFiles.objectKey))
      .limit(limit + 1)
      .offset(offset),
  ]);
  const pageRows = rows.slice(0, limit);
  return {
    mode: 'registered',
    folders: folderRows.map((row) => ({ name: row.name, path: currentPath ? `${currentPath}/${row.name}` : row.name })).sort((a, b) => a.name.localeCompare(b.name)),
    files: pageRows.map((row) => {
      const file = mapManagedFile(row, config);
      return {
        key: row.objectKey,
        name: row.originalName,
        size: row.size,
        lastModified: formatDateTime(row.createdAt),
        etag: null,
        registered: true,
        canDelete: row.origin === 'storage-register',
        file,
      };
    }),
    currentPath,
    basePath,
    nextCursor: rows.length > limit ? encodeCursor({ offset: offset + limit }) : null,
    hasMore: rows.length > limit,
  };
}

export async function browseStorageObjects(query: BrowseQuery): Promise<StorageBrowsePage> {
  const config = await getConfig(query.storageConfigId);
  const { basePath, currentPath, prefix } = resolveBrowsePath(config, query.path);
  const limit = query.limit ?? 100;

  if (query.mode === 'registered') {
    return browseRegistered(config, currentPath, basePath, prefix, query.cursor, limit);
  }

  if (query.mode === 'all') {
    const page = await listStorageObjects(config, { prefix, cursor: decodeCursor(query.cursor), limit });
    const annotations = await annotateObjects(config, page.objects.map((entry) => entry.key));
    return {
      mode: 'all',
      folders: page.prefixes.map((item) => folderOf(item, currentPath)).sort((a, b) => a.name.localeCompare(b.name)),
      files: page.objects.map((entry) => toBrowseFile(entry, annotations.get(entry.key) ?? null, config)),
      currentPath,
      basePath,
      nextCursor: encodeCursor(page.nextCursor),
      hasMore: page.nextCursor !== null,
    };
  }

  // 仅未收录：按 provider 页扫描，最多扫描固定页数，避免空页时无限翻页
  let cursor = decodeCursor(query.cursor);
  let nextCursor: string | null = null;
  let scannedPages = 0;
  const folders = new Map<string, { name: string; path: string }>();
  const files: StorageBrowseFile[] = [];
  while (scannedPages < UNREGISTERED_SCAN_LIMIT && files.length < limit) {
    const page = await listStorageObjects(config, { prefix, cursor, limit });
    for (const item of page.prefixes) {
      const folder = folderOf(item, currentPath);
      folders.set(folder.path, folder);
    }
    const annotations = await annotateObjects(config, page.objects.map((entry) => entry.key));
    for (const entry of page.objects) {
      if (annotations.has(entry.key)) continue;
      files.push(toBrowseFile(entry, null, config));
      if (files.length >= limit) break;
    }
    scannedPages++;
    cursor = page.nextCursor ?? undefined;
    nextCursor = encodeCursor(page.nextCursor);
    if (!page.nextCursor) break;
  }
  return {
    mode: 'unregistered',
    folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name)),
    files,
    currentPath,
    basePath,
    nextCursor,
    hasMore: nextCursor !== null,
  };
}

export async function getStorageObjectAccessUrl(query: AccessQuery) {
  const config = await getConfig(query.storageConfigId);
  const key = assertKeyInScope(config, query.key);
  const disposition = query.purpose === 'download' ? attachmentDisposition(path.basename(key)) : undefined;
  // 浏览器预览由前端 fetch 后转 blob，跨域直链会被对象存储 CORS 拦截；预览强制同源代理
  const direct = query.proxy ? null : await resolveStorageObjectDirectUrl(config, key, disposition);
  if (direct) {
    return {
      url: direct.url,
      strategy: direct.strategy,
      expiresAt: direct.expiresAt ? formatDateTime(direct.expiresAt) : null,
    };
  }
  const expiresAt = new Date(Date.now() + STORAGE_OBJECT_TOKEN_TTL_MS);
  const token = storageObjectToken.encode({ configId: config.id, key, exp: expiresAt.getTime(), download: query.purpose === 'download' });
  return {
    url: `/api/files/browse-storage/content?token=${encodeURIComponent(token)}`,
    strategy: 'proxy' as const,
    expiresAt: formatDateTime(expiresAt),
  };
}

export async function readStorageObject(token: string) {
  const payload = storageObjectToken.decode(token);
  if (!payload) throw new HTTPException(400, { message: '对象访问令牌无效' });
  if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) throw new HTTPException(410, { message: '对象访问令牌已过期' });
  const config = await getConfig(payload.configId);
  const key = assertKeyInScope(config, payload.key);
  const head = await headStoredObject(config, key);
  return {
    config,
    key,
    size: head.size,
    mimeType: inferMimeType(path.basename(key), head.mimeType),
    originalName: path.basename(key),
    download: payload.download === true,
  };
}

async function registerOne(input: RegisterInput) {
  const config = await getConfig(input.storageConfigId);
  const key = assertKeyInScope(config, input.key);
  if (await findManagedFile(config.id, key)) {
    throw new HTTPException(409, { message: '该文件已收录到文件列表' });
  }
  const head = await headStoredObject(config, key);
  const mimeType = inferMimeType(path.basename(key), head.mimeType);
  if (input.visibility === 'restricted') {
    const supported = FILE_OBJECT_ACL_SUPPORT[config.provider] ?? [];
    if (config.provider !== 'local' && config.provider !== 'sftp') {
      if (!supported.includes('private')) {
        throw new HTTPException(400, { message: '当前存储类型不支持对象 ACL，不能收录为受控文件' });
      }
      await applyObjectAcl(config, key, 'private');
    }
  }
  const contentHash = input.computeHash ? await sha256OfStorageObject(config, key) : null;
  const objectAcl = input.visibility === 'restricted' ? 'private' : resolveObjectAcl(config);
  const [row] = await db.insert(managedFiles).values({
    storageConfigId: config.id,
    storageName: config.name,
    provider: config.provider,
    originalName: input.name?.trim() || path.basename(key),
    objectKey: key,
    bucketName: extractBucketName(config),
    size: head.size,
    mimeType,
    extension: path.extname(key).replace('.', '').toLowerCase() || null,
    objectAcl,
    publicAccess: input.visibility === 'restricted' ? false : resolvePublicAccess(config, resolveObjectAcl(config)),
    accessStrategy: input.visibility === 'restricted' ? 'proxy' : config.accessStrategy,
    visibility: input.visibility,
    origin: 'storage-register',
    contentHash,
    refCount: input.visibility === 'restricted' ? 1 : 0,
    gcState: 'live',
    orphanedAt: null,
    tenantId: getCreateTenantId(currentUser()),
  }).returning();
  return mapManagedFile(requireRow(row, '收录文件失败'), config);
}

export async function registerStorageObject(input: RegisterInput) {
  return registerOne(input);
}

export async function registerStorageObjects(input: RegisterBatchInput) {
  const registered: Awaited<ReturnType<typeof registerOne>>[] = [];
  const skipped: Array<{ key: string; reason: string }> = [];
  const failed: Array<{ key: string; message: string }> = [];
  for (const key of input.keys) {
    try {
      registered.push(await registerOne({ ...input, key }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof HTTPException && error.status === 409) skipped.push({ key, reason: message });
      else failed.push({ key, message });
    }
  }
  return { registered, skipped, failed };
}

async function removeOne(input: RemoveInput) {
  const config = await getConfig(input.storageConfigId);
  const key = assertKeyInScope(config, input.key);
  const row = await findManagedFile(config.id, key);
  if (row) {
    if (row.origin !== 'storage-register') {
      throw new HTTPException(409, { message: '该文件由其他入口收录，请在对应业务模块删除' });
    }
    if (row.refCount > 1) {
      throw new HTTPException(409, { message: '该文件存在业务引用，不能直接在存储浏览中删除' });
    }
    if (row.refCount === 1) await releaseManagedFiles(db, [row.id]);
    await deleteGeneratedManagedFile(row.id, row.tenantId);
    return;
  }
  await deleteObjectByConfig(config, key, extractBucketName(config));
}

export async function removeStorageObject(input: RemoveInput) {
  await removeOne(input);
}

export async function removeStorageObjects(input: RemoveBatchInput) {
  const deleted: string[] = [];
  const skipped: Array<{ key: string; reason: string }> = [];
  const failed: Array<{ key: string; message: string }> = [];
  for (const key of input.keys) {
    try {
      await removeOne({ ...input, key });
      deleted.push(key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof HTTPException && error.status === 409) skipped.push({ key, reason: message });
      else failed.push({ key, message });
    }
  }
  return { deleted, skipped, failed };
}
