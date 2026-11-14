import { lazy, Suspense, useContext, useState } from 'react';
import { Button } from '@douyinfe/semi-ui';
import { Download } from 'lucide-react';
import type { Permission } from '@zenith/shared/core';
import type { ExportJobFormat, ExportJobRequestMode } from '@zenith/shared/tasks';
import { ToolbarSlotContext } from '@/components/toolbar-slot-context';
import { usePermission } from '@/hooks/usePermission';
import type { ExportConfiguration } from './ExportConfigPanel';
const ExportConfigPanel = lazy(() => import('./ExportConfigPanel'));
interface ExportButtonProps {
  entity: string;
  query?: Record<string, unknown>;
  resolveQuery?: (format: ExportJobFormat) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
  label?: string;
  formats?: ExportJobFormat[];
  raw?: boolean;
  watermark?: boolean;
  executionMode?: ExportJobRequestMode;
  variant?: 'primary' | 'flat';
  permission?: Permission;
  selectedIds?: Array<string | number>;
  pageIds?: Array<string | number>;
}
export function ExportButton({ entity, query, resolveQuery, label = '导出', formats = ['xlsx', 'csv'], raw = false, watermark = true, executionMode = 'auto', variant = 'primary', permission, selectedIds, pageIds }: Readonly<ExportButtonProps>) {
  const { hasPermission } = usePermission();
  const slot = useContext(ToolbarSlotContext);
  const [initial, setInitial] = useState<ExportConfiguration | null>(null);
  const [resolving, setResolving] = useState(false);
  if (permission && !hasPermission(permission)) return null;
  const flat = variant === 'flat' || slot === 'mobile-actions';
  const open = async () => {
    setResolving(true);
    try {
      const resolved = resolveQuery ? await resolveQuery(formats[0] ?? 'xlsx') : query ?? {};
      if (resolved) setInitial({ entity, query: resolved, formats, raw, watermark, executionMode, selectedIds, pageIds });
    } finally { setResolving(false); }
  };
  return <>
    <Button className={flat ? 'export-button export-button--flat' : 'export-button'} type="primary" theme={flat ? 'borderless' : undefined} icon={<Download size={14} />} loading={resolving} onClick={() => void open()}>{label}</Button>
    {initial && <Suspense fallback={null}><ExportConfigPanel initial={initial} onClose={() => setInitial(null)} /></Suspense>}
  </>;
}
export default ExportButton;

