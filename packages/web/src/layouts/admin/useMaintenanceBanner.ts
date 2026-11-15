import { useCallback, useEffect } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  maintenanceKeys,
  usePublicMaintenanceStatus,
  useUpdateMaintenanceStatus,
  useMaintenanceStatus,
} from '@/hooks/queries/maintenance';

// ─── 维护模式横幅（超管提示） ─────────────────────────────────────────
export function useMaintenanceBanner(isSuperAdmin: boolean) {
  const queryClient = useQueryClient();
  const { data: status } = usePublicMaintenanceStatus({ enabled: isSuperAdmin });
  const updateMutation = useUpdateMaintenanceStatus();
  const detail = useMaintenanceStatus(isSuperAdmin);

  // http-client 在 React 树之外拦截 503，只能靠事件通知；这里把事件降级为纯失效触发器，
  // 状态本身仍由查询缓存唯一持有（不各自 setState，避免多处状态不一致）。
  useEffect(() => {
    if (!isSuperAdmin) return;
    const handler = () => void queryClient.invalidateQueries({ queryKey: maintenanceKeys.publicStatus });
    globalThis.addEventListener('maintenance:enabled', handler);
    return () => globalThis.removeEventListener('maintenance:enabled', handler);
  }, [isSuperAdmin, queryClient]);

  const handleDisableMaintenance = useCallback(async () => {
    const state = detail.data;
    if (!state) return;
    await updateMutation.mutateAsync({ body: { enabled: false, version: state.version, message: state.message, estimatedEndAt: state.estimatedEndAt, reason: '管理横幅结束维护' } });
    Toast.success('维护模式已关闭');
  }, [updateMutation, detail.data]);

  return {
    maintenanceBannerEnabled: (status?.enabled ?? false) && isSuperAdmin,
    maintenanceBannerMsg: status?.message ?? '系统维护中',
    disablingMaintenance: updateMutation.isPending,
    handleDisableMaintenance,
  };
}
