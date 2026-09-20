import { lazy, Suspense, useState } from 'react';
import { Button, Collapse, Empty, List, Space, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import type { EntityRelationSection, CanonicalEntityType } from '@zenith/shared/platform';
import { useEntityAccessKey, useEntityRelationSection, useEntityRelations, useUnlinkEntity } from '@/hooks/queries/entity-relations';
import { entityRelationLabel, entityStatusLabel } from '@/utils/entity-relations';
import DateTimeText from '@/components/DateTimeText';
import EntityRefBadge from './EntityRefBadge';
import EntityLinkManager from './EntityLinkManager';
import { confirmAndDelete } from '@/components/list-page';
const WorkflowPrintButton = lazy(() => import('@/components/workflow/WorkflowPrintButton'));
const WorkflowAttachmentView = lazy(() => import('./WorkflowAttachmentView'));

interface RelationPanelProps {
  readonly entityType: CanonicalEntityType;
  readonly entityKey: string | undefined;
  readonly enabled?: boolean;
  readonly showAnchor?: boolean;
}

function RelationSectionView({ entityType, entityKey, section, active, canManageLinks }: {
  readonly entityType: CanonicalEntityType;
  readonly entityKey: string;
  readonly section: EntityRelationSection;
  readonly active: boolean;
  readonly canManageLinks: boolean;
}) {
  const query = useEntityRelationSection(entityType, entityKey, section.key, active);
  const unlink = useUnlinkEntity();
  const pages = query.data?.pages ?? [];
  const items = pages.flatMap((page) => page.items).filter((item) => item.capabilities.view);
  const degraded = pages.some((page) => page.degraded);
  return <>
    <Space wrap spacing={8}>
      {pages[0]?.total !== undefined && <Typography.Text type="tertiary">共 {pages[0].total} 条</Typography.Text>}
      <Button size="small" theme="borderless" loading={query.isRefetching} onClick={() => void query.refetch()}>刷新</Button>
    </Space>
    {query.isLoading && <Spin size="small" />}
    {(query.isError || degraded) && <Space wrap spacing={8}>
      <Typography.Text type="danger">{degraded ? '部分关联记录暂时不可用' : '关联记录加载失败'}</Typography.Text>
      <Button size="small" onClick={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}>重试</Button>
    </Space>}
    {!query.isLoading && !query.isError && !degraded && items.length === 0 && <Empty description="暂无关联记录" />}
    {items.length > 0 && <List size="small" split dataSource={items} renderItem={(item) => <List.Item key={`${item.ref.type}:${item.ref.key}`}
      extra={canManageLinks && section.labelKey === 'relation.common.related' ? <Button size="small" theme="borderless" type="danger" disabled={unlink.isPending} onClick={() => confirmAndDelete({
        title: `解除与「${item.title}」的关联？`, okText: '解除关联', successMessage: '已解除关联',
        run: () => unlink.mutateAsync({ params: { type: entityType, key: entityKey }, body: { target: item.ref } }),
      })}>解除</Button> : undefined}
      main={<div style={{ minWidth: 0 }}>
        <Space wrap spacing={8}><EntityRefBadge entityRef={item.ref} capabilities={{ view: item.capabilities.view && section.capabilities.view, open: item.capabilities.open && section.capabilities.open }}>{item.title}</EntityRefBadge>
          {entityStatusLabel(item.status) && <Tag size="small">{entityStatusLabel(item.status)}</Tag>}</Space>
        {item.subtitle && <div><Typography.Text type="tertiary">{item.subtitle}</Typography.Text></div>}
        {item.description && <div><Typography.Text type="tertiary">{item.description}</Typography.Text></div>}
        {item.occurredAt && <div><Typography.Text type="tertiary"><DateTimeText value={item.occurredAt} /></Typography.Text></div>}
      </div>} />} />}
    {query.hasNextPage && <Button size="small" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>加载更多</Button>}
  </>;
}

function RelationGroups({ entityType, entityKey, sections, canManageLinks }: { readonly entityType: CanonicalEntityType; readonly entityKey: string; readonly sections: EntityRelationSection[]; readonly canManageLinks: boolean }) {
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  return <Collapse activeKey={activeKeys} onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])}>
    {sections.filter((section) => section.capabilities.view).map((section) => <Collapse.Panel key={section.key} itemKey={section.key} header={entityRelationLabel(section.labelKey, section.targetTypes)}>
      <RelationSectionView entityType={entityType} entityKey={entityKey} section={section} active={activeKeys.includes(section.key)} canManageLinks={canManageLinks} />
    </Collapse.Panel>)}
  </Collapse>;
}

export default function RelationPanel({ entityType, entityKey, enabled = true, showAnchor = false }: RelationPanelProps) {
  const query = useEntityRelations(entityType, entityKey, enabled);
  const access = useEntityAccessKey();
  if (!enabled || !entityKey) return null;
  if (query.isLoading) return <Spin size="small" />;
  if (query.isError) return <Space wrap><Typography.Text type="danger">对象不可用或关联信息加载失败</Typography.Text><Button size="small" onClick={() => void query.refetch()}>重试</Button></Space>;
  const sections = query.data?.sections ?? [];
  return <div style={{ paddingTop: 12 }}>
    {showAnchor && query.data && <Typography.Title heading={6}>{query.data.anchor.title}</Typography.Title>}
    {entityType === 'workflow.archive' && query.data && <Suspense fallback={<Spin size="small" />}>
      <WorkflowPrintButton instanceId={Number(entityKey)} source="archive">查看归档原件</WorkflowPrintButton>
    </Suspense>}
    {entityType === 'workflow.attachment' && query.data && <Suspense fallback={<Spin size="small" />}>
      <WorkflowAttachmentView id={Number(entityKey)} />
    </Suspense>}
    {query.data?.canManageLinks && <EntityLinkManager key={`manager:${entityType}:${entityKey}:${JSON.stringify(access)}`} anchor={{ type: entityType, key: entityKey }} />}
    {sections.length === 0 ? <Empty description="暂无可见关联信息" /> : <RelationGroups key={`groups:${entityType}:${entityKey}:${JSON.stringify(access)}`} entityType={entityType} entityKey={entityKey} sections={sections} canManageLinks={query.data?.canManageLinks ?? false} />}
  </div>;
}
