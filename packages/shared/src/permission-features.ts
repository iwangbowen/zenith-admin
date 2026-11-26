import type { LicenseFeatureKey } from './licensing';
import { ALL_PERMISSIONS, PERMISSION_REGISTRY_BY_DOMAIN, type PermissionDomain } from './permissions';
import { PAGE_READ_PERMISSION_CODES } from './seed/menus/page-permissions';
import type { Menu, PermissionCatalog } from './identity/contracts';

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

/** 权限码是否属于页面读权限。 */
export function isPageReadPermission(code: string): boolean {
  return PAGE_READ_PERMISSION_CODES.has(code);
}

/** Resolve page labels and bindings against the supplied navigation configuration. */
export function buildPermissionDirectory(menus: readonly Menu[]): PermissionCatalog {
  const pages = menus.filter(menu => menu.type === 'menu');
  const byName = new Map(pages.flatMap(page => page.name ? [[page.name, page] as const] : []));
  const byReadCode = new Map<string, Menu[]>();
  for (const page of pages) {
    if (!page.permission) continue;
    const bindings = byReadCode.get(page.permission) ?? [];
    bindings.push(page);
    byReadCode.set(page.permission, bindings);
  }
  return {
    items: Object.entries(ALL_PERMISSIONS).map(([code, meta]) => {
      const names = typeof meta.menu === 'string' ? [meta.menu] : meta.menu ?? [];
      const reads = byReadCode.get(code) ?? [];
      const related = [...reads, ...names.flatMap(name => byName.get(name) ?? [])];
      const pageBindings = [...new Map(related.map(page => [
        page.id, { id: page.id, title: page.title, path: page.path ?? null },
      ])).values()];
      const primary = pageBindings[0];
      return {
        code, label: meta.label, uiOnly: meta.uiOnly ?? false,
        surface: reads.length ? 'page' : pageBindings.length ? 'operation' : 'api',
        pageId: primary?.id ?? null, pageTitle: primary?.title ?? null, path: primary?.path ?? null,
        pageBindings,
      };
    }),
  };
}
