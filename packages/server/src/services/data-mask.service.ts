import { eq, ilike, or, and, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { dataMaskConfigs } from '../db/schema';
import { formatDateTime } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { applyMask } from '../lib/masking';
import { escapeLike, withPagination } from '../lib/where-helpers';
import type { DataMaskConfigRow } from '../db/schema';
import type { DataMaskConfig, CustomMaskRule, MaskType, CreateDataMaskConfigInput, UpdateDataMaskConfigInput, SensitiveField } from '@zenith/shared';

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

export async function listDataMaskConfigs(query: { page?: number; pageSize?: number; keyword?: string; maskType?: MaskType; enabled?: string } = {}) {
  const { page = 1, pageSize = 20, keyword, maskType, enabled } = query;
  const conditions = [];
  if (keyword) {
    conditions.push(or(ilike(dataMaskConfigs.entity, `%${escapeLike(keyword)}%`), ilike(dataMaskConfigs.field, `%${escapeLike(keyword)}%`), ilike(dataMaskConfigs.label, `%${escapeLike(keyword)}%`))!);
  }
  if (maskType) conditions.push(eq(dataMaskConfigs.maskType, maskType));
  if (enabled !== undefined) conditions.push(eq(dataMaskConfigs.enabled, enabled === 'true'));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
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

// ─── 扫描敏感字段 ──────────────────────────────────────────────────────────────

const SENSITIVE_PATTERNS: Array<{ test: (col: string) => boolean; maskType: MaskType; label: string }> = [
  { test: (c) => /phone|mobile|cellphone|phoneno|phone_no/i.test(c),                                                 maskType: 'phone',     label: '手机号' },
  { test: (c) => /email|emailaddr/i.test(c),                                                                          maskType: 'email',     label: '邮箱' },
  { test: (c) => /id_card|idcard|idno|id_no|idnumber|id_number|certno|cert_no|identity|cert_num|certnum/i.test(c),   maskType: 'id_card',   label: '身份证号' },
  { test: (c) => /bank|bankcard|bank_card|bankno|bank_no|cardno|card_no/i.test(c),                                   maskType: 'bank_card', label: '银行卡号' },
  { test: (c) => /real_name|realname|full_name|fullname|truename|true_name|chinesename/i.test(c),                     maskType: 'name',      label: '姓名' },
];

export async function scanSensitiveFields(): Promise<SensitiveField[]> {
  const [columnRows, existingRules] = await Promise.all([
    db.execute(sql`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          column_name ILIKE '%phone%'       OR column_name ILIKE '%mobile%'      OR
          column_name ILIKE '%cellphone%'   OR column_name ILIKE '%phoneno%'     OR
          column_name ILIKE '%phone_no%'    OR
          column_name ILIKE '%email%'       OR
          column_name ILIKE '%id_card%'     OR column_name ILIKE '%idcard%'      OR
          column_name ILIKE '%idno%'        OR column_name ILIKE '%id_no%'       OR
          column_name ILIKE '%idnumber%'    OR column_name ILIKE '%id_number%'   OR
          column_name ILIKE '%certno%'      OR column_name ILIKE '%cert_no%'     OR
          column_name ILIKE '%certnum%'     OR column_name ILIKE '%identity%'    OR
          column_name ILIKE '%bank%'        OR column_name ILIKE '%bankcard%'    OR
          column_name ILIKE '%bank_card%'   OR column_name ILIKE '%bankno%'      OR
          column_name ILIKE '%bank_no%'     OR column_name ILIKE '%cardno%'      OR
          column_name ILIKE '%card_no%'     OR
          column_name ILIKE '%real_name%'   OR column_name ILIKE '%realname%'    OR
          column_name ILIKE '%full_name%'   OR column_name ILIKE '%fullname%'    OR
          column_name ILIKE '%truename%'    OR column_name ILIKE '%true_name%'   OR
          column_name ILIKE '%chinesename%'
        )
      ORDER BY table_name, column_name
    `),
    db.select({ entity: dataMaskConfigs.entity, field: dataMaskConfigs.field }).from(dataMaskConfigs),
  ]);

  const existingSet = new Set(existingRules.map((r) => `${r.entity}:${r.field}`));

  return (columnRows as unknown as Array<{ table_name: string; column_name: string; data_type: string }>)
    .map((row) => {
      const pattern = SENSITIVE_PATTERNS.find((p) => p.test(row.column_name));
      return {
        tableName:         row.table_name,
        columnName:        row.column_name,
        dataType:          row.data_type,
        suggestedMaskType: pattern?.maskType ?? 'custom',
        suggestedLabel:    pattern?.label ?? row.column_name,
        hasRule:           existingSet.has(`${row.table_name}:${row.column_name}`),
      };
    });
}

// ─── 批量创建 ──────────────────────────────────────────────────────────────────

export async function batchCreateDataMaskConfigs(
  items: Array<{ entity: string; field: string; label: string; maskType: string; exemptRoleCodes?: string[]; enabled?: boolean }>,
): Promise<{ created: number; skipped: number }> {
  if (items.length === 0) return { created: 0, skipped: 0 };

  const existing = await db
    .select({ entity: dataMaskConfigs.entity, field: dataMaskConfigs.field })
    .from(dataMaskConfigs);
  const existingSet = new Set(existing.map((r) => `${r.entity}:${r.field}`));

  const toInsert = items.filter((item) => !existingSet.has(`${item.entity}:${item.field}`));
  const skipped = items.length - toInsert.length;

  if (toInsert.length > 0) {
    await db.insert(dataMaskConfigs).values(
      toInsert.map((item) => ({
        entity:          item.entity,
        field:           item.field,
        label:           item.label,
        maskType:        item.maskType as MaskType,
        customRule:      null,
        exemptRoleCodes: item.exemptRoleCodes ?? [],
        enabled:         item.enabled ?? true,
        remark:          null,
      })),
    );
    invalidateMaskCache();
  }

  return { created: toInsert.length, skipped };
}
