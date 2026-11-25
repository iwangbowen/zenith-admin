import { useCallback, useMemo, useState } from 'react';
import { normalizeScopeValue, sameScopeValue, type PermissionScopeValue } from './scope-types';

/**
 * 授权草稿状态：打开抽屉时复制，应用时提交；取消不会污染宿主表单。
 */
export function usePermissionScopeDraft(initialValue: PermissionScopeValue) {
  const [value, setValue] = useState(() => normalizeScopeValue(initialValue));
  const initial = useMemo(() => normalizeScopeValue(initialValue), [initialValue]);

  const setPageIds = useCallback((pageIds: number[]) => {
    setValue(prev => normalizeScopeValue({ ...prev, pageIds }));
  }, []);

  const setPermissionCodes = useCallback((permissionCodes: string[]) => {
    setValue(prev => normalizeScopeValue({ ...prev, permissionCodes }));
  }, []);

  const reset = useCallback((next: PermissionScopeValue = initial) => {
    setValue(normalizeScopeValue(next));
  }, [initial]);

  return {
    value,
    setValue,
    setPageIds,
    setPermissionCodes,
    reset,
    dirty: !sameScopeValue(value, initial),
  };
}
