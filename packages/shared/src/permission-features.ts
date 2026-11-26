import type { LicenseFeatureKey } from './licensing';
import { ALL_PERMISSIONS, PERMISSION_REGISTRY_BY_DOMAIN, type PermissionDomain } from './permissions';
import { PAGE_READ_PERMISSION_CODES } from './seed/menus/page-permissions';
import { SEED_MENUS } from './seed/menus';

const pagesByName = new Map(
  SEED_MENUS
    .filter((menu) => menu.type === 'menu' && menu.name)
    .map((menu) => [menu.name!, menu] as const),
);

export interface PermissionPageBinding {
  id: number;
  title: string;
  path: string | null;
}

const pageBindingsByPermission = new Map<string, readonly PermissionPageBinding[]>();

for (const [code, meta] of Object.entries(ALL_PERMISSIONS)) {
  const pageReadBindings = SEED_MENUS
    .filter((menu) => menu.type === 'menu' && menu.permission === code)
    .map((menu) => ({ id: menu.id, title: menu.title, path: menu.path ?? null }));
  const menuNames = typeof meta.menu === 'string' ? [meta.menu] : meta.menu ?? [];
  const operationBindings = menuNames.flatMap((menuName) => {
    const menu = pagesByName.get(menuName);
    return menu ? [{ id: menu.id, title: menu.title, path: menu.path ?? null }] : [];
  });
  const bindings = [...pageReadBindings, ...operationBindings];
  pageBindingsByPermission.set(code, [...new Map(bindings.map((binding) => [binding.id, binding])).values()]);
}

const domainFeature: Record<PermissionDomain, LicenseFeatureKey | null> = {
  identity: null, platform: null, messaging: null, tasks: null, biz: null,
  ops: 'ops', workflow: 'workflow', chat: 'chat', rules: 'rules', analytics: 'analytics',
  report: 'report', payment: 'payment', member: 'member', mp: 'mp', cms: 'cms', wiki: 'wiki',
  drive: 'drive', 'open-platform': 'open-platform', ai: 'ai', iot: 'iot', marketing: 'growth', 'short-link': 'growth',
};

const featureKeysByPermission = new Map<string, ReadonlySet<LicenseFeatureKey | null>>();
const coreOpsPrefixes = ['system:log:', 'system:db-admin:', 'system:maintenance:', 'system:retention:'];
for (const [domain, registry] of Object.entries(PERMISSION_REGISTRY_BY_DOMAIN)) {
  for (const code of Object.keys(registry)) {
    const feature = domain === 'platform' && code.startsWith('monitor:') ? 'analytics'
      : domain === 'ops' && coreOpsPrefixes.some(prefix => code.startsWith(prefix)) ? null
      : domainFeature[domain as PermissionDomain];
    featureKeysByPermission.set(code, new Set([feature]));
  }
}

/**
 * 功能归属由能力注册表所在域和显式例外决定。
 * 接口能力即使没有页面入口，也沿用其所属功能的套餐边界。
 */
export function permissionFeatureKeys(code: string): ReadonlySet<LicenseFeatureKey | null> {
  return featureKeysByPermission.get(code) ?? new Set();
}

/** 返回权限码绑定的全部页面，页面读权限和操作权限共用此映射。 */
export function permissionPageBindings(code: string): readonly PermissionPageBinding[] {
  return pageBindingsByPermission.get(code) ?? [];
}

/** 权限码是否属于页面读权限。 */
export function isPageReadPermission(code: string): boolean {
  return PAGE_READ_PERMISSION_CODES.has(code);
}
