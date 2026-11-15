import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { maintenanceKeys, usePublicMaintenanceStatus } from '@/hooks/queries/maintenance';
const Overlay = lazy(() => import('./MaintenanceOverlay'));

/** Lightweight cross-entry gate; only its active maintenance view loads the illustration. */
export function MaintenanceBoundary({ children }: { readonly children: ReactNode }) {
  const client = useQueryClient();
  const { data } = usePublicMaintenanceStatus({ refetchInterval: 30_000 });
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
  return data?.enabled ? <Suspense fallback={null}><Overlay info={data} /></Suspense> : children;
}
