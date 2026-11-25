import type { LicenseFeatureKey } from './licensing';
import { ALL_PERMISSIONS } from './permissions';
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

const featureKeysByPermission = new Map<string, ReadonlySet<LicenseFeatureKey | null>>();

for (const [code, meta] of Object.entries(ALL_PERMISSIONS)) {
  const menuNames = typeof meta.menu === 'string' ? [meta.menu] : meta.menu ?? [];
  const featureKeys = new Set<LicenseFeatureKey | null>();
  for (const menuName of menuNames) {
    const menu = pagesByName.get(menuName);
    if (menu) featureKeys.add((menu.featureKey ?? null) as LicenseFeatureKey | null);
  }
  featureKeysByPermission.set(code, featureKeys);
}

/**
 * 返回权限码绑定页面对应的功能集合。
 * 没有页面绑定的纯 API 权限返回空集合，表示核心能力，不受套餐功能限制。
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
  return SEED_MENUS.some((menu) => menu.type === 'menu' && menu.permission === code);
}
