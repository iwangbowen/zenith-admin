import type { AccessScopeOptions, Menu, PermissionCatalog } from '@zenith/shared/identity';
import { flattenTree } from '@zenith/shared/core';
import type { PermissionScopeData, PermissionScopeItem } from './scope-types';

export function createAdminScopeData(
  pages: Menu[],
  catalog: PermissionCatalog,
  options?: AccessScopeOptions,
): PermissionScopeData {
  const pageIndex = new Map(flattenTree(pages).filter(page => page.type === 'menu').map(page => [page.id, page]));
  const policyByCode = new Map(options?.permissions.map(item => [item.code, item]));
  const permissions = catalog.items.flatMap(item => {
    const option = policyByCode.get(item.code);
    const value = {
      code: item.code, label: item.label, uiOnly: item.uiOnly,
      requestable: option?.selectable ?? true,
      riskLevel: option?.policy?.riskLevel,
      approvalPolicy: option?.policy?.approvalPolicy,
    };
    const bindings = item.pageBindings.flatMap(binding => {
      const page = pageIndex.get(binding.id);
      return page ? [page] : [];
    });
    const boundItems: PermissionScopeItem[] = bindings.map(page => ({
      ...value, pageId: page.id, pageTitle: page.title, path: page.path ? [page.path] : [],
      surface: page.permission === item.code ? 'page' : 'operation',
    }));
    return boundItems.length ? boundItems
      : [{ ...value, pageId: null, pageTitle: null, path: item.pageBindings.map(page => page.title), surface: 'api' as const }];
  });
  return { pages, permissions, selectablePageIds: options?.selectablePageIds };
}

export function createAccessScopeData(options: AccessScopeOptions | undefined): PermissionScopeData {
  return createAdminScopeData(options?.pages ?? [], { items: options?.permissions ?? [] }, options);
}
