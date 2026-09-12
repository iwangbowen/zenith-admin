import { eq, and, ne, desc } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import { ratePlanContract } from '@zenith/shared/open-platform';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import { clearDefaultFlag } from '../../lib/default-flag';
import { db } from '../../db';
import { ratePlans, oauth2Clients } from '../../db/schema';
import type { RatePlanRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { HTTPException } from 'hono/http-exception';
import { formatTimestamps } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import type { CreateRatePlanInput, UpdateRatePlanInput } from '@zenith/shared/open-platform';

export function mapRatePlan(row: RatePlanRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    qpsLimit: row.qpsLimit,
    dailyQuota: row.dailyQuota,
    monthlyQuota: row.monthlyQuota,
    isDefault: row.isDefault,
    status: row.status,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

export async function listRatePlans(opts: QueryOutputOf<typeof ratePlanContract.list>) {
  const { page, pageSize, keyword, status } = opts;
  const where = buildWhere(
    keywordCondition(keyword, [ratePlans.code, ratePlans.name], 'ilike'),
    status ? eq(ratePlans.status, status) : undefined,
  );

  return buildListResult({
    page: page,
    pageSize: pageSize,
    count: () => db.$count(ratePlans, where),
    rows: () => db.select().from(ratePlans)
  .where(where)
  .orderBy(desc(ratePlans.isDefault), desc(ratePlans.createdAt))
  .limit(pageSize)
  .offset(pageOffset(page, pageSize)),
    map: mapRatePlan,
  });
}

/** 全部启用的套餐（供应用配置下拉，无分页） */
export async function listEnabledRatePlans() {
  const rows = await db.select().from(ratePlans)
    .where(eq(ratePlans.status, 'enabled'))
    .orderBy(desc(ratePlans.isDefault), ratePlans.qpsLimit);
  return rows.map(mapRatePlan);
}

export async function getRatePlan(id: number) {
  const [row] = await db.select().from(ratePlans).where(eq(ratePlans.id, id)).limit(1);
  requireRow(row, '限流套餐不存在');
  return mapRatePlan(row);
}

export async function getRatePlanBeforeAudit(id: number) {
  return getRatePlan(id);
}

/** 原始行：供网关限流中间件读取配额（不映射为 DTO） */
export async function getRatePlanRowById(id: number): Promise<RatePlanRow | null> {
  const [row] = await db.select().from(ratePlans).where(eq(ratePlans.id, id)).limit(1);
  return row ?? null;
}

/** 默认套餐：应用未绑定套餐时回退使用 */
export async function getDefaultRatePlanRow(): Promise<RatePlanRow | null> {
  const [row] = await db.select().from(ratePlans)
    .where(and(eq(ratePlans.isDefault, true), eq(ratePlans.status, 'enabled')))
    .limit(1);
  return row ?? null;
}

/** 将除 keepId 外的所有套餐 isDefault 置为 false（套餐是平台级资源，默认全表唯一） */
async function clearOtherDefaults(executor: DbExecutor, keepId?: number) {
  const cond = keepId
    ? and(eq(ratePlans.isDefault, true), ne(ratePlans.id, keepId))
    : eq(ratePlans.isDefault, true);
  await clearDefaultFlag(executor, ratePlans, cond);
}

export async function createRatePlan(input: CreateRatePlanInput) {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(ratePlans).values({
        code: input.code.trim(),
        name: input.name.trim(),
        description: input.description,
        qpsLimit: input.qpsLimit ?? 10,
        dailyQuota: input.dailyQuota ?? 0,
        monthlyQuota: input.monthlyQuota ?? 0,
        isDefault: input.isDefault ?? false,
        status: input.status ?? 'enabled',
      }).returning();
      if (row.isDefault) await clearOtherDefaults(tx, row.id);
      return mapRatePlan(row);
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '套餐编码已存在');
    throw err;
  }
}

export async function updateRatePlan(id: number, input: UpdateRatePlanInput) {
  await getRatePlan(id);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.update(ratePlans).set({
        name: input.name?.trim(),
        description: input.description,
        qpsLimit: input.qpsLimit,
        dailyQuota: input.dailyQuota,
        monthlyQuota: input.monthlyQuota,
        isDefault: input.isDefault,
        status: input.status,
      }).where(eq(ratePlans.id, id)).returning();
      if (row.isDefault) await clearOtherDefaults(tx, row.id);
      return mapRatePlan(row);
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '套餐编码已存在');
    throw err;
  }
}

export async function deleteRatePlan(id: number) {
  const [existing] = await db.select({ isDefault: ratePlans.isDefault, name: ratePlans.name })
    .from(ratePlans)
    .where(eq(ratePlans.id, id))
    .limit(1);
  requireRow(existing, '限流套餐不存在');
  // 默认套餐是所有未显式绑定套餐的应用的回退目标，删掉会让这些应用的限流行为悬空
  if (existing.isDefault) {
    throw new HTTPException(400, { message: '默认套餐不可删除，请先将其他套餐设为默认' });
  }
  const usedBy = await db.$count(oauth2Clients, eq(oauth2Clients.ratePlanId, id));
  if (usedBy > 0) {
    throw new HTTPException(400, { message: `该套餐已被 ${usedBy} 个应用绑定，无法删除` });
  }
  const result = await db.delete(ratePlans).where(eq(ratePlans.id, id)).returning();
  requireRow(result[0], '限流套餐不存在');
}
