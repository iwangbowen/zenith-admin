import { createContext, useCallback, useContext, useMemo } from 'react';

export const PermissionContext = createContext<string[]>([]);

export function usePermission() {
  const permissions = useContext(PermissionContext);

  // useCallback 保持引用稳定，便于页面将 hasPermission 作为 useMemo/useCallback 依赖
  const hasPermission = useCallback((code: string) => {
    if (permissions.includes('*')) return true;
    return permissions.includes(code);
  }, [permissions]);

  const hasAnyPermission = useCallback((...codes: string[]) => {
    if (permissions.includes('*')) return true;
    return codes.some((code) => permissions.includes(code));
  }, [permissions]);

  return useMemo(
    () => ({ permissions, hasPermission, hasAnyPermission }),
    [permissions, hasPermission, hasAnyPermission],
  );
}
