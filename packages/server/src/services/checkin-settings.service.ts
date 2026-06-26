/**
 * 签到设置服务：单行配置（补签开关 / 补签消耗积分 / 补签可回溯天数）。
 * 采用 get-or-create，保证始终存在一条配置。
 */
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { checkinSettings } from '../db/schema';
import type { CheckinSettingsRow } from '../db/schema';
import { formatDateTime } from '../lib/datetime';

function mapSettings(row: CheckinSettingsRow) {
  return {
    makeupEnabled: row.makeupEnabled,
    makeupCostPoints: row.makeupCostPoints,
    makeupMaxDays: row.makeupMaxDays,
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function getCheckinSettingsRow(): Promise<CheckinSettingsRow> {
  const [row] = await db.select().from(checkinSettings).orderBy(asc(checkinSettings.id)).limit(1);
  if (row) return row;
  const [created] = await db.insert(checkinSettings).values({}).returning();
  return created;
}

export async function getCheckinSettings() {
  return mapSettings(await getCheckinSettingsRow());
}

export async function getCheckinSettingsBeforeAudit() {
  return getCheckinSettings();
}

export async function updateCheckinSettings(data: {
  makeupEnabled?: boolean;
  makeupCostPoints?: number;
  makeupMaxDays?: number;
}) {
  const current = await getCheckinSettingsRow();
  const patch: Record<string, unknown> = {};
  if (data.makeupEnabled !== undefined) patch.makeupEnabled = data.makeupEnabled;
  if (data.makeupCostPoints !== undefined) patch.makeupCostPoints = data.makeupCostPoints;
  if (data.makeupMaxDays !== undefined) patch.makeupMaxDays = data.makeupMaxDays;
  const [row] = await db.update(checkinSettings).set(patch).where(eq(checkinSettings.id, current.id)).returning();
  return mapSettings(row);
}
