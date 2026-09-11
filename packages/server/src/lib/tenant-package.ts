import { eq } from 'drizzle-orm';
import { db } from '../db';
import { tenants, tenantPackages, tenantPackageFeatures } from '../db/schema';
import { config } from '../config';
import { TtlCache } from './ttl-cache';
import { onInvalidate, onInvalidationReset } from './invalidation-bus';

/**
 * 套餐功能集的进程内副本（tenantId → 功能集 / null）。
 *
 * 权限树加载、`getMySettings` 对每个带 feature 门控的设置模块、菜单 / 角色 / 用户的套餐校验都要读它，
 * 一次壳层加载在多租户模式下曾触发十余次「租户 → 套餐 → 功能」三段查询。
 * - 失效以 `tenants`（改绑套餐）/ `tenant_packages` / `tenant_package_features` 表触发器经 `cache_invalidate`
 *   总线广播为准（迁移 `0005` / `0013`），TTL 只是 NOTIFY 不可用时的兜底；
 * - 关闭 stale-while-revalidate：套餐禁用 / 降级是 fail-closed 语义，过期即同步回源；
 * - 副本按 tenantId 键、没有套餐 → 租户的反向索引，套餐侧广播整段清空（套餐改动极少）。
 */
const FEATURE_SET_CACHE_TTL_MS = 60_000;

const featureSets = new TtlCache<number, ReadonlySet<string> | null>(FEATURE_SET_CACHE_TTL_MS, { staleWhileRevalidate: false });

/** 清空全部套餐功能集副本（监听重建 / 测试） */
export function resetTenantPackageFeatureCache(): void {
  featureSets.clear();
}

onInvalidate('tenants', (message) => {
  const tenantId = Number(message.key);
  if (Number.isInteger(tenantId) && tenantId > 0) featureSets.delete(tenantId);
  else featureSets.clear();
});
onInvalidate('tenant_packages', resetTenantPackageFeatureCache);
onInvalidate('tenant_package_features', resetTenantPackageFeatureCache);
onInvalidationReset(resetTenantPackageFeatureCache);

/** 租户 → 套餐 → 功能一次 JOIN 取回；行为空 = 租户不存在，套餐列为空 = 未绑定 / 套餐已不存在 */
async function loadFeatureSet(tenantId: number): Promise<ReadonlySet<string> | null> {
  const rows = await db
    .select({
      packageId: tenants.packageId,
      packageStatus: tenantPackages.status,
      featureKey: tenantPackageFeatures.featureKey,
    })
    .from(tenants)
    .leftJoin(tenantPackages, eq(tenantPackages.id, tenants.packageId))
    .leftJoin(tenantPackageFeatures, eq(tenantPackageFeatures.packageId, tenantPackages.id))
    .where(eq(tenants.id, tenantId));
  const head = rows[0];
  if (!head || head.packageId == null || head.packageStatus == null) return null;
  if (head.packageStatus === 'disabled') return new Set();
  return new Set(rows.flatMap((r) => (r.featureKey == null ? [] : [r.featureKey])));
}

/**
 * 返回指定租户「套餐功能集」。
 *
 * 返回 `null` 表示**不限制**（调用方应放行全部功能），命中以下任一条件即视为不限制：
 *  - 多租户模式关闭（`MULTI_TENANT_MODE=false`，默认）
 *  - `tenantId` 为空（平台级 / 平台超管未切换租户视角）
 *  - 该租户未绑定套餐（`packageId` 为空）
 *
 * 仅当多租户开启、且租户绑定了套餐时，才返回该套餐分配的功能 key 集合：
 *  - 套餐被**禁用**时返回空集（fail-closed：全部可授权功能关闭，核心能力不受影响——
 *    核心菜单 featureKey 为 null，不参与交集）
 *
 * 结果经进程内副本读取（见上），返回的集合在调用方之间共享，只读。
 */
export async function getTenantPackageFeatureSet(tenantId: number | null | undefined): Promise<ReadonlySet<string> | null> {
  if (!config.multiTenantMode) return null;
  if (tenantId == null) return null;
  return featureSets.get(tenantId, () => loadFeatureSet(tenantId));
}
