import { eq, ilike, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { dataMaskConfigs } from '../db/schema';
import { formatDateTime } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { applyMask } from '../lib/masking';
import { escapeLike, withPagination } from '../lib/where-helpers';
import type { DataMaskConfigRow } from '../db/schema';
import type { DataMaskConfig, CustomMaskRule, MaskType, CreateDataMaskConfigInput, UpdateDataMaskConfigInput } from '@zenith/shared';

// ─── 内存缓存（TTL 5 分钟）───────────────────────────────────────────────────

let cachedRules: DataMaskConfigRow[] | null = null;
let cacheExpiry = 0;

async function getActiveRules(): Promise<DataMaskConfigRow[]> {
  if (cachedRules && Date.now() < cacheExpiry) return cachedRules;
  cachedRules = await db.select().from(dataMaskConfigs).where(eq(dataMaskConfigs.enabled, true));
  cacheExpiry = Date.now() + 5 * 60 * 1000;
  return cachedRules;
}

export function invalidateMaskCache(): void {
  cachedRules = null;
}

// ─── 映射 ─────────────────────────────────────────────────────────────────────

export function mapDataMaskConfig(row: DataMaskConfigRow): DataMaskConfig {
  return {
    id:              row.id,
    entity:          row.entity,
    field:           row.field,
    label:           row.label,
    maskType:        row.maskType as MaskType,
    customRule:      (row.customRule as CustomMaskRule) ?? null,
    exemptRoleCodes: (row.exemptRoleCodes as string[]) ?? [],
    enabled:         row.enabled,
    remark:          row.remark ?? null,
    createdAt:       formatDateTime(row.createdAt),
    updatedAt:       formatDateTime(row.updatedAt),
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listDataMaskConfigs(query: { page?: number; pageSize?: number; keyword?: string } = {}) {
  const { page = 1, pageSize = 20, keyword } = query;
  const where = keyword
    ? or(ilike(dataMaskConfigs.entity, `%${escapeLike(keyword)}%`), ilike(dataMaskConfigs.field, `%${escapeLike(keyword)}%`), ilike(dataMaskConfigs.label, `%${escapeLike(keyword)}%`))
    : undefined;
  const [total, rows] = await Promise.all([
    db.$count(dataMaskConfigs, where),
    withPagination(
      db.select().from(dataMaskConfigs).where(where).orderBy(dataMaskConfigs.entity, dataMaskConfigs.field).$dynamic(),
      page, pageSize,
    ),
  ]);
  return { list: rows.map(mapDataMaskConfig), total, page, pageSize };
}

export async function getDataMaskConfig(id: number): Promise<DataMaskConfig> {
  const [row] = await db.select().from(dataMaskConfigs).where(eq(dataMaskConfigs.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '脱敏规则不存在' });
  return mapDataMaskConfig(row);
}

export async function createDataMaskConfig(input: CreateDataMaskConfigInput): Promise<DataMaskConfig> {
  try {
    const [row] = await db.insert(dataMaskConfigs).values({
      entity:          input.entity,
      field:           input.field,
      label:           input.label,
      maskType:        input.maskType,
      customRule:      input.customRule ?? null,
      exemptRoleCodes: input.exemptRoleCodes,
      enabled:         input.enabled,
      remark:          input.remark ?? null,
    }).returning();
    invalidateMaskCache();
    return mapDataMaskConfig(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, `实体 ${input.entity} 的字段 ${input.field} 脱敏规则已存在`);
    throw err;
  }
}

export async function updateDataMaskConfig(id: number, input: UpdateDataMaskConfigInput): Promise<DataMaskConfig> {
  const [row] = await db.update(dataMaskConfigs)
    .set({
      ...(input.entity          !== undefined && { entity:          input.entity }),
      ...(input.field           !== undefined && { field:           input.field }),
      ...(input.label           !== undefined && { label:           input.label }),
      ...(input.maskType        !== undefined && { maskType:        input.maskType }),
      ...(input.customRule      !== undefined && { customRule:      input.customRule }),
      ...(input.exemptRoleCodes !== undefined && { exemptRoleCodes: input.exemptRoleCodes }),
      ...(input.enabled         !== undefined && { enabled:         input.enabled }),
      ...(input.remark          !== undefined && { remark:          input.remark }),
    })
    .where(eq(dataMaskConfigs.id, id))
    .returning();
  if (!row) throw new Error('规则不存在');
  invalidateMaskCache();
  return mapDataMaskConfig(row);
}

export async function deleteDataMaskConfig(id: number): Promise<void> {
  await db.delete(dataMaskConfigs).where(eq(dataMaskConfigs.id, id));
  invalidateMaskCache();
}

// ─── 脱敏应用 ─────────────────────────────────────────────────────────────────

/**
 * 对目标实体的某个对象应用数据脱敏。
 * @param entity    实体名称，如 'user'
 * @param obj       需要脱敏的对象（会克隆，不修改原对象）
 * @param viewerRoleCodes  当前查看者的角色 code 列表
 */
export async function applyEntityMasking<T extends Record<string, unknown>>(
  entity: string,
  obj: T,
  viewerRoleCodes: string[],
): Promise<T> {
  const rules = await getActiveRules();
  const entityRules = rules.filter((r) => r.entity === entity);
  if (entityRules.length === 0) return obj;

  const result = { ...obj };
  for (const rule of entityRules) {
    const exempt = (rule.exemptRoleCodes as string[]) ?? [];
    const isBypassed = viewerRoleCodes.some((code) => exempt.includes(code));
    if (isBypassed) continue;

    const raw = result[rule.field];
    if (typeof raw !== 'string') continue;
    (result as Record<string, unknown>)[rule.field] = applyMask(raw, rule.maskType as MaskType, rule.customRule as CustomMaskRule | null) as unknown;
  }
  return result;
}
