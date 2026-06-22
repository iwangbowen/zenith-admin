import { eq, desc, and, isNull, isNotNull, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { maintenanceMode, maintenanceLogs } from '../db/schema';
import type { DbExecutor } from '../db/types';
import { currentUser } from '../lib/context';
import { withPagination } from '../lib/where-helpers';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../lib/datetime';
import type { MaintenanceLog } from '@zenith/shared';

export interface MaintenanceStatus {
  enabled: boolean;
  message: string;
  estimatedEndAt: string | null;
  startedAt: string | null;
  startedByName: string | null;
  updatedAt: string;
}

// ── In-memory cache (5 s TTL) ─────────────────────────────────────────────
let cached: MaintenanceStatus | null = null;
let cacheExpiry = 0;

export function invalidateMaintenanceCache() {
  cached = null;
  cacheExpiry = 0;
}

function mapRow(row: typeof maintenanceMode.$inferSelect): MaintenanceStatus {
  return {
    enabled: row.enabled,
    message: row.message,
    estimatedEndAt: formatNullableDateTime(row.estimatedEndAt),
    startedAt: formatNullableDateTime(row.startedAt),
    startedByName: row.startedByName ?? null,
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 读取维护模式状态（带 5 s 内存缓存，避免每请求查库） */
export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const now = Date.now();
  if (cached && now < cacheExpiry) return cached;

  const [row] = await db.select().from(maintenanceMode).where(eq(maintenanceMode.id, 1)).limit(1);
  if (!row) {
    cached = {
      enabled: false,
      message: '系统维护中，请稍后重试',
      estimatedEndAt: null,
      startedAt: null,
      startedByName: null,
      updatedAt: formatDateTime(new Date()),
    };
  } else {
    cached = mapRow(row);
  }
  cacheExpiry = now + 5000;
  return cached;
}

export interface UpdateMaintenanceInput {
  enabled: boolean;
  message?: string;
  estimatedEndAt?: string | null;
}

/** 更新维护模式状态（upsert id=1），并按状态变更记录维护时段日志 */
export async function updateMaintenanceStatus(input: UpdateMaintenanceInput): Promise<MaintenanceStatus> {
  const user = currentUser();
  const now = new Date();
  const message = input.message ?? '系统维护中，请稍后重试';
  const estimatedEndAt = input.estimatedEndAt ? parseDateTimeInput(input.estimatedEndAt) : null;

  const row = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: maintenanceMode.id, enabled: maintenanceMode.enabled })
      .from(maintenanceMode)
      .where(eq(maintenanceMode.id, 1))
      .limit(1);
    const wasEnabled = existing?.enabled ?? false;

    const values: Partial<typeof maintenanceMode.$inferInsert> = {
      enabled: input.enabled,
      message,
      estimatedEndAt,
      updatedAt: now,
    };

    if (input.enabled) {
      values.startedAt = now;
      values.startedByName = user.username;
    } else {
      values.startedAt = null;
      values.startedByName = null;
    }

    let updated: typeof maintenanceMode.$inferSelect;
    if (existing) {
      [updated] = await tx.update(maintenanceMode).set(values).where(eq(maintenanceMode.id, 1)).returning();
    } else {
      [updated] = await tx.insert(maintenanceMode).values({ id: 1, ...values } as typeof maintenanceMode.$inferInsert).returning();
    }

    await recordMaintenanceLog(tx, { wasEnabled, nowEnabled: input.enabled, message, estimatedEndAt, now });

    return updated;
  });

  invalidateMaintenanceCache();
  return mapRow(row);
}

interface RecordLogParams {
  wasEnabled: boolean;
  nowEnabled: boolean;
  message: string;
  estimatedEndAt: Date | null;
  now: Date;
}

/** 根据维护模式状态迁移写入/更新维护时段记录（在事务内调用） */
async function recordMaintenanceLog(tx: DbExecutor, p: RecordLogParams): Promise<void> {
  const user = currentUser();

  if (!p.wasEnabled && p.nowEnabled) {
    // OFF → ON：开启新的维护时段
    await tx.insert(maintenanceLogs).values({
      message: p.message,
      estimatedEndAt: p.estimatedEndAt,
      startedAt: p.now,
      startedById: user.userId,
      startedByName: user.username,
    });
    return;
  }

  // 查找当前进行中的时段（endedAt 为空）
  const [ongoing] = await tx
    .select({ id: maintenanceLogs.id, startedAt: maintenanceLogs.startedAt })
    .from(maintenanceLogs)
    .where(isNull(maintenanceLogs.endedAt))
    .orderBy(desc(maintenanceLogs.startedAt))
    .limit(1);
  if (!ongoing) return;

  if (p.wasEnabled && !p.nowEnabled) {
    // ON → OFF：关闭维护时段，结算时长
    const durationSeconds = Math.max(0, Math.round((p.now.getTime() - ongoing.startedAt.getTime()) / 1000));
    await tx.update(maintenanceLogs).set({
      endedAt: p.now,
      endedById: user.userId,
      endedByName: user.username,
      durationSeconds,
    }).where(eq(maintenanceLogs.id, ongoing.id));
  } else if (p.wasEnabled && p.nowEnabled) {
    // ON → ON：仅更新进行中时段的提示与预计结束时间，不改变开始时间
    await tx.update(maintenanceLogs).set({
      message: p.message,
      estimatedEndAt: p.estimatedEndAt,
    }).where(eq(maintenanceLogs.id, ongoing.id));
  }
}

function mapMaintenanceLog(row: typeof maintenanceLogs.$inferSelect): MaintenanceLog {
  return {
    id: row.id,
    message: row.message,
    estimatedEndAt: formatNullableDateTime(row.estimatedEndAt),
    startedAt: formatNullableDateTime(row.startedAt),
    startedByName: row.startedByName ?? null,
    endedAt: formatNullableDateTime(row.endedAt),
    endedByName: row.endedByName ?? null,
    durationSeconds: row.durationSeconds ?? null,
    status: row.endedAt ? 'completed' : 'ongoing',
    createdAt: formatDateTime(row.createdAt),
  };
}

export interface ListMaintenanceLogsQuery {
  page?: number;
  pageSize?: number;
  status?: 'ongoing' | 'completed';
}

/** 维护记录分页查询（按开始时间倒序） */
export async function listMaintenanceLogs(q: ListMaintenanceLogsQuery) {
  const page = Number(q.page) || 1;
  const pageSize = Number(q.pageSize) || 10;

  const conditions: SQL[] = [];
  if (q.status === 'ongoing') conditions.push(isNull(maintenanceLogs.endedAt));
  if (q.status === 'completed') conditions.push(isNotNull(maintenanceLogs.endedAt));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [total, rows] = await Promise.all([
    db.$count(maintenanceLogs, where),
    withPagination(
      db.select().from(maintenanceLogs).where(where).orderBy(desc(maintenanceLogs.startedAt)).$dynamic(),
      page,
      pageSize,
    ),
  ]);

  return { list: rows.map(mapMaintenanceLog), total, page, pageSize };
}
