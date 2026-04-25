import { fileStorageConfigs, managedFiles } from '../db/schema';
import type { DbExecutor } from '../db/types';
import type { createFileStorageConfigSchema } from '@zenith/shared';
import type { z } from '@hono/zod-openapi';
import { formatDateTime, parseDateTimeInput } from '../lib/datetime';

type StorageInput = z.infer<typeof createFileStorageConfigSchema>;

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapFileStorageConfig(row: typeof fileStorageConfigs.$inferSelect) {
  return {
    ...row,
    basePath: row.basePath ?? null,
    localRootPath: row.localRootPath ?? null,
    ossRegion: row.ossRegion ?? null,
    ossEndpoint: row.ossEndpoint ?? null,
    ossBucket: row.ossBucket ?? null,
    ossAccessKeyId: row.ossAccessKeyId ?? null,
    ossAccessKeySecret: row.ossAccessKeySecret ?? null,
    s3Region: row.s3Region ?? null,
    s3Endpoint: row.s3Endpoint ?? null,
    s3Bucket: row.s3Bucket ?? null,
    s3AccessKeyId: row.s3AccessKeyId ?? null,
    s3SecretAccessKey: row.s3SecretAccessKey ?? null,
    s3ForcePathStyle: row.s3ForcePathStyle ?? null,
    cosRegion: row.cosRegion ?? null,
    cosBucket: row.cosBucket ?? null,
    cosSecretId: row.cosSecretId ?? null,
    cosSecretKey: row.cosSecretKey ?? null,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 多态存储配置解包 ─────────────────────────────────────────────────────────

export function toStoragePayload(input: StorageInput) {
  const common = {
    name: input.name,
    provider: input.provider,
    status: input.status,
    isDefault: input.isDefault,
    basePath: input.basePath ?? null,
    remark: input.remark ?? null,
  };
  const nullS3 = { s3Region: null, s3Endpoint: null, s3Bucket: null, s3AccessKeyId: null, s3SecretAccessKey: null, s3ForcePathStyle: null };
  const nullCos = { cosRegion: null, cosBucket: null, cosSecretId: null, cosSecretKey: null };
  const nullOss = { ossRegion: null, ossEndpoint: null, ossBucket: null, ossAccessKeyId: null, ossAccessKeySecret: null };

  if (input.provider === 'local') {
    return { ...common, localRootPath: input.localRootPath ?? null, ...nullOss, ...nullS3, ...nullCos };
  }
  if (input.provider === 'oss') {
    return {
      ...common, localRootPath: null,
      ossRegion: input.ossRegion ?? null, ossEndpoint: input.ossEndpoint ?? null,
      ossBucket: input.ossBucket ?? null, ossAccessKeyId: input.ossAccessKeyId ?? null,
      ossAccessKeySecret: input.ossAccessKeySecret ?? null, ...nullS3, ...nullCos,
    };
  }
  if (input.provider === 's3') {
    return {
      ...common, localRootPath: null, ...nullOss,
      s3Region: input.s3Region ?? null, s3Endpoint: input.s3Endpoint ?? null,
      s3Bucket: input.s3Bucket ?? null, s3AccessKeyId: input.s3AccessKeyId ?? null,
      s3SecretAccessKey: input.s3SecretAccessKey ?? null, s3ForcePathStyle: input.s3ForcePathStyle ?? null,
      ...nullCos,
    };
  }
  return {
    ...common, localRootPath: null, ...nullOss, ...nullS3,
    cosRegion: input.cosRegion ?? null, cosBucket: input.cosBucket ?? null,
    cosSecretId: input.cosSecretId ?? null, cosSecretKey: input.cosSecretKey ?? null,
  };
}

// ─── 清除默认标记 ─────────────────────────────────────────────────────────────

export async function clearDefaultFlag(executor: DbExecutor) {
  await executor.update(fileStorageConfigs).set({ isDefault: false });
}

// ─── 业务入口 ─────────────────────────────────────────────────────────────────
import { asc, desc, eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { AppError } from '../lib/errors';

export interface ListFileStorageConfigsQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  startTime?: string;
  endTime?: string;
}

export async function listFileStorageConfigs(q: ListFileStorageConfigsQuery) {
  const { status, startTime, endTime, page = 1, pageSize = 10 } = q;
  const conditions = [];
  if (status === 'active' || status === 'disabled') conditions.push(eq(fileStorageConfigs.status, status));
  const parsedStartTime = parseDateTimeInput(startTime);
  const parsedEndTime = parseDateTimeInput(endTime);
  if (parsedStartTime) conditions.push(gte(fileStorageConfigs.updatedAt, parsedStartTime));
  if (parsedEndTime) conditions.push(lte(fileStorageConfigs.updatedAt, parsedEndTime));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [total, list] = await Promise.all([
    db.$count(fileStorageConfigs, where),
    db.select().from(fileStorageConfigs).where(where).orderBy(desc(fileStorageConfigs.isDefault), asc(fileStorageConfigs.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: list.map(mapFileStorageConfig), total, page, pageSize };
}

export async function getDefaultFileStorageConfig() {
  const [row] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.isDefault, true)).limit(1);
  return row ? mapFileStorageConfig(row) : null;
}

export async function createFileStorageConfig(data: StorageInput) {
  const created = await db.transaction(async (tx) => {
    const existingDefault = await tx.select({ id: fileStorageConfigs.id }).from(fileStorageConfigs).where(eq(fileStorageConfigs.isDefault, true)).limit(1);
    const shouldBeDefault = data.isDefault || (existingDefault.length === 0 && data.status === 'active');
    if (shouldBeDefault) await clearDefaultFlag(tx);
    const [row] = await tx.insert(fileStorageConfigs).values({ ...toStoragePayload({ ...data, isDefault: shouldBeDefault }) }).returning();
    return row;
  });
  return mapFileStorageConfig(created);
}

export async function updateFileStorageConfig(id: number, data: Partial<StorageInput>) {
  const [current] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!current) throw new AppError('文件配置不存在', 404);
  if (current.isDefault && data.status === 'disabled') throw new AppError('默认文件服务不能被禁用，请先切换默认服务', 400);
  const updated = await db.transaction(async (tx) => {
    if (data.isDefault) await clearDefaultFlag(tx);
    const [row] = await tx
      .update(fileStorageConfigs)
      .set({ ...toStoragePayload({ ...current, ...data } as StorageInput) })
      .where(eq(fileStorageConfigs.id, id))
      .returning();
    return row;
  });
  return mapFileStorageConfig(updated);
}

export async function setDefaultFileStorageConfig(id: number) {
  const [target] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!target) throw new AppError('文件配置不存在', 404);
  if (target.status !== 'active') throw new AppError('只有启用状态的文件配置才能设为默认', 400);
  const updated = await db.transaction(async (tx) => {
    await clearDefaultFlag(tx);
    const [row] = await tx.update(fileStorageConfigs).set({ isDefault: true }).where(eq(fileStorageConfigs.id, id)).returning();
    return row;
  });
  return mapFileStorageConfig(updated);
}

export async function deleteFileStorageConfig(id: number) {
  const [target] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!target) throw new AppError('文件配置不存在', 404);
  if (target.isDefault) throw new AppError('默认文件服务不能删除，请先切换默认服务', 400);
  const valueCount = await db.$count(managedFiles, eq(managedFiles.storageConfigId, id));
  if (valueCount > 0) throw new AppError('该文件配置下已有文件记录，不能删除', 400);
  await db.delete(fileStorageConfigs).where(eq(fileStorageConfigs.id, id));
}
