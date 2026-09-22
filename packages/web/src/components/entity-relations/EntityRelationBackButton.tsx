import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, X } from 'lucide-react';
import { Button, Space, Tooltip } from '@douyinfe/semi-ui';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  clearEntityRelationNavigation, getEntityRelationNavigation, observeEntityRelationLocation,
  popEntityRelationNavigation, useEntityRelationNavigationSession,
} from './entity-navigation';

const EntityContextSheet = lazy(() => import('./EntityContextRuntime').then((module) => ({ default: module.EntityContextSheet })));

/** One host for the entire admin runtime, mounted only while a relation navigation is active. */
export default function EntityRelationBackButton() {
  const navigation = useEntityRelationNavigationSession();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { user, impersonation } = useAuth();
  const accessKey = JSON.stringify([user?.id ?? null, user?.tenantId ?? null, user?.viewingTenantId ?? null, impersonation?.impersonationId ?? null]);
  const [portalTarget, setPortalTarget] = useState<HTMLElement>(document.body);
  const [closedSheetRevision, setClosedSheetRevision] = useState<number>();
  const restore = navigation?.restore;
  const revision = navigation?.revision;
  const destinationPath = navigation?.destinationPath;
  const navigationAccessKey = navigation?.accessKey;

  useEffect(() => {
    const current = getEntityRelationNavigation();
    if (navigationType === 'POP' && current?.arrived && current.accessKey === accessKey) {
      const sourceIndex = current.stack.map((frame) => frame.locationKey).lastIndexOf(location.key);
      if (sourceIndex >= 0) {
        const frame = popEntityRelationNavigation(sourceIndex);
        if (frame) navigate(frame.url, { replace: true, state: frame.state });
        return;
      }
    }
    observeEntityRelationLocation(location.pathname, accessKey);
  }, [location.key, location.pathname, accessKey, navigationType, navigate, revision]);

  useEffect(() => {
    // Keep the control inside the active dialog's focus scope and above its mask.
    // This also covers targets such as operation logs which intentionally have no embedded relation view.
    const updateTarget = () => {
      const dialogs = [...document.querySelectorAll<HTMLElement>('.semi-sidesheet-inner, .semi-modal-content')]
        .filter((element) => element.getClientRects().length > 0 && element.closest('[aria-hidden="true"]') === null);
      setPortalTarget(dialogs.at(-1) ?? document.body);
    };
    updateTarget();
    const observer = new MutationObserver(updateTarget);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!restore || navigationAccessKey !== accessKey || location.pathname !== destinationPath) return;
    const frame = requestAnimationFrame(() => {
      const container = document.querySelector<HTMLElement>('.admin-content');
      if (container) container.scrollTop = restore.pageScrollTop;
    });
    return () => cancelAnimationFrame(frame);
  }, [accessKey, location.pathname, navigationAccessKey, destinationPath, restore, revision]);

  if (!navigation || navigation.accessKey !== accessKey) return null;
  const restoreSheet = navigation.restore?.kind === 'sheet' && navigation.restore.ref
    && location.pathname === navigation.destinationPath && closedSheetRevision !== navigation.revision;
  const onCloseSheet = () => {
    setClosedSheetRevision(navigation.revision);
    if (navigation.stack.length === 0 && getEntityRelationNavigation()?.revision === navigation.revision) clearEntityRelationNavigation();
  };

  return <>
    {navigation.stack.length > 0 && createPortal(<div role="navigation" aria-label="关联对象导航" style={{
      position: 'fixed', bottom: 16, left: 16, zIndex: 2000,
      borderRadius: 'var(--semi-border-radius-medium)', background: 'var(--semi-color-bg-2)',
      boxShadow: 'var(--semi-shadow-elevated)', padding: 4,
    }}><Space spacing={2}>
      <Tooltip content="返回上一个关联对象">
        <Button theme="borderless" size="small" icon={<ArrowLeft size={16} />} aria-label="返回上一个关联对象" onClick={() => {
          const frame = popEntityRelationNavigation();
          if (frame) navigate(frame.url, { replace: true, state: frame.state });
        }} />
      </Tooltip>
      <Tooltip content="结束关联浏览">
        <Button theme="borderless" size="small" icon={<X size={14} />} aria-label="结束关联浏览" onClick={clearEntityRelationNavigation} />
      </Tooltip>
    </Space></div>, portalTarget)}
    {restoreSheet && <Suspense fallback={null}><EntityContextSheet key={navigation.revision} entityRef={navigation.restore!.ref!} sourceUrl={navigation.restore!.url} onClose={onCloseSheet} /></Suspense>}
  </>;
}
