/**
 * 会员等级服务：等级 CRUD + 成长值自动定级。
 */
import { and, asc, count, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { db } from '../../db';
import { memberLevels, members } from '../../db/schema';
import type { MemberLevelRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';

export interface CreateLevelInput {
  name: string;
  level: number;
  growthThreshold: number;
  discount: number;
  icon?: string | null;
  benefits?: string[];
  description?: string | null;
  sort?: number;
  status?: 'enabled' | 'disabled';
}
export type UpdateLevelInput = Partial<CreateLevelInput>;

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapLevel(row: MemberLevelRow, memberCount?: number) {
  return {
    id: row.id,
    name: row.name,
    level: row.level,
    growthThreshold: row.growthThreshold,
    discount: row.discount,
    icon: row.icon ?? null,
    benefits: row.benefits ?? [],
    description: row.description ?? null,
    sort: row.sort,
    status: row.status,
    memberCount,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 校验 ─────────────────────────────────────────────────────────────────────
export async function ensureLevelExists(id: number): Promise<MemberLevelRow> {
  const [row] = await db.select().from(memberLevels).where(eq(memberLevels.id, id)).limit(1);
  return requireRow(row, '会员等级不存在');
}

// ─── 列表 ─────────────────────────────────────────────────────────────────────
/** 后台：所有等级 + 各等级会员数 */
export async function listLevels() {
  const rows = await db.select().from(memberLevels).orderBy(asc(memberLevels.level));
  // 单条 GROUP BY 聚合，替代按等级逐条 COUNT（等级数增长时会线性放大查询数与连接占用）
  const levelIds = rows.map((r) => r.id);
  const countRows = levelIds.length
    ? await db
        .select({ levelId: members.levelId, n: count() })
        .from(members)
        .where(and(inArray(members.levelId, levelIds), isNull(members.deletedAt)))
        .groupBy(members.levelId)
    : [];
  const countMap = new Map(countRows.map((r) => [r.levelId, r.n]));
  return rows.map((r) => mapLevel(r, countMap.get(r.id) ?? 0));
}

/** 前台：仅启用等级（用于展示等级权益）*/
export async function getEnabledLevels() {
  const rows = await db.select().from(memberLevels).where(eq(memberLevels.status, 'enabled')).orderBy(asc(memberLevels.level));
  return rows.map((r) => mapLevel(r));
}

export async function getLevel(id: number) {
  return mapLevel(await ensureLevelExists(id));
}

// ─── 写操作 ───────────────────────────────────────────────────────────────────
export async function createLevel(input: CreateLevelInput) {
  try {
    const [row] = await db
      .insert(memberLevels)
      .values({
        name: input.name,
        level: input.level,
        growthThreshold: input.growthThreshold,
        discount: input.discount,
        icon: input.icon ?? null,
        benefits: input.benefits ?? [],
        description: input.description ?? null,
        sort: input.sort ?? 0,
        status: input.status ?? 'enabled',
      })
      .returning();
    return mapLevel(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该等级序号已存在');
    throw err;
  }
}

export async function updateLevel(id: number, input: UpdateLevelInput) {
  await ensureLevelExists(id);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.level !== undefined) patch.level = input.level;
  if (input.growthThreshold !== undefined) patch.growthThreshold = input.growthThreshold;
  if (input.discount !== undefined) patch.discount = input.discount;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.benefits !== undefined) patch.benefits = input.benefits;
  if (input.description !== undefined) patch.description = input.description;
  if (input.sort !== undefined) patch.sort = input.sort;
  if (input.status !== undefined) patch.status = input.status;
  try {
    const [row] = await db.update(memberLevels).set(patch).where(eq(memberLevels.id, id)).returning();
    return mapLevel(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该等级序号已存在');
    throw err;
  }
}

export async function deleteLevel(id: number) {
  await ensureLevelExists(id);
  // members.levelId 外键为 ON DELETE SET NULL，删除后相关会员等级置空
  await db.delete(memberLevels).where(eq(memberLevels.id, id));
}

// ─── 成长值与自动定级 ─────────────────────────────────────────────────────────
/**
 * 在给定执行器（事务/连接）内应用成长值变动并按阈值自动重定级。
 * 供签到、补签、后台调整等业务在自身事务内复用，保证成长值与等级同事务一致。
 */
export async function applyGrowthDeltaInTx(executor: DbExecutor, memberId: number, delta: number): Promise<void> {
  const [m] = await executor
    .select({ growthValue: members.growthValue })
    .from(members)
    .where(and(eq(members.id, memberId), isNull(members.deletedAt)))
    .limit(1);
  const member = requireRow(m, '会员不存在');
  const newGrowth = Math.max(0, member.growthValue + delta);
  const [level] = await executor
    .select({ id: memberLevels.id })
    .from(memberLevels)
    .where(and(eq(memberLevels.status, 'enabled'), lte(memberLevels.growthThreshold, newGrowth)))
    .orderBy(desc(memberLevels.growthThreshold))
    .limit(1);
  await executor.update(members).set({ growthValue: newGrowth, levelId: level?.id ?? null }).where(eq(members.id, memberId));
}

/** 增加（或减少）会员成长值，并按成长值阈值自动调整等级 */
export async function addGrowthValue(memberId: number, delta: number): Promise<void> {
  await db.transaction((tx) => applyGrowthDeltaInTx(tx, memberId, delta));
}
