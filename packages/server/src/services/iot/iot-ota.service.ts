import { iotOtaTaskContract } from '@zenith/shared/iot';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * IoT OTA 升级：任务创建 / 设备状态机 / 协议下发 / 版本确认 / 超时收敛。
 *
 * 单设备状态机：pending →(WS 推送或心跳捎带)→ notified →(设备回报)→ downloading → installing
 *              → succeeded / failed；任务取消时未终态设备一并 cancelled。
 * 成功判定双通道：设备显式回报 succeeded，或遥测上报的 firmwareVersion 与目标版本一致
 * （与影子收敛同一语义）；超时未终态由每分钟扫描判 failed。
 * 全部设备进入终态后任务收敛为 completed。
 */
import { HTTPException } from 'hono/http-exception';
import { and, count, desc, eq, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { CreateIotOtaTaskInput, IotOtaPayload, IotOtaProgressInput } from '@zenith/shared/iot';
import { IOT_BATCH_DEVICE_MAX } from '@zenith/shared/iot';
import { db } from '../../db';
import {
  iotDevices, iotFirmwares, iotOtaTaskDevices, iotOtaTasks, iotProducts,
  type IotDeviceRow, type IotFirmwareRow, type IotOtaTaskDeviceRow, type IotOtaTaskRow,
} from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import logger from '../../lib/logger';
import { openEventBus } from '../../lib/open-event-bus';
import { pushOtaToDevice } from './iot-gateway.service';
import { ensureIotFirmwareExists } from './iot-firmware.service';
import { resolveIotBatchTargets } from './iot-groups.service';

// ─── 映射 ─────────────────────────────────────────────────────────────────────
export function mapIotOtaTask(row: IotOtaTaskRow, extra?: { productName?: string | null }) {
  const totalBatches = row.batchSize ? Math.ceil(row.totalCount / row.batchSize) : 1;
  return {
    id: row.id,
    title: row.title,
    firmwareId: row.firmwareId,
    productId: row.productId,
    productName: extra?.productName ?? null,
    firmwareVersion: row.firmwareVersion,
    status: row.status,
    timeoutMinutes: row.timeoutMinutes,
    batchSize: row.batchSize ?? null,
    currentBatch: row.currentBatch,
    totalBatches,
    failureThreshold: row.failureThreshold ?? null,
    totalCount: row.totalCount,
    succeededCount: row.succeededCount,
    failedCount: row.failedCount,
    createdBy: row.createdBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapIotOtaTaskDevice(
  row: IotOtaTaskDeviceRow,
  extra?: { deviceName?: string | null; deviceSn?: string | null; online?: boolean },
) {
  return {
    id: row.id,
    taskId: row.taskId,
    deviceId: row.deviceId,
    deviceName: extra?.deviceName ?? null,
    deviceSn: extra?.deviceSn ?? null,
    online: extra?.online ?? false,
    status: row.status,
    progress: row.progress,
    fromVersion: row.fromVersion ?? null,
    batchIndex: row.batchIndex,
    errorMsg: row.errorMsg ?? null,
    notifiedAt: formatNullableDateTime(row.notifiedAt),
    finishedAt: formatNullableDateTime(row.finishedAt),
  };
}

// ─── 任务查询 ─────────────────────────────────────────────────────────────────
export type ListIotOtaTasksFilter = Omit<QueryOutputOf<typeof iotOtaTaskContract.list>, 'page' | 'pageSize'>;

function buildTaskWhere(q: ListIotOtaTasksFilter & { id?: number }): SQL | undefined {
  return buildWhere(
    q.id !== undefined ? eq(iotOtaTasks.id, q.id) : undefined,
    keywordCondition(q.keyword, [iotOtaTasks.title, iotOtaTasks.firmwareVersion]),
    q.productId ? eq(iotOtaTasks.productId, q.productId) : undefined,
    q.status ? eq(iotOtaTasks.status, q.status) : undefined,
    tenantCondition(iotOtaTasks, currentUser()),
  );
}

export async function listIotOtaTasks(q: QueryOutputOf<typeof iotOtaTaskContract.list>) {
  const { page, pageSize } = q;
  const where = buildTaskWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotOtaTasks, where),
    rows: () => withPagination(
      db.select({ task: iotOtaTasks, productName: iotProducts.name })
        .from(iotOtaTasks)
        .leftJoin(iotProducts, eq(iotOtaTasks.productId, iotProducts.id))
        .where(where)
        .orderBy(desc(iotOtaTasks.id))
        .$dynamic(),
      page,
      pageSize,
    ),
    map: (r) => mapIotOtaTask(r.task, { productName: r.productName }),
  });
}

export async function ensureIotOtaTaskExists(id: number): Promise<IotOtaTaskRow> {
  const [row] = await db.select().from(iotOtaTasks).where(buildTaskWhere({ id })).limit(1);
  return requireRow(row, '升级任务不存在');
}

export async function getIotOtaTask(id: number) {
  const row = await ensureIotOtaTaskExists(id);
  const [product] = await db.select({ name: iotProducts.name })
    .from(iotProducts).where(eq(iotProducts.id, row.productId)).limit(1);
  return mapIotOtaTask(row, { productName: product?.name ?? null });
}

export async function listIotOtaTaskDevices(taskId: number, q: QueryOutputOf<typeof iotOtaTaskContract.devices>) {
  await ensureIotOtaTaskExists(taskId);
  const { page, pageSize } = q;
  const where = buildWhere(
    eq(iotOtaTaskDevices.taskId, taskId),
    q.status ? eq(iotOtaTaskDevices.status, q.status) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotOtaTaskDevices, where),
    rows: () => withPagination(
      db.select({ row: iotOtaTaskDevices, deviceName: iotDevices.name, deviceSn: iotDevices.sn })
        .from(iotOtaTaskDevices)
        .innerJoin(iotDevices, eq(iotOtaTaskDevices.deviceId, iotDevices.id))
        .where(where)
        .orderBy(desc(iotOtaTaskDevices.id))
        .$dynamic(),
      page,
      pageSize,
    ),
    map: (r) => mapIotOtaTaskDevice(r.row, { deviceName: r.deviceName, deviceSn: r.deviceSn }),
  });
}

// ─── 任务创建与取消 ───────────────────────────────────────────────────────────
function buildOtaPayload(taskId: number, firmware: Pick<IotFirmwareRow, 'version' | 'fileName' | 'size' | 'sha256'>): IotOtaPayload {
  return {
    taskId,
    version: firmware.version,
    fileName: firmware.fileName,
    size: firmware.size,
    sha256: firmware.sha256,
    downloadPath: `/api/iot/ingest/ota/firmware?taskId=${taskId}`,
  };
}

export async function createIotOtaTask(input: CreateIotOtaTaskInput) {
  const firmware = await ensureIotFirmwareExists(input.firmwareId);
  if (firmware.status !== 'enabled') throw new HTTPException(400, { message: '固件已禁用，无法下发升级' });
  if (!firmware.fileId) throw new HTTPException(400, { message: '固件文件已被删除，无法下发升级' });

  // 目标集：显式设备/分组 或 产品下全部启用设备；统一校验产品归属
  let deviceRows: Array<Pick<IotDeviceRow, 'id' | 'sn' | 'firmwareVersion' | 'productId' | 'status'>>;
  if (input.allDevices) {
    deviceRows = await db.select({
      id: iotDevices.id, sn: iotDevices.sn, firmwareVersion: iotDevices.firmwareVersion,
      productId: iotDevices.productId, status: iotDevices.status,
    })
      .from(iotDevices)
      .where(buildWhere(
        eq(iotDevices.productId, firmware.productId),
        eq(iotDevices.status, 'enabled'),
        tenantCondition(iotDevices, currentUser()),
      ))
      .limit(IOT_BATCH_DEVICE_MAX + 1);
    if (deviceRows.length > IOT_BATCH_DEVICE_MAX) {
      throw new HTTPException(400, { message: `产品设备数超过单任务上限 ${IOT_BATCH_DEVICE_MAX}，请分批（按分组）下发` });
    }
  } else {
    const targets = await resolveIotBatchTargets(input.deviceIds, input.groupId, IOT_BATCH_DEVICE_MAX);
    deviceRows = await db.select({
      id: iotDevices.id, sn: iotDevices.sn, firmwareVersion: iotDevices.firmwareVersion,
      productId: iotDevices.productId, status: iotDevices.status,
    })
      .from(iotDevices)
      .where(inArray(iotDevices.id, targets.deviceIds));
  }
  const eligible = deviceRows.filter((d) =>
    d.productId === firmware.productId && d.status === 'enabled' && d.firmwareVersion !== firmware.version);
  if (eligible.length === 0) {
    throw new HTTPException(400, { message: '没有可升级的目标设备（需属于该固件产品、启用且版本不同）' });
  }

  const task = await db.transaction(async (tx) => {
    const [created] = await tx.insert(iotOtaTasks).values({
      title: `升级到 v${firmware.version}（${eligible.length} 台）`,
      firmwareId: firmware.id,
      productId: firmware.productId,
      firmwareVersion: firmware.version,
      timeoutMinutes: input.timeoutMinutes,
      batchSize: input.batchSize ?? null,
      failureThreshold: input.failureThreshold ?? null,
      totalCount: eligible.length,
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    // 灰度分批：按目标顺序切批（batchSize 为空 = 全量一批）
    const size = input.batchSize ?? eligible.length;
    await tx.insert(iotOtaTaskDevices).values(eligible.map((d, i) => ({
      taskId: created.id,
      deviceId: d.id,
      fromVersion: d.firmwareVersion ?? null,
      batchIndex: Math.floor(i / size) + 1,
    })));
    return created;
  });

  // 仅首批推送：WS 在线设备立即推（成功即 notified）；离线设备留 pending 等心跳/上线捎带
  const size = input.batchSize ?? eligible.length;
  const firstBatch = eligible.slice(0, size);
  const payload = buildOtaPayload(task.id, firmware);
  const notifiedIds: number[] = [];
  for (const d of firstBatch) {
    if (pushOtaToDevice(d.sn, payload, { taskId: task.id, deviceId: d.id })) notifiedIds.push(d.id);
  }
  if (notifiedIds.length > 0) {
    await db.update(iotOtaTaskDevices)
      .set({ status: 'notified', notifiedAt: new Date() })
      .where(and(eq(iotOtaTaskDevices.taskId, task.id), inArray(iotOtaTaskDevices.deviceId, notifiedIds)));
  }
  return getIotOtaTask(task.id);
}

/** 放量下一批（灰度）：running/paused 任务推进 currentBatch 并推送该批在线设备；paused 恢复 running */
export async function releaseNextIotOtaBatch(id: number) {
  const task = await ensureIotOtaTaskExists(id);
  if (task.status !== 'running' && task.status !== 'paused') {
    throw new HTTPException(400, { message: '任务已结束，无法放量' });
  }
  const totalBatches = task.batchSize ? Math.ceil(task.totalCount / task.batchSize) : 1;
  if (task.currentBatch >= totalBatches) throw new HTTPException(400, { message: '已是最后一批，无可放量批次' });
  const nextBatch = task.currentBatch + 1;

  const [firmware] = await db.select().from(iotFirmwares).where(eq(iotFirmwares.id, task.firmwareId)).limit(1);
  if (!firmware?.fileId) throw new HTTPException(400, { message: '固件文件已被删除，无法继续放量' });

  await db.update(iotOtaTasks)
    .set({ currentBatch: nextBatch, status: 'running' })
    .where(eq(iotOtaTasks.id, id));

  // 推送新批在线设备
  const batchDevices = await db.select({ deviceId: iotOtaTaskDevices.deviceId, sn: iotDevices.sn })
    .from(iotOtaTaskDevices)
    .innerJoin(iotDevices, eq(iotOtaTaskDevices.deviceId, iotDevices.id))
    .where(and(
      eq(iotOtaTaskDevices.taskId, id),
      eq(iotOtaTaskDevices.batchIndex, nextBatch),
      eq(iotOtaTaskDevices.status, 'pending'),
    ));
  const payload = buildOtaPayload(id, firmware);
  const notifiedIds: number[] = [];
  for (const d of batchDevices) {
    if (pushOtaToDevice(d.sn, payload, { taskId: id, deviceId: d.deviceId })) notifiedIds.push(d.deviceId);
  }
  if (notifiedIds.length > 0) {
    await db.update(iotOtaTaskDevices)
      .set({ status: 'notified', notifiedAt: new Date() })
      .where(and(eq(iotOtaTaskDevices.taskId, id), inArray(iotOtaTaskDevices.deviceId, notifiedIds)));
  }
  return getIotOtaTask(id);
}

/** 恢复被熔断暂停的任务（不放量，继续当前批） */
export async function resumeIotOtaTask(id: number) {
  const task = await ensureIotOtaTaskExists(id);
  if (task.status !== 'paused') throw new HTTPException(400, { message: '仅暂停中的任务可恢复' });
  await db.update(iotOtaTasks).set({ status: 'running' }).where(eq(iotOtaTasks.id, id));
  await convergeOtaTask(id);
  return getIotOtaTask(id);
}

export async function cancelIotOtaTask(id: number) {
  const task = await ensureIotOtaTaskExists(id);
  if (task.status !== 'running' && task.status !== 'paused') {
    throw new HTTPException(400, { message: '任务已结束，无法取消' });
  }
  await db.transaction(async (tx) => {
    await tx.update(iotOtaTaskDevices)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(and(
        eq(iotOtaTaskDevices.taskId, id),
        inArray(iotOtaTaskDevices.status, ['pending', 'notified', 'downloading', 'installing']),
      ));
    await tx.update(iotOtaTasks).set({ status: 'cancelled' }).where(eq(iotOtaTasks.id, id));
  });
  return getIotOtaTask(id);
}

// ─── 任务收敛 ─────────────────────────────────────────────────────────────────
/**
 * 终态变更后重算计数与熔断判定：
 * - 熔断：配置了 failureThreshold 时，已放量范围内失败占比达阈值 → 任务 paused（人工恢复/放量）
 * - 完成：全部设备终态（未放量批次的 pending 天然阻止提前完成）→ completed + 开放 Webhook
 */
async function convergeOtaTask(taskId: number): Promise<void> {
  const [task] = await db.select().from(iotOtaTasks).where(eq(iotOtaTasks.id, taskId)).limit(1);
  if (!task || (task.status !== 'running' && task.status !== 'paused')) return;

  const rows = await db.select({ status: iotOtaTaskDevices.status, cnt: count() })
    .from(iotOtaTaskDevices)
    .where(eq(iotOtaTaskDevices.taskId, taskId))
    .groupBy(iotOtaTaskDevices.status);
  const by = new Map(rows.map((r) => [r.status, Number(r.cnt)]));
  const active = (by.get('pending') ?? 0) + (by.get('notified') ?? 0)
    + (by.get('downloading') ?? 0) + (by.get('installing') ?? 0);
  const succeededCount = by.get('succeeded') ?? 0;
  const failedCount = by.get('failed') ?? 0;

  // 熔断判定：仅 running 任务；已放量范围 = batchIndex <= currentBatch
  if (task.status === 'running' && task.failureThreshold != null && failedCount > 0) {
    const [released] = await db.select({
      total: count(),
      failed: sql<number>`count(*) filter (where ${iotOtaTaskDevices.status} = 'failed')`,
    }).from(iotOtaTaskDevices)
      .where(and(
        eq(iotOtaTaskDevices.taskId, taskId),
        lte(iotOtaTaskDevices.batchIndex, task.currentBatch),
      ));
    const releasedTotal = Number(released?.total ?? 0);
    const releasedFailed = Number(released?.failed ?? 0);
    if (releasedTotal > 0 && (releasedFailed / releasedTotal) * 100 >= task.failureThreshold) {
      await db.update(iotOtaTasks)
        .set({ succeededCount, failedCount, status: 'paused' })
        .where(and(eq(iotOtaTasks.id, taskId), eq(iotOtaTasks.status, 'running')));
      logger.warn(`[iot-ota] 任务 #${taskId} 失败率 ${((releasedFailed / releasedTotal) * 100).toFixed(0)}% 达熔断阈值 ${task.failureThreshold}%，已自动暂停`);
      return;
    }
  }

  const [updated] = await db.update(iotOtaTasks).set({
    succeededCount,
    failedCount,
    ...(active === 0 ? { status: 'completed' as const } : {}),
  }).where(and(eq(iotOtaTasks.id, taskId), inArray(iotOtaTasks.status, ['running', 'paused'])))
    .returning({ id: iotOtaTasks.id, status: iotOtaTasks.status, title: iotOtaTasks.title, firmwareVersion: iotOtaTasks.firmwareVersion, succeededCount: iotOtaTasks.succeededCount, failedCount: iotOtaTasks.failedCount, totalCount: iotOtaTasks.totalCount, tenantId: iotOtaTasks.tenantId });
  if (updated && updated.status === 'completed') {
    openEventBus.emit({
      type: 'iot.ota.task_completed',
      tenantId: updated.tenantId ?? null,
      data: {
        taskId: updated.id, title: updated.title, firmwareVersion: updated.firmwareVersion,
        totalCount: updated.totalCount, succeededCount: updated.succeededCount, failedCount: updated.failedCount,
      },
    });
  }
}

// ─── 设备侧协议 ───────────────────────────────────────────────────────────────
/** 设备待升级载荷（WS 上线补推 / 心跳响应捎带）；无活跃任务返回 null，取到即标 notified。仅已放量批次可见 */
export async function getPendingOtaPayload(device: IotDeviceRow): Promise<IotOtaPayload | null> {
  const [row] = await db.select({ td: iotOtaTaskDevices, task: iotOtaTasks, firmware: iotFirmwares })
    .from(iotOtaTaskDevices)
    .innerJoin(iotOtaTasks, eq(iotOtaTaskDevices.taskId, iotOtaTasks.id))
    .innerJoin(iotFirmwares, eq(iotOtaTasks.firmwareId, iotFirmwares.id))
    .where(and(
      eq(iotOtaTaskDevices.deviceId, device.id),
      inArray(iotOtaTaskDevices.status, ['pending', 'notified']),
      eq(iotOtaTasks.status, 'running'),
      lte(iotOtaTaskDevices.batchIndex, iotOtaTasks.currentBatch),
    ))
    .orderBy(desc(iotOtaTaskDevices.id))
    .limit(1);
  if (!row) return null;
  if (row.td.status === 'pending') {
    await db.update(iotOtaTaskDevices)
      .set({ status: 'notified', notifiedAt: new Date() })
      .where(and(eq(iotOtaTaskDevices.id, row.td.id), eq(iotOtaTaskDevices.status, 'pending')));
  }
  return buildOtaPayload(row.task.id, row.firmware);
}

/** 设备回报进度（ingest / WS 帧共用）：downloading/installing 更新进度，succeeded/failed 收敛 */
export async function reportIotOtaProgress(device: IotDeviceRow, input: IotOtaProgressInput): Promise<void> {
  const terminal = input.status === 'succeeded' || input.status === 'failed';
  const [maybeRow] = await db.update(iotOtaTaskDevices)
    .set({
      status: input.status,
      progress: input.status === 'succeeded' ? 100 : (input.progress ?? 0),
      errorMsg: input.status === 'failed' ? (input.errorMsg ?? '设备升级失败') : null,
      ...(terminal ? { finishedAt: new Date() } : {}),
    })
    .where(and(
      eq(iotOtaTaskDevices.taskId, input.taskId),
      eq(iotOtaTaskDevices.deviceId, device.id),
      inArray(iotOtaTaskDevices.status, ['pending', 'notified', 'downloading', 'installing']),
    ))
    .returning({ id: iotOtaTaskDevices.id });
  requireRow(maybeRow, '升级任务不存在或已结束');
  if (terminal) await convergeOtaTask(input.taskId);
}

/** 固件版本上报确认：touchDevice 检测到版本变更时调用（与影子收敛同一语义） */
export async function confirmIotOtaByVersion(deviceId: number, version: string): Promise<void> {
  const rows = await db.select({ td: iotOtaTaskDevices })
    .from(iotOtaTaskDevices)
    .innerJoin(iotOtaTasks, eq(iotOtaTaskDevices.taskId, iotOtaTasks.id))
    .where(and(
      eq(iotOtaTaskDevices.deviceId, deviceId),
      inArray(iotOtaTaskDevices.status, ['pending', 'notified', 'downloading', 'installing']),
      eq(iotOtaTasks.status, 'running'),
      eq(iotOtaTasks.firmwareVersion, version),
    ));
  for (const { td } of rows) {
    await db.update(iotOtaTaskDevices)
      .set({ status: 'succeeded', progress: 100, finishedAt: new Date() })
      .where(eq(iotOtaTaskDevices.id, td.id));
    await convergeOtaTask(td.taskId);
  }
}

/** 设备下载固件前校验：需持有该任务的活跃升级行，返回固件文件 id */
export async function ensureOtaDownloadAllowed(device: IotDeviceRow, taskId: number): Promise<string> {
  const [maybeRow] = await db.select({ fileId: iotFirmwares.fileId, tdStatus: iotOtaTaskDevices.status })
    .from(iotOtaTaskDevices)
    .innerJoin(iotOtaTasks, eq(iotOtaTaskDevices.taskId, iotOtaTasks.id))
    .innerJoin(iotFirmwares, eq(iotOtaTasks.firmwareId, iotFirmwares.id))
    .where(and(
      eq(iotOtaTaskDevices.taskId, taskId),
      eq(iotOtaTaskDevices.deviceId, device.id),
      inArray(iotOtaTaskDevices.status, ['notified', 'downloading', 'installing']),
      eq(iotOtaTasks.status, 'running'),
    ))
    .limit(1);
  const row = requireRow(maybeRow, '无该任务的有效升级授权', 403);
  if (!row.fileId) throw new HTTPException(404, { message: '固件文件已被删除' });
  return row.fileId;
}

/** 超时收敛（系统周期任务，每分钟）：已放量批次内越期未终态的设备判 failed */
export async function sweepIotOtaTimeouts(): Promise<string> {
  const running = await db.select().from(iotOtaTasks).where(eq(iotOtaTasks.status, 'running'));
  let failed = 0;
  for (const task of running) {
    const cutoff = new Date(Date.now() - task.timeoutMinutes * 60_000);
    const overdue = await db.update(iotOtaTaskDevices)
      .set({ status: 'failed', errorMsg: `超过 ${task.timeoutMinutes} 分钟未完成`, finishedAt: new Date() })
      .where(and(
        eq(iotOtaTaskDevices.taskId, task.id),
        inArray(iotOtaTaskDevices.status, ['pending', 'notified', 'downloading', 'installing']),
        lte(iotOtaTaskDevices.batchIndex, task.currentBatch),
        // 超时基准：通知时刻优先（灰度后批以放量通知起算），未通知的离线设备退回创建时刻
        lt(sql`coalesce(${iotOtaTaskDevices.notifiedAt}, ${iotOtaTaskDevices.createdAt})`, cutoff),
      ))
      .returning({ id: iotOtaTaskDevices.id });
    if (overdue.length > 0) {
      failed += overdue.length;
      await convergeOtaTask(task.id);
      logger.info(`[iot-ota] 任务 #${task.id} 超时收敛 ${overdue.length} 台设备`);
    }
  }
  return failed > 0 ? `超时判 failed ${failed} 台` : '无超时设备';
}
