import { fileStorageConfigs, managedFiles } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import type { createFileStorageConfigSchema } from '@zenith/shared';
import { FILE_OBJECT_ACL_SUPPORT } from '@zenith/shared';
import type { z } from '@hono/zod-openapi';
import { formatDateTime, parseDateTimeInput } from '../../lib/datetime';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { uploadObjectByConfig, deleteObjectByConfig } from '../../lib/file-storage';

type StorageInput = z.infer<typeof createFileStorageConfigSchema>;

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

/** 需要脱敏的密钥字段：列表/详情一律不返回，编辑时前端留空即保留原值（write-only） */
export const STORAGE_SECRET_FIELDS = [
  'ossAccessKeySecret',
  's3SecretAccessKey',
  'cosSecretKey',
  'obsSecretAccessKey',
  'kodoSecretKey',
  'bosSecretAccessKey',
  'azureAccountKey',
  'sftpPassword',
  'sftpPrivateKey',
] as const;

export function mapFileStorageConfig(row: typeof fileStorageConfigs.$inferSelect) {
  const {
    ossAccessKeySecret: _ossSecret,
    s3SecretAccessKey: _s3Secret,
    cosSecretKey: _cosSecret,
    obsSecretAccessKey: _obsSecret,
    kodoSecretKey: _kodoSecret,
    bosSecretAccessKey: _bosSecret,
    azureAccountKey: _azureKey,
    sftpPassword: _sftpPwd,
    sftpPrivateKey: _sftpKey,
    ...safe
  } = row;
  return {
    ...safe,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 多态存储配置解包 ─────────────────────────────────────────────────────────

/** 所有 provider 专属字段的空基线，确保切换 provider 时清空无关字段 */
const EMPTY_PROVIDER_FIELDS = {
  localRootPath: null,
  ossRegion: null, ossEndpoint: null, ossBucket: null, ossAccessKeyId: null, ossAccessKeySecret: null,
  s3Region: null, s3Endpoint: null, s3Bucket: null, s3AccessKeyId: null, s3SecretAccessKey: null, s3ForcePathStyle: null,
  cosRegion: null, cosBucket: null, cosSecretId: null, cosSecretKey: null,
  obsEndpoint: null, obsBucket: null, obsAccessKeyId: null, obsSecretAccessKey: null,
  kodoAccessKey: null, kodoSecretKey: null, kodoBucket: null, kodoRegion: null, kodoEndpoint: null,
  bosEndpoint: null, bosBucket: null, bosAccessKeyId: null, bosSecretAccessKey: null,
  azureAccountName: null, azureAccountKey: null, azureContainerName: null, azureEndpoint: null,
  sftpHost: null, sftpPort: null, sftpUsername: null, sftpPassword: null, sftpPrivateKey: null, sftpRootPath: null, sftpBaseUrl: null,
};

export function toStoragePayload(input: StorageInput) {
  // 对象 ACL 仅在 provider 支持时保留（更新接口为 partial schema，此处按支持矩阵兜底回落 default）
  const supportedAcls = FILE_OBJECT_ACL_SUPPORT[input.provider];
  const objectAcl = supportedAcls?.includes(input.objectAcl ?? 'default') ? (input.objectAcl ?? 'default') : 'default' as const;
  const base = {
    name: input.name,
    provider: input.provider,
    status: input.status,
    isDefault: input.isDefault,
    basePath: input.basePath ?? null,
    objectAcl,
    remark: input.remark ?? null,
    ...EMPTY_PROVIDER_FIELDS,
  };

  switch (input.provider) {
    case 'local':
      return { ...base, localRootPath: input.localRootPath ?? null };
    case 'oss':
      return {
        ...base,
        ossRegion: input.ossRegion ?? null, ossEndpoint: input.ossEndpoint ?? null,
        ossBucket: input.ossBucket ?? null, ossAccessKeyId: input.ossAccessKeyId ?? null,
        ossAccessKeySecret: input.ossAccessKeySecret ?? null,
      };
    case 's3':
      return {
        ...base,
        s3Region: input.s3Region ?? null, s3Endpoint: input.s3Endpoint ?? null,
        s3Bucket: input.s3Bucket ?? null, s3AccessKeyId: input.s3AccessKeyId ?? null,
        s3SecretAccessKey: input.s3SecretAccessKey ?? null, s3ForcePathStyle: input.s3ForcePathStyle ?? null,
      };
    case 'cos':
      return {
        ...base,
        cosRegion: input.cosRegion ?? null, cosBucket: input.cosBucket ?? null,
        cosSecretId: input.cosSecretId ?? null, cosSecretKey: input.cosSecretKey ?? null,
      };
    case 'obs':
      return {
        ...base,
        obsEndpoint: input.obsEndpoint ?? null, obsBucket: input.obsBucket ?? null,
        obsAccessKeyId: input.obsAccessKeyId ?? null, obsSecretAccessKey: input.obsSecretAccessKey ?? null,
      };
    case 'kodo':
      return {
        ...base,
        kodoAccessKey: input.kodoAccessKey ?? null, kodoSecretKey: input.kodoSecretKey ?? null,
        kodoBucket: input.kodoBucket ?? null, kodoRegion: input.kodoRegion ?? null,
        kodoEndpoint: input.kodoEndpoint ?? null,
      };
    case 'bos':
      return {
        ...base,
        bosEndpoint: input.bosEndpoint ?? null, bosBucket: input.bosBucket ?? null,
        bosAccessKeyId: input.bosAccessKeyId ?? null, bosSecretAccessKey: input.bosSecretAccessKey ?? null,
      };
    case 'azure':
      return {
        ...base,
        azureAccountName: input.azureAccountName ?? null, azureAccountKey: input.azureAccountKey ?? null,
        azureContainerName: input.azureContainerName ?? null, azureEndpoint: input.azureEndpoint ?? null,
      };
    case 'sftp':
      return {
        ...base,
        sftpHost: input.sftpHost ?? null, sftpPort: input.sftpPort ?? null,
        sftpUsername: input.sftpUsername ?? null, sftpPassword: input.sftpPassword ?? null,
        sftpPrivateKey: input.sftpPrivateKey ?? null, sftpRootPath: input.sftpRootPath ?? null,
        sftpBaseUrl: input.sftpBaseUrl ?? null,
      };
    default:
      return base;
  }
}

// ─── 清除默认标记 ─────────────────────────────────────────────────────────────

export async function clearDefaultFlag(executor: DbExecutor) {
  await executor.update(fileStorageConfigs).set({ isDefault: false });
}

// ─── 业务入口 ─────────────────────────────────────────────────────────────────
import { asc, desc, eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../../db';
import { withPagination } from '../../lib/where-helpers';
import { HTTPException } from 'hono/http-exception';

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
  if (status === 'enabled' || status === 'disabled') conditions.push(eq(fileStorageConfigs.status, status));
  const parsedStartTime = parseDateTimeInput(startTime);
  const parsedEndTime = parseDateTimeInput(endTime);
  if (parsedStartTime) conditions.push(gte(fileStorageConfigs.updatedAt, parsedStartTime));
  if (parsedEndTime) conditions.push(lte(fileStorageConfigs.updatedAt, parsedEndTime));
  const where = and(...conditions);
  const [total, list] = await Promise.all([
    db.$count(fileStorageConfigs, where),
    withPagination(db.select().from(fileStorageConfigs).where(where).orderBy(desc(fileStorageConfigs.isDefault), asc(fileStorageConfigs.id)).$dynamic(), page, pageSize),
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
    const shouldBeDefault = data.isDefault || (existingDefault.length === 0 && data.status === 'enabled');
    if (shouldBeDefault) await clearDefaultFlag(tx);
    const [row] = await tx.insert(fileStorageConfigs).values({ ...toStoragePayload({ ...data, isDefault: shouldBeDefault }) }).returning();
    return row;
  });
  return mapFileStorageConfig(created);
}

export async function updateFileStorageConfig(id: number, data: Partial<StorageInput>) {
  const [current] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!current) throw new HTTPException(404, { message: '文件配置不存在' });
  if (current.isDefault && data.status === 'disabled') throw new HTTPException(400, { message: '默认文件服务不能被禁用，请先切换默认服务' });
  // 合并原配置与入参；密钥字段留空表示不修改，沿用数据库原值（write-only）
  const merged = { ...current, ...data } as Record<string, unknown>;
  for (const field of STORAGE_SECRET_FIELDS) {
    if (!data[field]) merged[field] = current[field];
  }
  const updated = await db.transaction(async (tx) => {
    if (data.isDefault) await clearDefaultFlag(tx);
    const [row] = await tx
      .update(fileStorageConfigs)
      .set({ ...toStoragePayload(merged as StorageInput) })
      .where(eq(fileStorageConfigs.id, id))
      .returning();
    return row;
  });
  return mapFileStorageConfig(updated);
}

export async function setDefaultFileStorageConfig(id: number) {
  const [target] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!target) throw new HTTPException(404, { message: '文件配置不存在' });
  if (target.status !== 'enabled') throw new HTTPException(400, { message: '只有启用状态的文件配置才能设为默认' });
  const updated = await db.transaction(async (tx) => {
    await clearDefaultFlag(tx);
    const [row] = await tx.update(fileStorageConfigs).set({ isDefault: true }).where(eq(fileStorageConfigs.id, id)).returning();
    return row;
  });
  return mapFileStorageConfig(updated);
}

export async function deleteFileStorageConfig(id: number) {
  const [target] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!target) throw new HTTPException(404, { message: '文件配置不存在' });
  if (target.isDefault) throw new HTTPException(400, { message: '默认文件服务不能删除，请先切换默认服务' });
  const valueCount = await db.$count(managedFiles, eq(managedFiles.storageConfigId, id));
  if (valueCount > 0) throw new HTTPException(400, { message: '该文件配置下已有文件记录，不能删除' });
  await db.delete(fileStorageConfigs).where(eq(fileStorageConfigs.id, id));
}

export async function getFileStorageConfig(id: number) {
  const [row] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '存储配置不存在' });
  return mapFileStorageConfig(row);
}

async function testStorageConfigRow(config: typeof fileStorageConfigs.$inferSelect) {
  const objectKey = [config.basePath?.replace(/^\/+|\/+$/g, ''), '.zenith-test', `${Date.now()}-${randomUUID()}.txt`].filter(Boolean).join('/');
  const body = Buffer.from(`zenith storage test ${new Date().getTime()}`);
  try {
    await uploadObjectByConfig(config, {
      objectKey,
      stream: Readable.from(body),
      size: body.length,
      mimeType: 'text/plain',
    });
    await deleteObjectByConfig(config, objectKey);
  } catch (err) {
    throw new HTTPException(400, { message: `存储连接测试失败：${err instanceof Error ? err.message : String(err)}` });
  }
  return { ok: true as const, message: '存储连接测试通过' };
}

export async function testFileStorageConfig(data: StorageInput) {
  return testStorageConfigRow({ ...toStoragePayload(data), id: 0, createdAt: new Date(), updatedAt: new Date(), createdBy: null, updatedBy: null } as typeof fileStorageConfigs.$inferSelect);
}

export async function testExistingFileStorageConfig(id: number, data: Partial<StorageInput>) {
  const [current] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!current) throw new HTTPException(404, { message: '文件配置不存在' });
  const merged = { ...current, ...data } as Record<string, unknown>;
  for (const field of STORAGE_SECRET_FIELDS) {
    if (!data[field]) merged[field] = current[field];
  }
  return testStorageConfigRow({ ...current, ...toStoragePayload(merged as StorageInput) });
}

export async function getFileStorageConfigBeforeAudit(id: number) {
  const [row] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  if (!row) return null;
  return mapFileStorageConfig(row);
}
