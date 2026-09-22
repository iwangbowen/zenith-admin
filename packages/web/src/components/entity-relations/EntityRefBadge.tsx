import { Suspense, useContext, useState, type ReactNode } from 'react';
import { Button, Typography } from '@douyinfe/semi-ui';
import type { CanonicalEntityRef } from '@zenith/shared/platform';
import { entityDetailRoute, entityTypeLabel } from '@/utils/entity-relations';
import { useLocation, useNavigate } from 'react-router-dom';
import { appendEntityRelationFrame, EntityNavigationContext } from './entity-navigation';
import { EntityContextSheet } from './EntityRelationButton';

export default function EntityRefBadge({ entityRef, capabilities, children }: {
  readonly entityRef: CanonicalEntityRef;
  readonly capabilities: { view: boolean; open: boolean };
  readonly children?: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const openEntity = useContext(EntityNavigationContext);
  const [open, setOpen] = useState(false);
  const title = children ?? `${entityTypeLabel(entityRef.type)} #${entityRef.key}`;
  if (!capabilities.view) return null;
  if (!capabilities.open) return <Typography.Text>{title}</Typography.Text>;
  return <>
    <Button theme="borderless" size="small" style={{ maxWidth: '100%', paddingLeft: 0, justifyContent: 'flex-start' }} onClick={(event) => {
      event.stopPropagation();
      if (openEntity) { openEntity(entityRef); return; }
      const route = entityDetailRoute(entityRef);
      if (route) navigate(route, { state: appendEntityRelationFrame(location) }); else setOpen(true);
    }}><Typography.Text ellipsis={{ showTooltip: true }} style={{ color: 'inherit' }}>{title}</Typography.Text></Button>
    {open && <Suspense fallback={null}><EntityContextSheet entityRef={entityRef} onClose={() => setOpen(false)} /></Suspense>}
  </>;
}
