import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import { SEED_MENUS } from '@zenith/shared/seed/menus';
import type { PermissionCatalog } from '@zenith/shared/identity';

let cached: PermissionCatalog | null = null;

/** 权限目录：代码注册表是能力真相，页面树只提供页面绑定。 */
export function getPermissionCatalog(): PermissionCatalog {
  if (cached) return cached;
  const pages = SEED_MENUS.filter(menu => menu.type === 'menu');
  const pageByName = new Map(pages.flatMap(page => page.name ? [[page.name, page] as const] : []));
  cached = {
    items: Object.entries(ALL_PERMISSIONS).map(([code, meta]) => {
      const page = pages.find(item => item.permission === code);
      if (page) {
        return { code, label: meta.label, surface: 'page' as const, pageId: page.id, pageTitle: page.title, path: page.path ?? null, uiOnly: meta.uiOnly ?? false };
      }
      const menuNames = typeof meta.menu === 'string' ? [meta.menu] : meta.menu ?? [];
      const boundPage = menuNames.map(name => pageByName.get(name)).find(Boolean);
      return {
        code,
        label: meta.label,
        surface: boundPage ? 'operation' as const : 'api' as const,
        pageId: boundPage?.id ?? null,
        pageTitle: boundPage?.title ?? null,
        path: boundPage?.path ?? null,
        uiOnly: meta.uiOnly ?? false,
      };
    }),
  };
  return cached;
}
