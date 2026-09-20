import { lazy, Suspense, useState } from 'react';
import { Button, Spin } from '@douyinfe/semi-ui';
import { Link2 } from 'lucide-react';
import { supportsEntityRelations, type CanonicalEntityRef, type CanonicalEntityType } from '@zenith/shared/platform/entity-catalog';

const EntityContextRuntime = lazy(() => import('./EntityContextRuntime'));
export const EntityContextSheet = lazy(() => import('./EntityContextRuntime').then((module) => ({ default: module.EntityContextSheet })));

/** Entry components keep relation queries, contracts and renderers out of the application shell. */
export function EntityContextView(props: { readonly entityType: CanonicalEntityType; readonly entityKey: string | undefined; readonly showAnchor?: boolean }) {
  return <Suspense fallback={<Spin size="small" />}><EntityContextRuntime {...props} /></Suspense>;
}

/** Entry points may probe an object; the sheet always authorizes its exact ref. */
export default function EntityRelationButton({ entityRef, onOpen }: { readonly entityRef: CanonicalEntityRef; readonly onOpen?: (ref: CanonicalEntityRef) => void }) {
  const [open, setOpen] = useState(false);
  if (!supportsEntityRelations(entityRef.type)) return null;
  return <>
    <Button size="small" theme="borderless" icon={<Link2 size={14} />} onClick={(event) => { event.stopPropagation(); if (onOpen) onOpen(entityRef); else setOpen(true); }}>关联信息</Button>
    {open && <Suspense fallback={null}><EntityContextSheet entityRef={entityRef} onClose={() => setOpen(false)} /></Suspense>}
  </>;
}
