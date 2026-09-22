import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, SideSheet, Space, Tabs, TabPane } from '@douyinfe/semi-ui';
import { ArrowLeft } from 'lucide-react';
import { ENTITY_REGISTRY, type CanonicalEntityRef, type CanonicalEntityType } from '@zenith/shared/platform/entity-catalog';
import { useEntityAccessKey } from '@/hooks/queries/entity-relations';
import { entityDetailRoute, entityTypeLabel } from '@/utils/entity-relations';
import {
  beginEntityRelationNavigation, captureEntityRelationScroll, EntityNavigationContext,
  EntityRelationViewStateContext, entityRelationSourceUrl, getEntityRelationNavigation,
  restoreEntityRelationScroll, sameEntity, useEntityRelationNavigationSession,
  type EntityRelationViewSnapshot,
} from './entity-navigation';
import RelationPanel from './RelationPanel';
import EntityTimeline from './EntityTimeline';

const EntitySheetContext = createContext<{
  history: readonly CanonicalEntityRef[];
  sourceUrl?: string;
  view?: EntityRelationViewSnapshot;
  onLeave: () => void;
  open: (ref: CanonicalEntityRef, view: EntityRelationViewSnapshot) => void;
} | null>(null);

function EntityContextContent({ entityRef, showAnchor }: {
  readonly entityRef: CanonicalEntityRef;
  readonly showAnchor: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const accessKey = JSON.stringify(useEntityAccessKey());
  const sheet = useContext(EntitySheetContext);
  const root = useRef<HTMLDivElement>(null);
  const navigation = useEntityRelationNavigationSession();
  const restore = sheet?.view ?? (navigation?.accessKey === accessKey && sameEntity(navigation.restore?.ref, entityRef)
    ? navigation.restore?.view : undefined);
  const [tab, setTab] = useState(restore?.tab ?? 'relations');
  const [expandedGroups, setExpandedGroups] = useState<string[]>(() => [...restore?.expandedGroups ?? []]);
  const [fallbackRef, setFallbackRef] = useState<CanonicalEntityRef>();

  useEffect(() => {
    if (!restore || !root.current) return;
    setTab(restore.tab);
    setExpandedGroups([...restore.expandedGroups]);
    return restoreEntityRelationScroll(root.current, restore.scroll);
  }, [restore]);

  const open = (ref: CanonicalEntityRef) => {
    if (sameEntity(ref, entityRef) && !sheet) return;
    const route = entityDetailRoute(ref);
    const view: EntityRelationViewSnapshot = { tab, expandedGroups, scroll: captureEntityRelationScroll(root.current) };
    if (!route) { if (sheet) sheet.open(ref, view); else setFallbackRef(ref); return; }
    beginEntityRelationNavigation({
      url: sheet?.sourceUrl ?? entityRelationSourceUrl(location, sheet ? undefined : entityDetailRoute(entityRef)),
      locationKey: location.key, state: location.state, ref: entityRef, kind: sheet ? 'sheet' : 'detail', view,
      sheetHistory: sheet?.history,
      pageScrollTop: document.querySelector<HTMLElement>('.admin-content')?.scrollTop ?? 0,
    }, route, accessKey, location.pathname);
    sheet?.onLeave();
    navigate(route);
  };

  return <><div ref={root} data-entity-context={`${entityRef.type}:${entityRef.key}`}>
    <EntityNavigationContext.Provider value={open}>
      <EntityRelationViewStateContext.Provider value={{ expandedGroups, setExpandedGroups }}>
        <Tabs collapsible="auto" activeKey={tab} onChange={setTab} lazyRender keepDOM={false}>
          <TabPane tab="关联记录" itemKey="relations">
            <RelationPanel entityType={entityRef.type} entityKey={entityRef.key} enabled={tab === 'relations'} showAnchor={showAnchor} />
          </TabPane>
          {ENTITY_REGISTRY[entityRef.type].capabilities.includes('timeline') && <TabPane tab="业务时间线" itemKey="timeline">
            <EntityTimeline entityType={entityRef.type} entityKey={entityRef.key} enabled={tab === 'timeline'} />
          </TabPane>}
        </Tabs>
      </EntityRelationViewStateContext.Provider>
    </EntityNavigationContext.Provider>
  </div>{fallbackRef && <EntityContextSheet entityRef={fallbackRef} sourceUrl={entityRelationSourceUrl(location, entityDetailRoute(entityRef))} onClose={() => setFallbackRef(undefined)} />}</>;
}

export default function EntityContextView({ entityType, entityKey, showAnchor = false }: {
  readonly entityType: CanonicalEntityType;
  readonly entityKey: string | undefined;
  readonly showAnchor?: boolean;
}) {
  const access = useEntityAccessKey();
  if (!entityKey) return null;
  return <EntityContextContent key={`${entityType}:${entityKey}:${JSON.stringify(access)}`} entityRef={{ type: entityType, key: entityKey }} showAnchor={showAnchor} />;
}

/** Both embedded views and the drawer share one deferred runtime. */
export function EntityContextSheet({ entityRef, onClose, sourceUrl }: {
  readonly entityRef: CanonicalEntityRef;
  readonly onClose: () => void;
  readonly sourceUrl?: string;
}) {
  const accessKey = JSON.stringify(useEntityAccessKey());
  const [history, setHistory] = useState<readonly CanonicalEntityRef[]>(() => {
    const navigation = getEntityRelationNavigation();
    const restore = navigation?.accessKey === accessKey ? navigation.restore : undefined;
    return restore?.kind === 'sheet' && sameEntity(restore.ref, entityRef) ? restore.sheetHistory ?? [entityRef] : [entityRef];
  });
  const current = history[history.length - 1];
  const views = useRef(new Map<string, EntityRelationViewSnapshot>());
  return <SideSheet title={<Space>
    {history.length > 1 && <Button size="small" theme="borderless" aria-label="返回上一个关联对象" icon={<ArrowLeft size={16} />} onClick={() => setHistory((refs) => refs.slice(0, -1))} />}
    {entityTypeLabel(current.type)} · 关联信息
  </Space>} visible onCancel={onClose} width={680} closeOnEsc>
    <EntitySheetContext.Provider value={{ history, sourceUrl, view: views.current.get(`${current.type}:${current.key}`), onLeave: onClose, open: (ref, view) => {
      if (!sameEntity(ref, current)) {
        views.current.set(`${current.type}:${current.key}`, view);
        setHistory((refs) => [...refs, ref]);
      }
    } }}>
      <EntityContextView entityType={current.type} entityKey={current.key} showAnchor />
    </EntitySheetContext.Provider>
  </SideSheet>;
}
