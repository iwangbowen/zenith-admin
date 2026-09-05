import { useCallback, useEffect } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  maintenanceKeys,
  usePublicMaintenanceStatus,
  useUpdateMaintenanceStatus,
} from '@/hooks/queries/maintenance';

// ─── 维护模式横幅（超管提示） ─────────────────────────────────────────
export function useMaintenanceBanner(isSuperAdmin: boolean) {
  const queryClient = useQueryClient();
  const { data: status } = usePublicMaintenanceStatus({ enabled: isSuperAdmin });
  const updateMutation = useUpdateMaintenanceStatus();

  // http-client 在 React 树之外拦截 503，只能靠事件通知；这里把事件降级为纯失效触发器，
  // 状态本身仍由查询缓存唯一持有（此前是各自 setState，导致多处状态可能不一致）。
  useEffect(() => {
    if (!isSuperAdmin) return;
    const handler = () => void queryClient.invalidateQueries({ queryKey: maintenanceKeys.publicStatus });
    globalThis.addEventListener('maintenance:enabled', handler);
    return () => globalThis.removeEventListener('maintenance:enabled', handler);
  }, [isSuperAdmin, queryClient]);

  const handleDisableMaintenance = useCallback(async () => {
    await updateMutation.mutateAsync({ body: { enabled: false } });
    Toast.success('维护模式已关闭');
  }, [updateMutation]);

  return {
    maintenanceBannerEnabled: (status?.enabled ?? false) && isSuperAdmin,
    maintenanceBannerMsg: status?.message ?? '系统维护中',
    disablingMaintenance: updateMutation.isPending,
    handleDisableMaintenance,
  };
}
