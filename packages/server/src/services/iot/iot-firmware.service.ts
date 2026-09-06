/**
 * IoT 固件包管理：产品维度版本 + 托管文件（生成文件通道，服务端计算 sha256）。
 *
 * 版本与文件一经创建不可变更（设备按版本一致性判定升级结果），
 * 存在升级任务的固件禁止删除（FK restrict 兜底，前置校验给出友好提示）。
 */
import { HTTPException } from 'hono/http-exception';
import { createHash } from 'node:crypto';
import { count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { UpdateIotFirmwareInput } from '@zenith/shared/iot';
import { IOT_FIRMWARE_VERSION_PATTERN } from '@zenith/shared/iot';
import { db } from '../../db';
import { iotFirmwares, iotOtaTasks, iotProducts, type IotFirmwareRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import logger from '../../lib/logger';
import { deleteManagedFile, saveGeneratedManagedFile } from '../files/files.service';
import { ensureIotProductExists } from './iot-devices.service';

export function mapIotFirmware(row: IotFirmwareRow, extra?: { productName?: string | null; taskCount?: number }) {
  return {
    id: row.id,
    productId: row.productId,
    productName: extra?.productName ?? null,
    version: row.version,
    fileId: row.fileId ?? null,
    fileName: row.fileName,
    size: row.size,
    sha256: row.sha256,
    releaseNotes: row.releaseNotes ?? null,
    status: row.status,
    taskCount: extra?.taskCount ?? 0,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export interface ListIotFirmwaresQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  productId?: number;
  status?: 'enabled' | 'disabled';
}

function buildFirmwareWhere(q: ListIotFirmwaresQuery & { id?: number }): SQL | undefined {
  return buildWhere(
    q.id !== undefined ? eq(iotFirmwares.id, q.id) : undefined,
    keywordCondition(q.keyword, [iotFirmwares.version, iotFirmwares.fileName]),
    q.productId ? eq(iotFirmwares.productId, q.productId) : undefined,
    q.status ? eq(iotFirmwares.status, q.status) : undefined,
    tenantCondition(iotFirmwares, currentUser()),
  );
}

export async function listIotFirmwares(q: ListIotFirmwaresQuery) {
  const { page = 1, pageSize = 10 } = q;
  const where = buildFirmwareWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotFirmwares, where),
    rows: async () => {
      const rows = await withPagination(
        db.select({ firmware: iotFirmwares, productName: iotProducts.name })
          .from(iotFirmwares)
          .leftJoin(iotProducts, eq(iotFirmwares.productId, iotProducts.id))
          .where(where)
          .orderBy(desc(iotFirmwares.id))
          .$dynamic(),
        page,
        pageSize,
      );
      const ids = rows.map((r) => r.firmware.id);
      const taskCounts = ids.length > 0
        ? await db.select({ firmwareId: iotOtaTasks.firmwareId, cnt: count() })
          .from(iotOtaTasks).where(inArray(iotOtaTasks.firmwareId, ids)).groupBy(iotOtaTasks.firmwareId)
        : [];
      const countMap = new Map(taskCounts.map((r) => [r.firmwareId, Number(r.cnt)]));
      return rows.map((r) => mapIotFirmware(r.firmware, {
        productName: r.productName,
        taskCount: countMap.get(r.firmware.id) ?? 0,
      }));
    },
  });
}

export async function ensureIotFirmwareExists(id: number): Promise<IotFirmwareRow> {
  const [row] = await db.select().from(iotFirmwares).where(buildFirmwareWhere({ id })).limit(1);
  return requireRow(row, '固件不存在');
}

export interface CreateFirmwareMeta {
  productId: number;
  version: string;
  releaseNotes: string | null;
}

/** 上传固件包并登记（multipart：固件是任意二进制，走生成文件通道，服务端计算 sha256） */
export async function createIotFirmware(meta: CreateFirmwareMeta, file: File) {
  await ensureIotProductExists(meta.productId);
  if (!IOT_FIRMWARE_VERSION_PATTERN.test(meta.version)) {
    throw new HTTPException(400, { message: '版本号需为语义化格式，如 1.2.3 或 1.2.3-beta.1' });
  }
  if (file.size <= 0) throw new HTTPException(400, { message: '固件文件为空' });
  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const uploaded = await saveGeneratedManagedFile({
    buffer,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    tenantId: getCreateTenantId(currentUser()) ?? null,
    createdBy: currentUser().userId,
  });
  try {
    const [row] = await db.insert(iotFirmwares).values({
      productId: meta.productId,
      version: meta.version,
      fileId: uploaded.id,
      fileName: file.name,
      size: file.size,
      sha256,
      releaseNotes: meta.releaseNotes,
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    return mapIotFirmware(row);
  } catch (err) {
    // 固件行写入失败时回收刚上传的文件，避免存储残留
    try {
      await deleteManagedFile(uploaded.id);
    } catch {
      logger.warn(`[iot-firmware] 回收上传文件失败 fileId=${uploaded.id}`);
    }
    rethrowPgUniqueViolation(err, `产品下已存在版本 ${meta.version}`);
    throw err;
  }
}

export async function updateIotFirmware(id: number, data: UpdateIotFirmwareInput) {
  await ensureIotFirmwareExists(id);
  const [row] = await db.update(iotFirmwares).set({
    ...(data.releaseNotes !== undefined ? { releaseNotes: data.releaseNotes } : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
  }).where(buildFirmwareWhere({ id })).returning();
  return mapIotFirmware(row);
}

export async function deleteIotFirmware(id: number): Promise<void> {
  const row = await ensureIotFirmwareExists(id);
  const taskCount = await db.$count(iotOtaTasks, eq(iotOtaTasks.firmwareId, id));
  if (taskCount > 0) throw new HTTPException(400, { message: `该固件存在 ${taskCount} 个升级任务，不可删除` });
  await db.delete(iotFirmwares).where(buildFirmwareWhere({ id }));
  if (row.fileId) {
    try {
      await deleteManagedFile(row.fileId);
    } catch {
      logger.warn(`[iot-firmware] 删除固件文件失败 fileId=${row.fileId}`);
    }
  }
}
