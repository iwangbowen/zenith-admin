import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import { SEED_MENUS } from '@zenith/shared/seed/menus';
import type { PermissionCatalog } from '@zenith/shared/identity';

let cached: PermissionCatalog | null = null;

/** 权限目录：代码注册表是能力真相，菜单树只提供页面/按钮绑定。 */
export function getPermissionCatalog(): PermissionCatalog {
  if (cached) return cached;
  const pages = SEED_MENUS.filter(menu => menu.type === 'menu');
  const pageById = new Map(pages.map(page => [page.id, page]));
  const pageByName = new Map(pages.flatMap(page => page.name ? [[page.name, page] as const] : []));
  const buttons = SEED_MENUS.filter(menu => menu.type === 'button');
  cached = {
    items: Object.entries(ALL_PERMISSIONS).map(([code, meta]) => {
      const page = pages.find(item => item.permission === code);
      if (page) {
        return { code, label: meta.label, surface: 'page' as const, pageId: page.id, pageTitle: page.title, path: page.path ?? null, uiOnly: meta.uiOnly ?? false };
      }
      const button = buttons.find(item => item.permission === code);
      if (button) {
        const parent = pageById.get(button.parentId);
        return { code, label: meta.label, surface: 'button' as const, pageId: parent?.id ?? null, pageTitle: parent?.title ?? null, path: parent?.path ?? null, uiOnly: meta.uiOnly ?? false };
      }
      const menuNames = typeof meta.menu === 'string' ? [meta.menu] : meta.menu ?? [];
      const fallback = menuNames.map(name => pageByName.get(name)).find(Boolean);
      return { code, label: meta.label, surface: 'api' as const, pageId: fallback?.id ?? null, pageTitle: fallback?.title ?? null, path: fallback?.path ?? null, uiOnly: meta.uiOnly ?? false };
    }),
  };
  return cached;
}
