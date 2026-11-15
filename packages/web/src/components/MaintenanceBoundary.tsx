import { useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { maintenanceKeys, usePublicMaintenanceStatus } from '@/hooks/queries/maintenance';
import Overlay from './MaintenanceOverlay';

/** Cross-entry gate: preserve credentials while ordinary entry points are paused. */
export function MaintenanceBoundary({ children }: { readonly children: ReactNode }) {
  const client = useQueryClient();
  const { data, isPending, isError, refetch } = usePublicMaintenanceStatus({ refetchInterval: 30_000 });
  const wasEnabled = useRef(false);
  useEffect(() => {
    if (wasEnabled.current && data?.enabled === false) void client.invalidateQueries();
    wasEnabled.current = data?.enabled ?? false;
  }, [client, data?.enabled]);
  useEffect(() => {
    const handler = () => void client.invalidateQueries({ queryKey: maintenanceKeys.publicStatus });
    globalThis.addEventListener('maintenance:enabled', handler);
    return () => globalThis.removeEventListener('maintenance:enabled', handler);
  }, [client]);
  if (isPending) return <div role="status" style={{ padding: 32 }}>正在检查服务状态…</div>;
  if (isError && !data) return <div role="alert" style={{ padding: 32 }}>暂时无法检查服务状态，登录凭证已保留。<button onClick={() => void refetch()}>重试</button></div>;
  return data?.enabled ? <Overlay info={data} /> : children;
}
