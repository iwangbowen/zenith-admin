import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Collapse, Empty, List, Space, Spin, Tag, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { EntityRelationItem, EntityRelationKind, EntityRelationSection, EntityRelationSummaryState, CanonicalEntityType } from '@zenith/shared/platform';
import { Activity, CircleAlert, CircleCheck, CircleOff, CircleSlash2, EyeOff, Filter, GitBranch, Link2, RefreshCw, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { entityRelationsContract } from '@zenith/shared/platform';
import { contractKey } from '@/lib/contract-query';
import { useEntityAccessKey, useEntityRelationSection, useEntityRelations, useUnlinkEntity } from '@/hooks/queries/entity-relations';
import { entityRelationKindLabel, entityRelationLabel, entityStatusLabel } from '@/utils/entity-relations';
import DateTimeText from '@/components/DateTimeText';
import EntityRefBadge from './EntityRefBadge';
import EntityLinkManager from './EntityLinkManager';
import { confirmAndDelete } from '@/components/list-page';
import { EntityRelationViewStateContext } from './entity-navigation';
import { formatDateTime, formatDateTimeRangeForApi } from '@/utils/date';
import { useListSearch } from '@/hooks/useListSearch';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import RelationFilters, { type RelationSearchState } from './RelationFilters';
import ManagedBusinessFileView from './ManagedBusinessFileView';
import EntityWatchButton from './EntityWatchButton';
import WorkflowAttachmentView from './WorkflowAttachmentView';
const emptyRelationSearch = (): RelationSearchState => ({ keyword: '', status: undefined, range: null, attentionOnly: false });
const WorkflowPrintButton = lazy(() => import('@/components/workflow/WorkflowPrintButton'));

const RELATION_SUMMARY_PRESENTATION: Record<EntityRelationSummaryState, {
  readonly label: string;
  readonly Icon: LucideIcon;
  readonly color: string;
}> = {
  'has-data': { label: '有记录', Icon: CircleCheck, color: 'var(--semi-color-success)' },
  empty: { label: '暂无记录', Icon: CircleSlash2, color: 'var(--semi-color-tertiary)' },
  attention: { label: '需处理', Icon: CircleAlert, color: 'var(--semi-color-warning)' },
  unavailable: { label: '暂不可用', Icon: CircleOff, color: 'var(--semi-color-danger)' },
};

const RELATION_KIND_PRESENTATION: Record<EntityRelationKind, {
  readonly Icon: LucideIcon;
  readonly color: string;
}> = {
  direct: { Icon: Link2, color: 'var(--semi-color-primary)' },
  derived: { Icon: GitBranch, color: 'var(--semi-color-info)' },
  causal: { Icon: Zap, color: 'var(--semi-color-warning)' },
  activity: { Icon: Activity, color: 'var(--semi-color-tertiary)' },
};

function RelationSectionHeader({ section, summaryState }: {
  readonly section: EntityRelationSection;
  readonly summaryState: EntityRelationSummaryState;
}) {
  const label = entityRelationLabel(section.labelKey, section.targetTypes);
  const presentation = RELATION_SUMMARY_PRESENTATION[summaryState];
  const statusLabel = `${label}：${presentation.label}`;
  const Icon = presentation.Icon;
  const kindPresentation = RELATION_KIND_PRESENTATION[section.kind];
  const KindIcon = kindPresentation.Icon;
  const kindLabel = `关联来源：${entityRelationKindLabel(section.kind)}`;
  return <Space spacing={6}>
    <Tooltip content={statusLabel}>
      <span role="img" aria-label={statusLabel} style={{ color: presentation.color, display: 'inline-flex' }}>
        <Icon size={15} aria-hidden="true" />
      </span>
    </Tooltip>
    <Tooltip content={kindLabel}>
      <span role="img" aria-label={kindLabel} style={{ color: kindPresentation.color, display: 'inline-flex' }}>
        <KindIcon size={14} aria-hidden="true" />
      </span>
    </Tooltip>
    <span>{label}</span>
  </Space>;
}

function RelationOriginHint({ section, item }: { readonly section: EntityRelationSection; readonly item: EntityRelationItem }) {
  const kind = item.origin?.kind ?? section.kind;
  const kindPresentation = RELATION_KIND_PRESENTATION[kind];
  const Icon = kindPresentation.Icon;
  const parts = [`关联来源：${entityRelationKindLabel(kind)}`];
  if (item.origin?.explanation) parts.push(item.origin.explanation);
  if (item.origin?.eventType) parts.push(`来源事件：${item.origin.eventType}`);
  if (item.origin?.relatedAt) parts.push(`关联建立时间：${formatDateTime(item.origin.relatedAt)}`);
  if (item.manual?.createdByName) parts.push(`建立人：${item.manual.createdByName}`);
  if (item.occurredAt) parts.push(`记录时间：${formatDateTime(item.occurredAt)}`);
  const label = parts.join(' · ');
  return <Tooltip content={label}>
    <span role="img" aria-label={label} style={{ color: kindPresentation.color, display: 'inline-flex' }}>
      <Icon size={14} aria-hidden="true" />
    </span>
  </Tooltip>;
}

interface RelationPanelProps {
  readonly entityType: CanonicalEntityType;
  readonly entityKey: string | undefined;
  readonly enabled?: boolean;
  readonly showAnchor?: boolean;
}

type RelationSectionQuery = ReturnType<typeof useEntityRelationSection>;

function RelationSectionView({ entityType, entityKey, section, active, canManageLinks, onSummaryStateChange, query, filtered, filters, filterToggle }: {
  readonly entityType: CanonicalEntityType;
  readonly entityKey: string;
  readonly section: EntityRelationSection;
  readonly active: boolean;
  readonly canManageLinks: boolean;
  readonly onSummaryStateChange: (sectionKey: string, state: EntityRelationSummaryState) => void;
  readonly query: RelationSectionQuery;
  readonly filtered: boolean;
  readonly filters?: ReactNode;
  readonly filterToggle?: ReactNode;
}) {
  const unlink = useUnlinkEntity();
  const queryClient = useQueryClient();
  const refreshSection = () => {
    void query.refetch();
    // Attention considers the full visible set; a page of records cannot clear it by itself.
    void queryClient.invalidateQueries({ queryKey: contractKey(entityRelationsContract.describe, { params: { type: entityType, key: entityKey } }) });
  };
  const pages = query.data?.pages ?? [];
  const items = pages.flatMap((page) => page.items).filter((item) => item.capabilities.view);
  const degraded = pages.some((page) => page.degraded);
  const sectionError = query.isError;
  const hasResponse = query.data !== undefined;
  useEffect(() => {
    if (!active || query.isFetching || filtered) return;
    if (sectionError || degraded) {
      onSummaryStateChange(section.key, 'unavailable');
      return;
    }
    if (!hasResponse) return;
    onSummaryStateChange(section.key, items.length > 0 ? (section.summaryState === 'attention' ? 'attention' : 'has-data') : query.hasNextPage ? 'unavailable' : 'empty');
  }, [active, degraded, filtered, hasResponse, items.length, onSummaryStateChange, query.hasNextPage, query.isFetching, section.key, section.summaryState, sectionError]);
  const label = entityRelationLabel(section.labelKey, section.targetTypes);
  return <div style={{ position: 'relative' }}>
    {filterToggle && <span style={{ position: 'absolute', top: 0, right: 32, zIndex: 1, lineHeight: 0 }}>{filterToggle}</span>}
    <span style={{ position: 'absolute', top: 0, right: 0, zIndex: 1, lineHeight: 0 }}>
      <Tooltip content={`刷新${label}`}>
        <Button size="small" theme="borderless" icon={<RefreshCw size={14} />} loading={query.isFetching} aria-label={`刷新${label}`}
          onClick={(event) => { event.stopPropagation(); refreshSection(); }} />
      </Tooltip>
    </span>
    <div style={{ paddingTop: 4, paddingRight: filterToggle ? 64 : 32 }}>
      {filters}
      {(query.isError || degraded) && <Space wrap spacing={8}>
        <Typography.Text type="danger">{degraded ? '部分关联记录暂时不可用' : '关联记录加载失败'}</Typography.Text>
        <Button size="small" onClick={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}>重试</Button>
      </Space>}
      {hasResponse && !sectionError && !degraded && items.length === 0 && <Empty description={query.hasNextPage ? '继续加载以查找可见的匹配记录' : filtered ? '没有符合筛选条件的关联记录' : '暂无关联记录'} />}
      {items.length > 0 && <List size="small" split dataSource={items} renderItem={(item) => <List.Item key={`${item.ref.type}:${item.ref.key}:${item.manual?.type ?? ''}:${item.manual?.direction ?? ''}`}
      extra={<Space spacing={8}>{item.action && <EntityRefBadge entityRef={item.action.target} capabilities={item.capabilities}>{item.action.label}</EntityRefBadge>}{canManageLinks && section.labelKey === 'relation.common.related' ? <Button size="small" theme="borderless" type="danger" disabled={unlink.isPending} onClick={() => confirmAndDelete({
        title: `解除与「${item.title}」的关联？`, okText: '解除关联', successMessage: '已解除关联',
        run: () => unlink.mutateAsync({ params: { type: entityType, key: entityKey }, body: { target: item.ref, relationType: item.manual?.type, direction: item.manual?.direction } }),
      })}>解除</Button> : null}</Space>}
      main={<div style={{ minWidth: 0 }}>
        <Space wrap spacing={8}><EntityRefBadge entityRef={item.ref} capabilities={{ view: item.capabilities.view && section.capabilities.view, open: item.capabilities.open && section.capabilities.open }}>{item.title}</EntityRefBadge>
          <RelationOriginHint section={section} item={item} />
          {entityStatusLabel(item.status) && <Tag size="small">{entityStatusLabel(item.status)}</Tag>}</Space>
        {item.subtitle && <div><Typography.Text type="tertiary">{item.subtitle}</Typography.Text></div>}
        {item.description && <div><Typography.Text type="tertiary">{item.description}</Typography.Text></div>}
        {item.occurredAt && <div><Typography.Text type="tertiary"><DateTimeText value={item.occurredAt} /></Typography.Text></div>}
      </div>} />} />}
      {query.hasNextPage && <Button size="small" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>加载更多</Button>}
    </div>
  </div>;
}

function RelationGroupItem({ entityType, entityKey, section, active, summaryState, canManageLinks, onSummaryStateChange }: {
  readonly entityType: CanonicalEntityType;
  readonly entityKey: string;
  readonly section: EntityRelationSection;
  readonly active: boolean;
  readonly summaryState: EntityRelationSummaryState;
  readonly canManageLinks: boolean;
  readonly onSummaryStateChange: (sectionKey: string, state: EntityRelationSummaryState) => void;
}) {
  const search = useListSearch({ defaults: emptyRelationSearch,
    listKey: contractKey(entityRelationsContract.section, { params: { type: entityType, key: entityKey, sectionKey: section.key }, query: {} }),
  });
  const filters = useFilterQuery({ keyword: search.submittedParams.keyword, status: search.submittedParams.status,
    ...formatDateTimeRangeForApi(search.submittedParams.range), attentionOnly: search.submittedParams.attentionOnly ? true : undefined });
  const filtered = Object.keys(filters).length > 0;
  const [showFilters, setShowFilters] = useState(filtered);
  const supportsFilters = Boolean(section.filters?.keyword || section.filters?.dateRange || section.filters?.attentionOnly || section.filters?.statusOptions?.length);
  const query = useEntityRelationSection(entityType, entityKey, section.key, active, 5, filters);
  return <Collapse.Panel key={section.key} itemKey={section.key}
    header={<RelationSectionHeader section={section} summaryState={summaryState} />}>
    <RelationSectionView entityType={entityType} entityKey={entityKey} section={section} active={active} canManageLinks={canManageLinks}
      onSummaryStateChange={onSummaryStateChange} query={query} filtered={filtered}
      filters={supportsFilters && showFilters ? <RelationFilters section={section} search={search} /> : undefined}
      filterToggle={supportsFilters ? <Tooltip content="筛选关联记录"><Button size="small" theme={filtered ? 'light' : 'borderless'} aria-label="筛选关联记录" aria-expanded={showFilters} icon={<Filter size={14} />} onClick={() => setShowFilters((value) => !value)} /></Tooltip> : undefined} />
  </Collapse.Panel>;
}

function RelationGroups({ entityType, entityKey, sections, canManageLinks, hideEmpty }: { readonly entityType: CanonicalEntityType; readonly entityKey: string; readonly sections: EntityRelationSection[]; readonly canManageLinks: boolean; readonly hideEmpty: boolean }) {
  const viewState = useContext(EntityRelationViewStateContext);
  const [localActiveKeys, setLocalActiveKeys] = useState<string[]>([]);
  const activeKeys = viewState?.expandedGroups ?? localActiveKeys;
  const setActiveKeys = viewState?.setExpandedGroups ?? setLocalActiveKeys;
  const defaultSummaryStates = useMemo(() => Object.fromEntries(
    sections.map((section) => [section.key, section.summaryState]),
  ), [sections]);
  const [summaryStates, setSummaryStates] = useState<Record<string, EntityRelationSummaryState>>(() => Object.fromEntries(
    sections.map((section) => [section.key, section.summaryState]),
  ));
  useEffect(() => {
    setSummaryStates(defaultSummaryStates);
  }, [defaultSummaryStates]);
  const updateSummaryState = useCallback((sectionKey: string, state: EntityRelationSummaryState) => {
    setSummaryStates((previous) => previous[sectionKey] === state ? previous : { ...previous, [sectionKey]: state });
  }, []);
  return <Collapse activeKey={activeKeys} onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])}>
    {sections.filter((section) => section.capabilities.view && (!hideEmpty || (summaryStates[section.key] ?? section.summaryState) !== 'empty')).map((section) => <RelationGroupItem key={section.key} entityType={entityType} entityKey={entityKey}
      section={section} active={activeKeys.includes(section.key)} summaryState={summaryStates[section.key] ?? 'unavailable'} canManageLinks={canManageLinks}
      onSummaryStateChange={updateSummaryState} />)}
  </Collapse>;
}

export default function RelationPanel({ entityType, entityKey, enabled = true, showAnchor = false }: RelationPanelProps) {
  const query = useEntityRelations(entityType, entityKey, enabled);
  const access = useEntityAccessKey();
  const display = useListSearch({ defaults: { hideEmpty: false }, listKey: ['entity-relation-display', entityType, entityKey, access], refetchOnSearch: false });
  if (!enabled || !entityKey) return null;
  if (query.isLoading) return <Spin size="small" />;
  if (query.isError) return <Space wrap><Typography.Text type="danger">对象不可用或关联信息加载失败</Typography.Text><Button size="small" onClick={() => void query.refetch()}>重试</Button></Space>;
  const sections = query.data?.sections ?? [];
  return <div style={{ paddingTop: 12 }}>
    {showAnchor && query.data && <Typography.Title heading={6}>{query.data.anchor.title}</Typography.Title>}
    {entityType === 'workflow.archive' && query.data && <Suspense fallback={<Spin size="small" />}>
      <WorkflowPrintButton instanceId={Number(entityKey)} source="archive">查看归档原件</WorkflowPrintButton>
    </Suspense>}
    {entityType === 'workflow.attachment' && query.data && <WorkflowAttachmentView id={Number(entityKey)} />}
    {entityType === 'platform.managed-file' && query.data && <ManagedBusinessFileView fileId={entityKey} />}
    <Space spacing={8} style={{ marginBottom: 8 }}>
      <EntityWatchButton entityRef={{ type: entityType, key: entityKey }} />
      {query.data?.canManageLinks && <EntityLinkManager key={`manager:${entityType}:${entityKey}:${JSON.stringify(access)}`} anchor={{ type: entityType, key: entityKey }} />}
      <Tooltip content={display.submittedParams.hideEmpty ? '显示空分组' : '隐藏空分组'}><Button size="small" theme={display.submittedParams.hideEmpty ? 'light' : 'borderless'} aria-label="隐藏空分组" aria-pressed={display.submittedParams.hideEmpty} icon={<EyeOff size={14} />} onClick={() => display.applySearch({ hideEmpty: !display.submittedParams.hideEmpty })} /></Tooltip>
    </Space>
    {sections.length === 0 ? <Empty description="暂无可见关联信息" /> : <RelationGroups key={`groups:${entityType}:${entityKey}:${JSON.stringify(access)}`} entityType={entityType} entityKey={entityKey} sections={sections} canManageLinks={query.data?.canManageLinks ?? false} hideEmpty={display.submittedParams.hideEmpty} />}
  </div>;
}
