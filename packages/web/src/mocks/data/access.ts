import type { AccessGrant, DataScope } from '@zenith/shared/identity';

export const mockAccessGrants = new Map<number, AccessGrant>();
export const mockUserPageIds: Record<number, number[]> = {};
export const mockUserPermissionCodes: Record<number, string[]> = {};
export const mockUserDataScopes: Record<number, DataScope | null> = {};
export const mockUserDeptScopes: Record<number, number[]> = {};
