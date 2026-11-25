import type { Menu } from '@zenith/shared/identity';

/** 页面访问 + 操作权限的统一选中值。 */
export type PermissionScopeValue = {
  pageIds: number[];
  permissionCodes: string[];
};

export type PermissionScopeSurface = 'page' | 'operation' | 'api';

/** 不同授权入口归一化后的权限项。 */
export type PermissionScopeItem = {
  code: string;
  label: string;
  pageId: number | null;
  pageTitle: string | null;
  path: string[];
  surface: PermissionScopeSurface;
  requestable: boolean;
  covered?: boolean;
  riskLevel?: 'low' | 'high' | 'critical';
  approvalPolicy?: string;
  uiOnly?: boolean;
};

export type PermissionScopeData = {
  pages: Menu[];
  permissions: PermissionScopeItem[];
};

export function normalizeScopeValue(value: PermissionScopeValue): PermissionScopeValue {
  return {
    pageIds: [...new Set(value.pageIds)].sort((a, b) => a - b),
    permissionCodes: [...new Set(value.permissionCodes)].sort(),
  };
}

export function sameScopeValue(a: PermissionScopeValue, b: PermissionScopeValue): boolean {
  const left = normalizeScopeValue(a);
  const right = normalizeScopeValue(b);
  return left.pageIds.length === right.pageIds.length
    && left.permissionCodes.length === right.permissionCodes.length
    && left.pageIds.every((id, index) => id === right.pageIds[index])
    && left.permissionCodes.every((code, index) => code === right.permissionCodes[index]);
}
