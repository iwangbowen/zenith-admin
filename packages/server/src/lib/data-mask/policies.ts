import {
  previewMask,
  sensitiveKeyOf,
  type CustomMaskRule,
  type MaskDecision,
  type MaskType,
  type SensitiveFieldRef,
} from '@zenith/shared/core';
import { db } from '../../db';
import { dataMaskPolicies, type DataMaskPolicyRow } from '../../db/schema';
import { currentUserOrNull, hasPermission, currentCmsOpenApiAccess } from '../context';
import { onInvalidate, onInvalidationReset } from '../invalidation-bus';
import { isSuperAdmin } from '../permissions';

/**
 * 脱敏策略缓存与生效解析。
 *
 * - 策略表只存「与契约默认不同」的覆盖记录；进程内整表缓存，`data_mask_policies` 的
 *   LISTEN/NOTIFY 触发器让所有实例即时失效，TTL 只做监听降级时的兜底
 * - 生效策略 = 契约声明（默认类型 / 启用 / 无豁免）⊕ 覆盖记录
 * - 查看者决策：平台超管一律明文；策略停用不打码；拥有任一豁免权限不打码；其余打码
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { map: Map<string, DataMaskPolicyRow>; expiresAt: number } | null = null;
let inflight: Promise<Map<string, DataMaskPolicyRow>> | null = null;

async function loadPolicyMap(): Promise<Map<string, DataMaskPolicyRow>> {
  const rows = await db.select().from(dataMaskPolicies);
  const map = new Map(rows.map((row) => [`${row.entity}.${row.field}`, row]));
  cache = { map, expiresAt: Date.now() + CACHE_TTL_MS };
  return map;
}

/** 全部策略覆盖记录，键 `entity.field` */
export async function getPolicyMap(): Promise<Map<string, DataMaskPolicyRow>> {
  if (cache && Date.now() < cache.expiresAt) return cache.map;
  if (!inflight) {
    inflight = loadPolicyMap().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function invalidatePolicyCache(): void {
  cache = null;
}

onInvalidate('data_mask_policies', invalidatePolicyCache);
onInvalidationReset(invalidatePolicyCache);

// ─── 生效策略 ─────────────────────────────────────────────────────────────────

export interface EffectiveMaskPolicy {
  readonly key: string;
  readonly entity: string;
  readonly field: string;
  readonly label: string;
  /** 契约声明的默认类型 */
  readonly kind: MaskType;
  readonly maskType: MaskType;
  readonly customRule: CustomMaskRule | null;
  readonly exemptPermissions: readonly string[];
  readonly enabled: boolean;
  readonly overridden: boolean;
  readonly policyId: number | null;
  readonly remark: string | null;
  readonly updatedAt: Date | null;
  readonly preview: string;
}

/** 契约声明 ⊕ 覆盖记录 → 生效策略 */
export function resolveEffectivePolicy(
  ref: Pick<SensitiveFieldRef, 'entity' | 'field' | 'kind' | 'label'>,
  row: DataMaskPolicyRow | undefined,
): EffectiveMaskPolicy {
  const maskType = row?.maskType ?? ref.kind;
  const customRule = maskType === 'custom' ? (row?.customRule ?? null) : null;
  return {
    key: sensitiveKeyOf(ref),
    entity: ref.entity,
    field: ref.field,
    label: ref.label,
    kind: ref.kind,
    maskType,
    customRule,
    exemptPermissions: row?.exemptPermissions ?? [],
    enabled: row?.enabled ?? true,
    overridden: row !== undefined,
    policyId: row?.id ?? null,
    remark: row?.remark ?? null,
    updatedAt: row?.updatedAt ?? null,
    preview: previewMask(maskType, customRule),
  };
}

// ─── 查看者决策 ───────────────────────────────────────────────────────────────

/** 当前请求主体是否天然免脱敏（平台超管）；无登录用户（匿名 / 会员端 / 开放 API）不免 */
function viewerBypassesAll(): boolean {
  if (currentCmsOpenApiAccess()) return false;
  const user = currentUserOrNull();
  return user !== undefined && isSuperAdmin(user);
}

async function viewerHasAny(permissions: readonly string[]): Promise<boolean> {
  if (permissions.length === 0) return false;
  if (!currentUserOrNull() && !currentCmsOpenApiAccess()) return false;
  return hasPermission(...permissions);
}

export interface FieldMaskDecision {
  readonly ref: SensitiveFieldRef;
  readonly decision: MaskDecision;
}

/**
 * 为当前查看者计算一组敏感字段的打码决策；返回的字段都需要打码，其余（停用 / 豁免 / 超管）已过滤。
 * 同一权限集合在一次调用内只判定一次。
 */
export async function resolveMaskDecisions(refs: readonly SensitiveFieldRef[]): Promise<FieldMaskDecision[]> {
  if (refs.length === 0 || viewerBypassesAll()) return [];
  const map = await getPolicyMap();
  const exemptionCache = new Map<string, Promise<boolean>>();
  const decisions: FieldMaskDecision[] = [];
  for (const ref of refs) {
    const effective = resolveEffectivePolicy(ref, map.get(sensitiveKeyOf(ref)));
    if (!effective.enabled) continue;
    if (effective.exemptPermissions.length > 0) {
      const cacheKey = [...effective.exemptPermissions].sort().join('|');
      let exempt = exemptionCache.get(cacheKey);
      if (!exempt) {
        exempt = viewerHasAny(effective.exemptPermissions);
        exemptionCache.set(cacheKey, exempt);
      }
      if (await exempt) continue;
    }
    decisions.push({ ref, decision: { maskType: effective.maskType, customRule: effective.customRule } });
  }
  return decisions;
}

/** 供导出等无请求上下文的场景：全部启用字段的生效规则（不考虑查看者豁免） */
export async function resolveEnabledRules(
  refs: readonly Pick<SensitiveFieldRef, 'entity' | 'field' | 'kind' | 'label'>[],
): Promise<Map<string, MaskDecision>> {
  const map = await getPolicyMap();
  const out = new Map<string, MaskDecision>();
  for (const ref of refs) {
    const effective = resolveEffectivePolicy(ref, map.get(sensitiveKeyOf(ref)));
    if (effective.enabled) out.set(effective.key, { maskType: effective.maskType, customRule: effective.customRule });
  }
  return out;
}

/** 仅供测试重置缓存 */
export function resetPolicyCacheForTest(): void {
  cache = null;
  inflight = null;
}
