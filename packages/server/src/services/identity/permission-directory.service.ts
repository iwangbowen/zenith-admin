import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import { isPageReadPermission, permissionPageBindings } from '@zenith/shared/permission-features';
import type { PermissionCatalog } from '@zenith/shared/identity';

let cached: PermissionCatalog | null = null;

/** 权限目录：代码注册表是能力真相，页面树只提供页面绑定。 */
export function getPermissionCatalog(): PermissionCatalog {
  if (cached) return cached;
  cached = {
    items: Object.entries(ALL_PERMISSIONS).map(([code, meta]) => {
      const pageBindings = permissionPageBindings(code);
      const primaryPage = pageBindings[0];
      return {
        code,
        label: meta.label,
        surface: isPageReadPermission(code) ? 'page' as const : pageBindings.length > 0 ? 'operation' as const : 'api' as const,
        pageId: primaryPage?.id ?? null,
        pageTitle: primaryPage?.title ?? null,
        path: primaryPage?.path ?? null,
        pageBindings: [...pageBindings],
        uiOnly: meta.uiOnly ?? false,
      };
    }),
  };
  return cached;
}
