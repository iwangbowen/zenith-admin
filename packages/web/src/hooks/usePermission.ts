import { createContext, useContext } from 'react';

export const PermissionContext = createContext<string[]>([]);

export function usePermission() {
  const permissions = useContext(PermissionContext);

  const hasPermission = (code: string) => {
    if (permissions.includes('*')) return true;
    return permissions.includes(code);
  };

  const hasAnyPermission = (...codes: string[]) => {
    if (permissions.includes('*')) return true;
    return codes.some((code) => permissions.includes(code));
  };

  return { permissions, hasPermission, hasAnyPermission };
}
