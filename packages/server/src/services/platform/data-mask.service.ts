import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { DataMaskEffective, DataMaskField, SaveDataMaskPolicyInput } from '@zenith/shared/platform';
import { dataMaskContract, DATA_MASK_REVEAL_PERMISSION, matchesDataMaskFieldQuery } from '@zenith/shared/platform';
import type { MaskDecision } from '@zenith/shared/core';
import { db } from '../../db';
import { dataMaskPolicies } from '../../db/schema';
import { hasPermission } from '../../lib/context';
import { getPolicyMap, invalidatePolicyCache, resolveEffectivePolicy, resolveEnabledRules, resolveMaskDecisions, type EffectiveMaskPolicy } from '../../lib/data-mask/policies';
import { findSensitiveFieldEntry, listSensitiveFieldEntries, type SensitiveFieldEntry } from '../../lib/data-mask/registry';
import { loadRevealValue } from '../../lib/data-mask/reveal';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';

/**
 * 数据脱敏策略中心。
 *
 * 敏感字段来自契约注册表（`lib/data-mask/registry`），策略表只保存覆盖记录；
 * 打码本身发生在契约路由出口（`lib/data-mask/boundary`），本模块负责策略的读写、
 * 当前用户视角的生效视图与按需查看明文。
 */

// ─── 映射 ─────────────────────────────────────────────────────────────────────

function mapField(effective: EffectiveMaskPolicy): DataMaskField {
  return {
    key: effective.key,
    entity: effective.entity,
    field: effective.field,
    label: effective.label,
    kind: effective.kind,
    maskType: effective.maskType,
    customRule: effective.customRule,
    exemptPermissions: [...effective.exemptPermissions],
    enabled: effective.enabled,
    remark: effective.remark,
    overridden: effective.overridden,
    policyId: effective.policyId,
    preview: effective.preview,
    updatedAt: effective.updatedAt ? formatDateTime(effective.updatedAt) : null,
  };
}

function requireEntry(entity: string, field: string): SensitiveFieldEntry {
  const entry = findSensitiveFieldEntry(entity, field);
  if (!entry) throw new HTTPException(404, { message: `契约中不存在敏感字段 ${entity}.${field}` });
  return entry;
}

async function fieldView(entry: SensitiveFieldEntry): Promise<DataMaskField> {
  const map = await getPolicyMap();
  return mapField(resolveEffectivePolicy(entry, map.get(entry.key)));
}

// ─── 查询 ─────────────────────────────────────────────────────────────────────

export async function listDataMaskFields(query: QueryOutputOf<typeof dataMaskContract.fields>): Promise<DataMaskField[]> {
  const map = await getPolicyMap();
  return listSensitiveFieldEntries()
    .map((entry) => mapField(resolveEffectivePolicy(entry, map.get(entry.key))))
    .filter((item) => matchesDataMaskFieldQuery(item, query));
}

/** 当前登录用户视角：会被打码的字段键 + 是否可按需查看明文 */
export async function getEffectiveMaskForViewer(): Promise<DataMaskEffective> {
  const entries = listSensitiveFieldEntries();
  const [decisions, canReveal] = await Promise.all([
    resolveMaskDecisions(entries.map((entry) => ({ path: [entry.field], entity: entry.entity, field: entry.field, kind: entry.kind, label: entry.label }))),
    hasPermission(DATA_MASK_REVEAL_PERMISSION),
  ]);
  return { masked: decisions.map(({ ref }) => `${ref.entity}.${ref.field}`), canReveal };
}

// ─── 策略写入 ─────────────────────────────────────────────────────────────────

export async function saveDataMaskPolicy(entity: string, field: string, input: SaveDataMaskPolicyInput): Promise<DataMaskField> {
  const entry = requireEntry(entity, field);
  const maskType = input.maskType ?? entry.kind;
  const values = {
    maskType,
    customRule: maskType === 'custom' ? (input.customRule ?? null) : null,
    exemptPermissions: Array.from(new Set(input.exemptPermissions)),
    enabled: input.enabled,
    remark: input.remark?.trim() || null,
  };
  try {
    await db.insert(dataMaskPolicies)
      .values({ entity, field, ...values })
      .onConflictDoUpdate({ target: [dataMaskPolicies.entity, dataMaskPolicies.field], set: values });
  } catch (err) {
    rethrowPgUniqueViolation(err, `字段 ${entity}.${field} 的策略已存在`);
    throw err;
  }
  invalidatePolicyCache();
  return fieldView(entry);
}

/** 删除覆盖记录，字段回到契约默认策略 */
export async function resetDataMaskPolicy(entity: string, field: string): Promise<DataMaskField> {
  const entry = requireEntry(entity, field);
  await db.delete(dataMaskPolicies).where(and(eq(dataMaskPolicies.entity, entity), eq(dataMaskPolicies.field, field)));
  invalidatePolicyCache();
  return fieldView(entry);
}

// ─── 按需查看明文 ─────────────────────────────────────────────────────────────

export async function revealSensitiveValue(entity: string, id: number, field: string): Promise<{ value: string | null }> {
  requireEntry(entity, field);
  return { value: await loadRevealValue(entity, id, field) };
}

// ─── 导出中心 ─────────────────────────────────────────────────────────────────

/**
 * 供导出中心使用：全部启用字段的 `entity.field` → 脱敏规则。
 * 不考虑查看者豁免——脱敏导出所见即所得（文件可能外发，统一打码）。
 */
export async function getExportMaskRuleMap(): Promise<Map<string, MaskDecision>> {
  return resolveEnabledRules(listSensitiveFieldEntries());
}