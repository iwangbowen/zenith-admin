import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, SideSheet, Space } from '@douyinfe/semi-ui';
import { ArrowLeft } from 'lucide-react';
import type { CanonicalEntityRef } from '@zenith/shared/platform';
import { entityDetailRoute, entityTypeLabel } from '@/utils/entity-relations';
import EntityContextView from './EntityContextView';
import { EntityNavigationContext } from './entity-navigation';

export default function EntityContextSheet({ entityRef, onClose }: {
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
