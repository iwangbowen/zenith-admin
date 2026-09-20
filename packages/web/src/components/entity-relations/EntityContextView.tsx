import { useState } from 'react';
import { Tabs, TabPane } from '@douyinfe/semi-ui';
import { ENTITY_REGISTRY, type CanonicalEntityType } from '@zenith/shared/platform';
import { useEntityAccessKey } from '@/hooks/queries/entity-relations';
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
