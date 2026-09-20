import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, SideSheet, Space, Tabs, TabPane } from '@douyinfe/semi-ui';
import { ArrowLeft } from 'lucide-react';
import { ENTITY_REGISTRY, type CanonicalEntityRef, type CanonicalEntityType } from '@zenith/shared/platform/entity-catalog';
import { useEntityAccessKey } from '@/hooks/queries/entity-relations';
import { entityDetailRoute, entityTypeLabel } from '@/utils/entity-relations';
import { EntityNavigationContext } from './entity-navigation';
import RelationPanel from './RelationPanel';
import EntityTimeline from './EntityTimeline';

export default function EntityContextView({ entityType, entityKey, showAnchor = false }: {
  readonly entityType: CanonicalEntityType;
  readonly entityKey: string | undefined;
  readonly showAnchor?: boolean;
}) {
  const [tab, setTab] = useState('relations');
  const access = useEntityAccessKey();
  return <Tabs key={`${entityType}:${entityKey}:${JSON.stringify(access)}`} collapsible="auto" activeKey={tab} onChange={setTab} lazyRender keepDOM={false}>
    <TabPane tab="关联记录" itemKey="relations">
      <RelationPanel entityType={entityType} entityKey={entityKey} enabled={tab === 'relations'} showAnchor={showAnchor} />
    </TabPane>
    {ENTITY_REGISTRY[entityType].capabilities.includes('timeline') && <TabPane tab="业务时间线" itemKey="timeline">
      <EntityTimeline entityType={entityType} entityKey={entityKey} enabled={tab === 'timeline'} />
    </TabPane>}
  </Tabs>;
}

/** Both embedded views and the drawer share one deferred runtime. */
export function EntityContextSheet({ entityRef, onClose }: {
  readonly entityRef: CanonicalEntityRef;
  readonly onClose: () => void;
}) {
  const navigate = useNavigate();
  const [history, setHistory] = useState<CanonicalEntityRef[]>([entityRef]);
  const current = history[history.length - 1];
  return <SideSheet title={<Space>
    {history.length > 1 && <Button size="small" theme="borderless" aria-label="返回上一个关联对象" icon={<ArrowLeft size={16} />} onClick={() => setHistory((refs) => refs.slice(0, -1))} />}
    {entityTypeLabel(current.type)} · 关联信息
  </Space>} visible onCancel={onClose} width={680} closeOnEsc>
    <EntityNavigationContext.Provider value={(ref) => {
      const route = entityDetailRoute(ref);
      if (route) { onClose(); navigate(route); return; }
      if (ref.type !== current.type || ref.key !== current.key) setHistory((refs) => [...refs, ref]);
    }}>
      <EntityContextView key={`${current.type}:${current.key}`} entityType={current.type} entityKey={current.key} showAnchor />
    </EntityNavigationContext.Provider>
  </SideSheet>;
}
