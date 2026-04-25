import { managedFiles, fileStorageConfigs } from '../db/schema';
import { buildManagedFileUrl, deleteStoredFile, readStoredFile, uploadFileByConfig } from '../lib/file-storage';

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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────
import { and, desc, eq, like, or, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { exportToExcel } from '../lib/excel-export';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { AppError } from '../lib/errors';
import { currentUser } from '../lib/context';

export async function readFileContent(id: number) {
  const [file] = await db.select().from(managedFiles).where(eq(managedFiles.id, id)).limit(1);
  if (!file) throw new AppError('文件不存在', 404);
  const [storageConfig] = await db
    .select()
    .from(fileStorageConfigs)
    .where(eq(fileStorageConfigs.id, file.storageConfigId))
    .limit(1);
  if (!storageConfig) throw new AppError('文件存储配置不存在', 404);
  return readStoredFile(file, storageConfig);
}

export async function listManagedFiles(query: {
  page?: number; pageSize?: number; keyword?: string; provider?: 'local' | 'oss' | 's3' | 'cos'; startTime?: string; endTime?: string;
}) {
  const user = currentUser();
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 10);
  const conditions = [];
  if (query.keyword) {
    conditions.push(
      or(
        like(managedFiles.originalName, `%${query.keyword}%`),
        like(managedFiles.objectKey, `%${query.keyword}%`),
        like(managedFiles.storageName, `%${query.keyword}%`),
      ),
    );
  }
  if (query.provider) conditions.push(eq(managedFiles.provider, query.provider));
  if (query.startTime) conditions.push(gte(managedFiles.createdAt, new Date(query.startTime)));
  if (query.endTime) conditions.push(lte(managedFiles.createdAt, new Date(query.endTime)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const tc = tenantCondition(managedFiles, user);
  const finalWhere = where && tc ? and(where, tc) : (tc ?? where);
  const [count, paginated] = await Promise.all([
    db.$count(managedFiles, finalWhere),
    db.select().from(managedFiles).where(finalWhere).orderBy(desc(managedFiles.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: paginated.map(mapManagedFile), total: count, page, pageSize };
}

function normalizeUploadFile(value: unknown): File {
  const rawFile = Array.isArray(value) ? value[0] : value;
  if (!rawFile || typeof (rawFile as File).arrayBuffer !== 'function' || typeof (rawFile as File).name !== 'string') {
    throw new AppError('请选择要上传的文件', 400);
  }
  return rawFile as File;
}

export async function uploadManagedFileFromBody(fileValue: unknown) {
  return uploadManagedFile(normalizeUploadFile(fileValue));
}

export async function uploadManagedFile(file: File) {
  const user = currentUser();
  const [defaultConfig] = await db
    .select()
    .from(fileStorageConfigs)
    .where(and(eq(fileStorageConfigs.isDefault, true), eq(fileStorageConfigs.status, 'active')))
    .limit(1);
  if (!defaultConfig) throw new AppError('当前没有可用的默认文件服务，请先在文件配置中启用并设置默认服务', 400);
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

export async function deleteManagedFile(id: number) {
  const user = currentUser();
  const tc = tenantCondition(managedFiles, user);
  const where = tc ? and(eq(managedFiles.id, id), tc) : eq(managedFiles.id, id);
  const [file] = await db.select().from(managedFiles).where(where).limit(1);
  if (!file) throw new AppError('文件不存在', 404);
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

export async function exportManagedFiles(): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const user = currentUser();
  const rows = await db
    .select()
    .from(managedFiles)
    .where(tenantCondition(managedFiles, user))
    .orderBy(desc(managedFiles.id));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '文件名', key: 'originalName', width: 28 },
      { header: '类型', key: 'mimeType', width: 18 },
      { header: '大小(bytes)', key: 'size', width: 14 },
      { header: '存储方式', key: 'storageProvider', width: 12 },
      { header: '上传时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    '文件列表',
  );
  return { buffer, filename: 'files.xlsx' };
}
