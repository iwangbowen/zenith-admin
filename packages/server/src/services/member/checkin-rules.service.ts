import { asc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { checkinRules } from '../../db/schema';
import type { CheckinRuleRow } from '../../db/schema';
import { formatTimestamps } from '../../lib/datetime';
import { requireFirstRow } from '../../lib/db-assert';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';

function mapCheckinRule(row: CheckinRuleRow) {
  return {
    id: row.id,
    dayNumber: row.dayNumber,
    points: row.points,
    experience: row.experience,
    remark: row.remark ?? null,
    ...formatTimestamps(row),
  };
}

export async function listCheckinRules() {
  const rows = await db.select().from(checkinRules).orderBy(asc(checkinRules.dayNumber));
  return rows.map(mapCheckinRule);
}

export async function ensureCheckinRuleExists(id: number): Promise<CheckinRuleRow> {
  return requireFirstRow(db.select().from(checkinRules).where(eq(checkinRules.id, id)).limit(1), '签到规则不存在');
}

export async function createCheckinRule(data: {
  dayNumber: number;
  points: number;
  experience: number;
  remark?: string | null;
}) {
  try {
    const [row] = await db.insert(checkinRules).values({
      dayNumber: data.dayNumber,
      points: data.points,
      experience: data.experience,
      remark: data.remark ?? null,
    }).returning();
    return mapCheckinRule(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, `第 ${data.dayNumber} 天的签到规则已存在`);
    throw err;
  }
}

export async function updateCheckinRule(id: number, data: Partial<{
  dayNumber: number;
  points: number;
  experience: number;
  remark: string | null;
}>) {
  await ensureCheckinRuleExists(id);
  const patch: Record<string, unknown> = {};
  if (data.dayNumber !== undefined) patch.dayNumber = data.dayNumber;
  if (data.points !== undefined) patch.points = data.points;
  if (data.experience !== undefined) patch.experience = data.experience;
  if (data.remark !== undefined) patch.remark = data.remark;
  try {
    const [row] = await db.update(checkinRules).set(patch).where(eq(checkinRules.id, id)).returning();
    return mapCheckinRule(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, `第 ${data.dayNumber ?? ''} 天的签到规则已存在`.trim());
    throw err;
  }
}

export async function deleteCheckinRule(id: number) {
  await ensureCheckinRuleExists(id);
  await db.delete(checkinRules).where(eq(checkinRules.id, id));
}
