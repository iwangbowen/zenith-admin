import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Input, Tag, Typography } from '@douyinfe/semi-ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Menu } from '@zenith/shared/identity';
import type { PermissionScopeData, PermissionScopeItem, PermissionScopeValue } from './scope-types';

type Props = Readonly<{
  data: PermissionScopeData;
  value: PermissionScopeValue;
  onChange: (value: PermissionScopeValue) => void;
  readonly?: boolean;
  height?: number;
  /** 只展示当前已生效的页面读/操作权限，用于最终有效权限。 */
  onlySelected?: boolean;
  /** 最终有效权限等只读场景不要自动展开全部操作面板。 */
  autoExpandSelected?: boolean;
  pageSuffix?: Record<string, React.ReactNode>;
  showPolicy?: boolean;
}>;

type IndexedPage = {
  page: Menu;
  children: IndexedPage[];
  parentIds: number[];
};

const SURFACE_LABELS: Record<PermissionScopeItem['surface'], string> = {
  page: '页面读',
  operation: '操作',
  api: '仅接口',
};

/** 页面特别多（如超管 265 页）时不一次性展开全部操作面板，避免首屏过长；仍可手动展开。 */
const AUTO_EXPAND_PAGE_LIMIT = 30;

function indexPages(nodes: Menu[], parentIds: number[] = []): IndexedPage[] {
  return nodes.map(page => ({
    page,
    parentIds,
    children: indexPages(page.children ?? [], [...parentIds, page.id]),
  }));
}

function flattenPages(nodes: IndexedPage[]): IndexedPage[] {
  return nodes.flatMap(node => [node, ...flattenPages(node.children)]);
}

function matchesText(value: string | null | undefined, query: string): boolean {
  return !!value && value.toLowerCase().includes(query);
}

export function PermissionScopePageTree({
  data,
  value,
  onChange,
  readonly = false,
  height = 520,
  onlySelected = false,
  autoExpandSelected = true,
  pageSuffix,
  showPolicy = false,
}: Props) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const expandedSelectedRef = useRef<Set<number>>(new Set());
  const pages = useMemo(() => indexPages(data.pages), [data.pages]);
  const allPages = useMemo(() => flattenPages(pages), [pages]);
  const pageById = useMemo(() => new Map(allPages.map(item => [item.page.id, item])), [allPages]);
  const permissionsByPage = useMemo(() => {
    const map = new Map<number, PermissionScopeItem[]>();
    for (const item of data.permissions) {
      if (item.pageId === null) continue;
      const list = map.get(item.pageId) ?? [];
      list.push(item);
      map.set(item.pageId, list);
    }
    return map;
  }, [data.permissions]);
  const selectedPages = useMemo(() => new Set(value.pageIds), [value.pageIds]);
  const selectedCodes = useMemo(() => new Set(value.permissionCodes), [value.permissionCodes]);

  // 已授权页面首次出现或新选中时自动展开；用户手动折叠后，其他选择变化不再强行展开。
  useEffect(() => {
    const nextSelection = new Set(value.pageIds);
    const newPageIds = [...nextSelection].filter(id => !expandedSelectedRef.current.has(id));
    expandedSelectedRef.current = nextSelection;
    if (!autoExpandSelected || newPageIds.length === 0 || nextSelection.size > AUTO_EXPAND_PAGE_LIMIT) return;
    setExpanded(previous => {
      const next = new Set(previous);
      for (const pageId of newPageIds) {
        const indexed = pageById.get(pageId);
        if (!indexed) continue;
        next.add(pageId);
        for (const parentId of indexed.parentIds) next.add(parentId);
      }
      return next;
    });
  }, [autoExpandSelected, pageById, value.pageIds]);

  const pageMatches = (page: Menu, indexed: IndexedPage): boolean => {
    if (!query) return true;
    const q = query.toLowerCase();
    const ownText = [page.title, page.name, page.path, page.component, page.permission].some(text => matchesText(text, q));
    const ownOps = (permissionsByPage.get(page.id) ?? []).some(item => matchesText(`${item.label} ${item.code} ${item.pageTitle ?? ''}`, q));
    return ownText || ownOps || indexed.children.some(child => pageMatches(child.page, child));
  };

  const operationItemsOf = (pageId: number) => (permissionsByPage.get(pageId) ?? [])
    .filter(item => item.surface === 'operation');

  const readItemOf = (pageId: number) => (permissionsByPage.get(pageId) ?? [])
    .find(item => item.surface === 'page');

  const togglePage = (pageId: number) => {
    if (readonly) return;
    const next = new Set(selectedPages);
    if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
    onChange({ ...value, pageIds: [...next] });
  };

  const toggleItem = (item: PermissionScopeItem) => {
    if (readonly || !item.requestable) return;
    const autoPageRead = item.surface === 'page' && item.pageId !== null && selectedPages.has(item.pageId);
    if (autoPageRead) return;
    const next = new Set(selectedCodes);
    if (next.has(item.code)) next.delete(item.code); else next.add(item.code);
    onChange({ ...value, permissionCodes: [...next] });
  };

  const togglePageOperations = (pageId: number) => {
    if (readonly) return;
    const operations = operationItemsOf(pageId).filter(item => item.requestable);
    if (operations.length === 0) return;
    const allSelected = operations.every(item => selectedCodes.has(item.code));
    const next = new Set(selectedCodes);
    for (const item of operations) {
      if (allSelected) next.delete(item.code); else next.add(item.code);
    }
    onChange({ ...value, permissionCodes: [...next] });
  };

  const renderOperationPanel = (page: Menu, level: number) => {
    const baseItems = permissionsByPage.get(page.id) ?? [];
    const items = onlySelected
      ? baseItems.filter(item => selectedCodes.has(item.code) || (item.surface === 'page' && selectedPages.has(page.id)))
      : baseItems;
    if (items.length === 0) return null;
    const q = query.toLowerCase();
    const visibleItems = query ? items.filter(item => matchesText(`${item.label} ${item.code}`, q) || matchesText(page.title, q)) : items;
    const operations = items.filter(item => item.surface === 'operation' && item.requestable);
    const selectedOperationCount = items.filter(item => item.surface === 'operation' && selectedCodes.has(item.code)).length;
    return (
      <div style={{ marginLeft: level * 20 + 30, padding: '2px 0 8px', borderLeft: '2px solid var(--semi-color-fill-2)', paddingLeft: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Typography.Text type="tertiary" size="small">页面操作</Typography.Text>
          <Typography.Text type="tertiary" size="small">{selectedOperationCount}/{operations.length} 项</Typography.Text>
          {!readonly && operations.length > 0 && (
            <Button size="small" theme="borderless" onClick={() => togglePageOperations(page.id)}>
              {operations.every(item => selectedCodes.has(item.code)) ? '取消全选操作' : '全选本页操作'}
            </Button>
          )}
        </div>
        {visibleItems.map(item => {
          const autoPageRead = item.surface === 'page' && selectedPages.has(page.id);
          const checked = autoPageRead || selectedCodes.has(item.code);
          return (
            <div key={item.code} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '2px 0' }}>
              {readonly ? (
                <span aria-hidden style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  flexShrink: 0,
                  background: item.surface === 'page'
                    ? 'var(--semi-color-primary)'
                    : item.surface === 'operation'
                      ? 'var(--semi-color-success)'
                      : 'var(--semi-color-text-2)',
                }} />
              ) : (
                <Checkbox
                  checked={checked}
                  disabled={autoPageRead || !item.requestable}
                  aria-label={`${item.label} ${item.code}`}
                  onChange={() => toggleItem(item)}
                />
              )}
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
              <Typography.Text type="tertiary" size="small" style={{ flexShrink: 0 }}>{item.code}</Typography.Text>
              <Tag size="small" color={item.surface === 'page' ? 'blue' : 'green'}>
                {autoPageRead ? '随页面' : SURFACE_LABELS[item.surface]}
              </Tag>
              {showPolicy && item.riskLevel && item.riskLevel !== 'low' && (
                <Tag size="small" color={item.riskLevel === 'critical' ? 'red' : 'orange'}>
                  {item.riskLevel === 'critical' ? '极高危' : '高危'}
                </Tag>
              )}
              {!item.requestable && <Tag size="small" color="grey">不可申请</Tag>}
            </div>
          );
        })}
      </div>
    );
  };

  const renderNodes = (nodes: IndexedPage[], level: number): React.ReactNode[] => {
    return nodes.flatMap((indexed) => {
      const page = indexed.page;
      if (!pageMatches(page, indexed)) return [];
      const allOperations = operationItemsOf(page.id);
      const operations = onlySelected
        ? allOperations.filter(item => selectedCodes.has(item.code))
        : allOperations;
      const readItem = readItemOf(page.id);
      const selectedOperationCount = operations.filter(item => selectedCodes.has(item.code)).length;
      const hasContent = indexed.children.length > 0 || operations.length > 0 || !!readItem;
      const isExpanded = !!query || expanded.has(page.id);
      const pageSelected = selectedPages.has(page.id);
      const toggleExpanded = () => setExpanded(previous => {
        const next = new Set(previous);
        if (next.has(page.id)) next.delete(page.id); else next.add(page.id);
        return next;
      });
      const row = (
        <div key={`page-${page.id}`} style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, padding: '4px 0', paddingLeft: level * 20 }}>
            {hasContent ? (
              <Button
                size="small"
                theme="borderless"
                aria-label={isExpanded ? `折叠 ${page.title}` : `展开 ${page.title}`}
                aria-expanded={isExpanded}
                icon={isExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                style={{ width: 24, height: 24, padding: 0, flexShrink: 0 }}
                onClick={toggleExpanded}
              />
            ) : <span style={{ width: 24, flexShrink: 0 }} />}
            <Checkbox
              checked={pageSelected}
              disabled={readonly}
              aria-label={`页面访问 ${page.title}`}
              onChange={() => togglePage(page.id)}
            />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: page.type === 'directory' ? 600 : 400 }} title={page.title}>
              {page.title}
            </span>
            {pageSuffix?.[String(page.id)]}
            <Tag size="small" color={page.type === 'directory' ? 'grey' : 'blue'}>{page.type === 'directory' ? '目录' : '页面'}</Tag>
            {readItem && (
              <Tag size="small" color={pageSelected || selectedCodes.has(readItem.code) ? 'blue' : 'grey'}>
                {pageSelected ? '读权限随页面' : selectedCodes.has(readItem.code) ? '仅接口' : '读权限未授权'}
              </Tag>
            )}
            {page.type === 'menu' && operations.length > 0 && (
              <Typography.Text type={pageSelected && selectedOperationCount === 0 ? 'warning' : 'tertiary'} size="small">
                操作 {selectedOperationCount}/{operations.length}
              </Typography.Text>
            )}
          </div>
          {isExpanded && renderOperationPanel(page, level)}
          {isExpanded && indexed.children.length > 0 && renderNodes(indexed.children, level + 1)}
        </div>
      );
      return [row];
    });
  };

  const filteredPages = pages.filter(page => pageMatches(page.page, page));

  return (
    <div>
      <Input
        value={query}
        onChange={setQuery}
        placeholder="搜索页面、路由或操作权限"
        showClear
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <Button size="small" theme="borderless" onClick={() => setExpanded(new Set(allPages.map(item => item.page.id)))}>展开全部</Button>
        <Button size="small" theme="borderless" onClick={() => setExpanded(new Set())}>折叠全部</Button>
      </div>
      <div style={{ maxHeight: height, overflow: 'auto', paddingRight: 4 }}>
        {filteredPages.length === 0 ? (
          <Typography.Text type="tertiary">没有匹配的页面或操作权限</Typography.Text>
        ) : renderNodes(filteredPages, 0)}
      </div>
    </div>
  );
}
