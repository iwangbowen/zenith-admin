import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react';
import { exportConfigStore } from './export-config-store';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
const ExportConfigPanel = lazy(() => import('./ExportConfigPanel'));
/** Remains mounted when the toolbar dropdown closes. */
export default function ExportConfigHost() {
  const session = useSyncExternalStore(exportConfigStore.subscribe, exportConfigStore.getSnapshot);
  const { pathname } = useLocation();
  const { user } = useAuth();
  useEffect(() => { exportConfigStore.close(); }, [pathname, user?.id]);
  useEffect(() => () => exportConfigStore.close(), []);
  return session ? <Suspense fallback={null}><ExportConfigPanel key={session.id} initial={session.configuration} onClose={exportConfigStore.close} /></Suspense> : null;
}
