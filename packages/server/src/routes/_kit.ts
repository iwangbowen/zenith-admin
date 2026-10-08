/**
 * 路由域（Route Domain）契约。
 *
 * `src/index.ts` 曾把 234 条路由 import 与 236 个 `app.route()` 全部摊在一个文件里：
 * 任何域新增端点都要改这唯一的公共文件（合并冲突高发），挂载顺序只能靠人肉连读，
 * 且整个应用图在启动时被无条件全量加载。
 *
 * 现在每个业务域用 `defineRouteDomain` 在自己的 `routes/<domain>/index.ts` 里
 * 声明挂载清单，`routes/index.ts` 只负责声明域顺序。
 *
 * ─── 约束 ───────────────────────────────────────────────────────────────────
 * 1. `mounts` 返回的数组**顺序即挂载顺序**。同一路径被多次挂载时（如
 *    `/api/analytics` ×4、`/api/ai/conversations` ×3），顺序是语义的一部分，
 *    不得调整。
 * 2. 需要在所有 API 路由之后兜底的挂载（如 CMS 前台 SSR 按 Host 匹配的 `/`）
 *    必须放进 `fallback`，而不是 `mounts` 末尾——后者只能保证域内靠后，
 *    保证不了全局最后。用类型把这条隐式约束变成结构约束。
 * 3. 路由表由 `src/app.contract.test.ts` 快照锁定：增删接口、改动路径都会在 CI 暴露。
 *    但**挂载顺序不在锁定范围内**——快照按 method + path 排序去重，同一路径的多条
 *    挂载在表里无法区分。约束 1 只能靠人工保证，调整顺序时请自行核对匹配结果。
 */
import type { Hono } from 'hono';
import { isLicenseFeatureKey, type LicenseFeatureKey } from '@zenith/shared/licensing';

/**
 * 可挂载的子路由器。
 *
 * 各域子路由器的泛型槽互不相同（`OpenAPIHono` / 裸 `Hono` / 带 Variables 的变体），
 * 放进同一个数组需要存在类型（existential type），TypeScript 无此能力。
 * `app.route()` 本身是泛型方法，对实参的泛型不作约束，故此处在泛型槽放宽为 any——
 * 仅影响这一处类型标注，运行时与各路由文件内部的类型安全均不受影响。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MountableRouter = Hono<any, any, any>;

/** 一条挂载：[挂载路径, 子路由器, 可选挂载配置] */
export type Mount = readonly [path: string, router: MountableRouter, options?: MountOptions];

export type MountOptions =
  | { feature: LicenseFeatureKey; licenseExempt?: never }
  | { licenseExempt: string; feature?: never };

/** 每个域必须明确默认授权分类；公开入口的例外必须在挂载上注明原因。 */
export type RouteLicensePolicy =
  | { feature: LicenseFeatureKey; core?: never }
  | { core: string; feature?: never };

export interface RouteDomain {
  /** 域名，用于日志与按域裁剪装载 */
  name: string;
  /** 新挂载继承此分类，避免新增 API 忘记接入 License 门控。 */
  licensing: RouteLicensePolicy;
  /** 常规挂载，按数组顺序注册 */
  mounts: () => Mount[];
  /** 兜底挂载，在**全部**域的 mounts 与文档路由之后注册 */
  fallback?: () => Mount[];
}

export function defineRouteDomain(domain: RouteDomain): RouteDomain {
  const policy = domain.licensing;
  if (!policy || (policy.feature === undefined && !policy.core?.trim())) {
    throw new Error(`路由域「${domain.name}」必须声明 License 功能或核心能力原因`);
  }
  if (policy.feature !== undefined && (!isLicenseFeatureKey(policy.feature) || policy.core !== undefined)) {
    throw new Error(`路由域「${domain.name}」的 License 分类无效：${policy.feature}`);
  }

  const classify = (mounts: Mount[], fallback = false): Mount[] => mounts.map(([path, router, options]) => {
    if (options?.licenseExempt !== undefined) {
      if (!options.licenseExempt.trim() || options.feature !== undefined) {
        throw new Error(`路由挂载「${domain.name}:${path}」必须提供明确且独立的 License 豁免原因`);
      }
      return [path, router, options];
    }
    if (options?.feature !== undefined && !isLicenseFeatureKey(options.feature)) {
      throw new Error(`路由挂载「${domain.name}:${path}」的 License 功能未登记：${options.feature}`);
    }
    if (fallback && (options?.feature || policy.feature)) {
      throw new Error(`兜底挂载「${domain.name}:${path}」必须明确声明 License 豁免原因`);
    }
    const feature = options?.feature ?? policy.feature;
    return feature ? [path, router, { feature }] : [path, router];
  });

  return {
    ...domain,
    mounts: () => classify(domain.mounts()),
    ...(domain.fallback ? { fallback: () => classify(domain.fallback!(), true) } : {}),
  };
}
