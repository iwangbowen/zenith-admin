import { eq } from 'drizzle-orm';
import { db } from '../db';
import { maintenanceMode } from '../db/schema';
import { currentUser } from '../lib/context';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../lib/datetime';

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

/** 更新维护模式状态（upsert id=1） */
export async function updateMaintenanceStatus(input: UpdateMaintenanceInput): Promise<MaintenanceStatus> {
  const user = currentUser();
  const now = new Date();

  const values: Partial<typeof maintenanceMode.$inferInsert> = {
    enabled: input.enabled,
    message: input.message ?? '系统维护中，请稍后重试',
    estimatedEndAt: input.estimatedEndAt ? parseDateTimeInput(input.estimatedEndAt) : null,
    updatedAt: now,
  };

  if (input.enabled) {
    values.startedAt = now;
    values.startedByName = user.username;
  } else {
    values.startedAt = null;
    values.startedByName = null;
  }

  const [existing] = await db.select({ id: maintenanceMode.id }).from(maintenanceMode).where(eq(maintenanceMode.id, 1)).limit(1);

  let row: typeof maintenanceMode.$inferSelect;
  if (existing) {
    [row] = await db.update(maintenanceMode).set(values).where(eq(maintenanceMode.id, 1)).returning();
  } else {
    [row] = await db.insert(maintenanceMode).values({ id: 1, ...values } as typeof maintenanceMode.$inferInsert).returning();
  }

  invalidateMaintenanceCache();
  return mapRow(row);
}
