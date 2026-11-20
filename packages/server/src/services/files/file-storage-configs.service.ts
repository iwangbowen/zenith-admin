import type { QueryOutputOf } from '@zenith/shared/core';
import { listRows } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { clearDefaultFlag as clearTableDefaultFlag } from '../../lib/default-flag';
import { fileStorageConfigs, managedFiles, uploadSessions } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { createFileStorageConfigSchema, FILE_BUCKET_ACCESS_SUPPORT, FILE_OBJECT_ACL_SUPPORT, fileStorageConfigContract, type FileBucketAcl } from '@zenith/shared/platform';
import type { z } from '@hono/zod-openapi';
import { formatDateTime, formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { getBucketAccessInfo, setBucketAccessInfo, uploadObjectByConfig, deleteObjectByConfig } from '../../lib/file-storage';

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
    bucketAccessCheckedAt: formatNullableDateTime(safe.bucketAccessCheckedAt),
    ...formatTimestamps(row),
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
  // 本地磁盘 / SFTP 不支持临时签名与对象/Bucket 公共读，兜底回落 proxy
  const rawStrategy = input.accessStrategy ?? 'proxy';
  const accessStrategy = (input.provider === 'local' || input.provider === 'sftp')
    && (rawStrategy === 'presigned' || rawStrategy === 'public-object' || rawStrategy === 'public-bucket')
    ? 'proxy'
    : rawStrategy;
  const base = {
    name: input.name,
    provider: input.provider,
    status: input.status,
    isDefault: input.isDefault,
    basePath: input.basePath ?? null,
    objectAcl,
    accessStrategy,
    uploadMode: input.uploadMode ?? 'server-proxy',
    publicBaseUrl: input.publicBaseUrl?.trim() || null,
    presignedExpirySeconds: input.presignedExpirySeconds ?? 1800,
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

/** 文件存储配置是平台级资源：默认标记全表唯一（不带租户范围） */
export async function clearDefaultFlag(executor: DbExecutor) {
  await clearTableDefaultFlag(executor, fileStorageConfigs);
}

// ─── 业务入口 ─────────────────────────────────────────────────────────────────
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { buildWhere, dateRangeConditions } from '../../lib/where-helpers';
import { HTTPException } from 'hono/http-exception';

export type FileStorageConfigListFilter = Omit<QueryOutputOf<typeof fileStorageConfigContract.list>, 'page' | 'pageSize'>;

/** 列表与导出共用的筛选条件（时间范围作用于 updatedAt） */
export function buildFileStorageConfigsWhere(q: FileStorageConfigListFilter) {
  return buildWhere(
    q.status ? eq(fileStorageConfigs.status, q.status) : undefined,
    ...dateRangeConditions(fileStorageConfigs.updatedAt, q.startTime, q.endTime),
  );
}

export async function listFileStorageConfigs(q: QueryOutputOf<typeof fileStorageConfigContract.list>) {
  const { page, pageSize } = q;
  const where = buildFileStorageConfigsWhere(q);
  return listRows({
    page,
    pageSize,
    table: fileStorageConfigs,
    where,
    orderBy: [desc(fileStorageConfigs.isDefault), asc(fileStorageConfigs.id)],
    map: mapFileStorageConfig,
  });
}

export async function getDefaultFileStorageConfig() {
  const [row] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.isDefault, true)).limit(1);
  return row ? mapFileStorageConfig(row) : null;
}

type StoragePayload = ReturnType<typeof toStoragePayload>;

/**
 * 保存 public-* 配置前探测 Bucket 实际状态。探测失败（权限 / 网络）不阻断保存，
 * 但写入 bucketAccessError，前端可提示“未验证”。
 */
async function probeBucketAccessForPayload(payload: StoragePayload): Promise<Partial<typeof fileStorageConfigs.$inferInsert>> {
  if (!payload.accessStrategy.startsWith('public-') || payload.accessStrategy === 'public-domain') return {};
  const capability = FILE_BUCKET_ACCESS_SUPPORT[payload.provider];
  if (!capability?.probe) return {};
  try {
    const info = await getBucketAccessInfo(payload as unknown as FileStorageConfigRow);
    const bucketAclPublic = info.bucketAcl === 'public-read' || info.bucketAcl === 'public-read-write';
    const bpaBlocks = info.publicStatus === true
      ? false
      : payload.provider === 'oss' || payload.provider === 's3' || payload.provider === 'obs'
        ? info.blockPublicAccess !== false
        : info.blockPublicAccess === true;
    if (payload.accessStrategy === 'public-bucket' && (!bucketAclPublic || bpaBlocks)) {
      throw new HTTPException(400, { message: 'Bucket ACL 当前不是公共读（或已开启阻止公共访问），无法保存 Bucket 公共读直链；请先在配置页调整 Bucket 权限，或改用其他下载方式' });
    }
    if (payload.accessStrategy === 'public-object' && bpaBlocks) {
      throw new HTTPException(400, { message: 'Bucket 已开启阻止公共访问或 BPA 状态未知，无法保存对象公共读直链；请关闭 Bucket 的阻止公共访问，或改用 Bucket 公共读 / 自定义域名 / 临时签名' });
    }
    return {
      bucketAcl: info.bucketAcl,
      bucketBlockPublicAccess: info.blockPublicAccess,
      bucketPolicyPublic: info.policyPublic,
      bucketPublicStatus: info.publicStatus,
      bucketAccessCheckedAt: info.checkedAt,
      bucketAccessError: null,
    };
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    return {
      bucketAcl: null,
      bucketBlockPublicAccess: null,
      bucketPolicyPublic: null,
      bucketPublicStatus: null,
      bucketAccessCheckedAt: new Date(),
      bucketAccessError: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function createFileStorageConfig(data: StorageInput) {
  const payload = toStoragePayload(data);
  const probe = await probeBucketAccessForPayload(payload);
  const created = await db.transaction(async (tx) => {
    const existingDefault = await tx.select({ id: fileStorageConfigs.id }).from(fileStorageConfigs).where(eq(fileStorageConfigs.isDefault, true)).limit(1);
    const shouldBeDefault = data.isDefault || (existingDefault.length === 0 && data.status === 'enabled');
    if (shouldBeDefault) await clearDefaultFlag(tx);
    const [row] = await tx.insert(fileStorageConfigs).values({ ...payload, isDefault: shouldBeDefault, ...probe }).returning();
    return row;
  });
  return mapFileStorageConfig(created);
}

export async function updateFileStorageConfig(id: number, data: Partial<StorageInput>) {
  const [current] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  requireRow(current, '文件配置不存在');
  if (current.isDefault && data.status === 'disabled') throw new HTTPException(400, { message: '默认文件服务不能被禁用，请先切换默认服务' });
  // 合并原配置与入参；密钥字段留空表示不修改，沿用数据库原值（write-only）
  const merged = { ...current, ...data } as Record<string, unknown>;
  for (const field of STORAGE_SECRET_FIELDS) {
    if (!data[field]) merged[field] = current[field];
  }
  if (data.provider && data.provider !== current.provider) {
    const [fileCount, sessionCount] = await Promise.all([
      db.$count(managedFiles, eq(managedFiles.storageConfigId, id)),
      db.$count(uploadSessions, eq(uploadSessions.storageConfigId, id)),
    ]);
    if (fileCount > 0 || sessionCount > 0) {
      throw new HTTPException(400, {
        message: '该配置已有文件或上传会话，不能切换存储类型；请新建配置并迁移文件',
      });
    }
  }
  // partial schema 会跳过缺失字段的跨字段校验，合并后必须按完整 schema 再校验一次
  const validation = createFileStorageConfigSchema.safeParse(merged);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    throw new HTTPException(400, {
      message: issue ? `${issue.path.join('.') || '配置'}：${issue.message}` : '文件配置不合法',
    });
  }
  const payload = toStoragePayload(validation.data);
  const probe = await probeBucketAccessForPayload(payload);
  const updated = await db.transaction(async (tx) => {
    if (data.isDefault) await clearDefaultFlag(tx);
    const [row] = await tx
      .update(fileStorageConfigs)
      .set({ ...payload, ...probe })
      .where(eq(fileStorageConfigs.id, id))
      .returning();
    return row;
  });
  return mapFileStorageConfig(updated);
}

export async function setDefaultFileStorageConfig(id: number) {
  const [target] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  requireRow(target, '文件配置不存在');
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
  requireRow(target, '文件配置不存在');
  if (target.isDefault) throw new HTTPException(400, { message: '默认文件服务不能删除，请先切换默认服务' });
  const [valueCount, sessionCount] = await Promise.all([
    db.$count(managedFiles, eq(managedFiles.storageConfigId, id)),
    db.$count(uploadSessions, and(eq(uploadSessions.storageConfigId, id), inArray(uploadSessions.status, ['uploading', 'completing']))),
  ]);
  if (valueCount > 0) throw new HTTPException(400, { message: '该文件配置下已有文件记录，不能删除' });
  if (sessionCount > 0) throw new HTTPException(400, { message: '该文件配置下还有未完成的上传会话，请等待完成或中止后再删除' });
  await db.delete(fileStorageConfigs).where(eq(fileStorageConfigs.id, id));
}

export async function getFileStorageConfig(id: number) {
  const [row] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  return mapFileStorageConfig(requireRow(row, '存储配置不存在'));
}

type BucketAccessInfo = Awaited<ReturnType<typeof getBucketAccessInfo>>;

function mapBucketAccessInfo(info: BucketAccessInfo) {
  return { ...info, checkedAt: formatDateTime(info.checkedAt) };
}

async function persistBucketAccess(id: number, info: BucketAccessInfo) {
  await db.update(fileStorageConfigs).set({
    bucketAcl: info.bucketAcl,
    bucketBlockPublicAccess: info.blockPublicAccess,
    bucketPolicyPublic: info.policyPublic,
    bucketPublicStatus: info.publicStatus,
    bucketAccessCheckedAt: info.checkedAt,
    bucketAccessError: null,
  }).where(eq(fileStorageConfigs.id, id));
}

export async function probeFileStorageConfigBucketAccess(id: number) {
  const [row] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  const config = requireRow(row, '存储配置不存在');
  if (!FILE_BUCKET_ACCESS_SUPPORT[config.provider]?.probe) {
    throw new HTTPException(400, { message: `当前存储类型不支持 Bucket 权限探测：${config.provider}` });
  }
  try {
    const info = await getBucketAccessInfo(config);
    await persistBucketAccess(id, info);
    return mapBucketAccessInfo(info);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(fileStorageConfigs).set({ bucketAccessCheckedAt: new Date(), bucketAccessError: message }).where(eq(fileStorageConfigs.id, id));
    throw new HTTPException(400, { message: `Bucket 权限探测失败：${message}` });
  }
}

function toDraftStorageConfig(data: StorageInput): FileStorageConfigRow {
  return {
    ...toStoragePayload(data),
    id: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as FileStorageConfigRow;
}

export async function probeDraftFileStorageConfigBucketAccess(data: StorageInput) {
  const storage = toDraftStorageConfig(data);
  if (!FILE_BUCKET_ACCESS_SUPPORT[storage.provider]?.probe) {
    throw new HTTPException(400, { message: `当前存储类型不支持 Bucket 权限探测：${storage.provider}` });
  }
  try {
    return mapBucketAccessInfo(await getBucketAccessInfo(storage));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HTTPException(400, { message: `Bucket 权限探测失败：${message}` });
  }
}

export async function updateDraftFileStorageConfigBucketAccess(
  data: StorageInput,
  input: { acl?: FileBucketAcl; blockPublicAccess?: boolean },
) {
  const storage = toDraftStorageConfig(data);
  const capability = FILE_BUCKET_ACCESS_SUPPORT[storage.provider];
  if (!capability?.probe) throw new HTTPException(400, { message: `当前存储类型不支持 Bucket 权限设置：${storage.provider}` });
  if (input.acl && !capability.setAcl) throw new HTTPException(400, { message: '当前存储类型不支持修改 Bucket ACL' });
  if (input.blockPublicAccess !== undefined && !capability.setBlockPublicAccess) {
    throw new HTTPException(400, { message: '当前存储类型不支持修改阻止公共访问' });
  }
  try {
    return mapBucketAccessInfo(await setBucketAccessInfo(storage, input));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HTTPException(400, { message: `Bucket 权限修改失败：${message}` });
  }
}

export async function updateFileStorageConfigBucketAccess(
  id: number,
  input: { acl?: FileBucketAcl; blockPublicAccess?: boolean },
) {
  const [row] = await db.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, id)).limit(1);
  const config = requireRow(row, '存储配置不存在');
  const capability = FILE_BUCKET_ACCESS_SUPPORT[config.provider];
  if (!capability?.probe) throw new HTTPException(400, { message: `当前存储类型不支持 Bucket 权限设置：${config.provider}` });
  if (input.acl && !capability.setAcl) throw new HTTPException(400, { message: '当前存储类型不支持修改 Bucket ACL' });
  if (input.blockPublicAccess !== undefined && !capability.setBlockPublicAccess) {
    throw new HTTPException(400, { message: '当前存储类型不支持修改阻止公共访问' });
  }
  try {
    const info = await setBucketAccessInfo(config, input);
    await persistBucketAccess(id, info);
    return mapBucketAccessInfo(info);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HTTPException(400, { message: `Bucket 权限修改失败：${message}` });
  }
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
  requireRow(current, '文件配置不存在');
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
