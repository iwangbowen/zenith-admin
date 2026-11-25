import { useMemo, useState } from 'react';
import { Button, Checkbox, Input, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PermissionScopeItem } from './scope-types';

const SURFACE_LABELS: Record<PermissionScopeItem['surface'], string> = {
  page: '页面读',
  operation: '操作',
  api: '仅接口',
};

const SURFACE_COLORS: Record<PermissionScopeItem['surface'], 'blue' | 'green' | 'grey'> = {
  page: 'blue',
  operation: 'green',
  api: 'grey',
};

const RISK_COLORS = { low: 'green', high: 'orange', critical: 'red' } as const;

type PermissionGroup = {
  key: string;
  title: string;
  pathLabel: string;
  pageId: number | null;
  items: PermissionScopeItem[];
};

type Props = Readonly<{
  items: PermissionScopeItem[];
  selectedPermissionCodes: string[];
  onChange?: (codes: string[]) => void;
  pageIds?: number[];
  coveredPermissionCodes?: string[];
  readonly?: boolean;
  onlySelected?: boolean;
  height?: number;
  showToolbar?: boolean;
  showPolicy?: boolean;
}>;

function groupItems(items: PermissionScopeItem[]): PermissionGroup[] {
  const groups = new Map<string, PermissionGroup>();
  for (const item of items) {
    const key = item.pageId === null ? 'api-only' : String(item.pageId);
    const group = groups.get(key) ?? {
      key,
      title: item.pageTitle ?? '仅接口权限',
      pathLabel: item.path.slice(0, -1).join(' / '),
      pageId: item.pageId,
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(group => ({ ...group, items: group.items.sort((a, b) => a.label.localeCompare(b.label)) }))
    .sort((a, b) => a.key === 'api-only'
      ? 1
      : b.key === 'api-only'
        ? -1
        : `${a.pathLabel} ${a.title}`.localeCompare(`${b.pathLabel} ${b.title}`));
}

/** 页面访问之外的操作权限列表：按页面分组，页面读权限随页面选中自动锁定。 */
export function PermissionScopePermissionList({
  items,
  selectedPermissionCodes,
  onChange,
  pageIds = [],
  coveredPermissionCodes = [],
  readonly = false,
  onlySelected = false,
  height = 420,
  showToolbar = true,
  showPolicy = false,
}: Props) {
  const [keyword, setKeyword] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const selected = useMemo(() => new Set(selectedPermissionCodes), [selectedPermissionCodes]);
  const pageSet = useMemo(() => new Set(pageIds), [pageIds]);
  const covered = useMemo(() => new Set(coveredPermissionCodes), [coveredPermissionCodes]);

  const groups = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    const visible = items.filter((item) => {
      const autoGranted = item.surface === 'page' && item.pageId !== null && pageSet.has(item.pageId);
      if (onlySelected && !selected.has(item.code) && !autoGranted) return false;
      if (!query) return true;
      return `${item.code} ${item.label} ${item.pageTitle ?? ''} ${item.path.join(' ')}`.toLowerCase().includes(query);
    });
    return groupItems(visible);
  }, [items, keyword, onlySelected, pageSet, selected]);

  const isExpanded = (group: PermissionGroup) => keyword.trim().length > 0 || expandedGroups.has(group.key);
  const toggleGroup = (key: string) => setExpandedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const isAutoGranted = (item: PermissionScopeItem) => item.surface === 'page' && item.pageId !== null && pageSet.has(item.pageId);
  const groupSelected = (group: PermissionGroup) => group.items.length > 0
    && group.items.every(item => isAutoGranted(item) || selected.has(item.code));
  const toggleGroupSelection = (group: PermissionGroup) => {
    if (readonly || !onChange) return;
    const next = new Set(selected);
    const select = !groupSelected(group);
    for (const item of group.items) {
      if (isAutoGranted(item) || !item.requestable) continue;
      if (select) next.add(item.code); else next.delete(item.code);
    }
    onChange([...next]);
  };
  const toggleItem = (item: PermissionScopeItem, checked: boolean) => {
    if (readonly || !onChange || isAutoGranted(item) || !item.requestable) return;
    const next = new Set(selected);
    if (checked) next.add(item.code); else next.delete(item.code);
    onChange([...next]);
  };

  return (
    <div>
      <Input
        value={keyword}
        onChange={setKeyword}
        placeholder="搜索权限码、名称或页面"
        showClear
        style={{ marginBottom: 8 }}
      />
      {showToolbar && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Space wrap>
            <Button size="small" theme="borderless" onClick={() => setExpandedGroups(new Set(groups.map(group => group.key)))}>展开全部</Button>
            <Button size="small" theme="borderless" onClick={() => setExpandedGroups(new Set())}>折叠全部</Button>
          </Space>
        </div>
      )}
      <div style={{ maxHeight: height, overflow: 'auto', paddingRight: 4 }}>
        {groups.length === 0 && <Typography.Text type="tertiary">{onlySelected ? '没有生效的操作权限' : '没有匹配的权限'}</Typography.Text>}
        {groups.map((group) => {
          const expanded = isExpanded(group);
          const allChecked = groupSelected(group);
          return (
            <div key={group.key} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <Button
                  size="small"
                  theme="borderless"
                  aria-label={expanded ? `折叠 ${group.title}` : `展开 ${group.title}`}
                  aria-expanded={expanded}
                  icon={expanded ? <ChevronDown size={18} strokeWidth={2.2} /> : <ChevronRight size={18} strokeWidth={2.2} />}
                  style={{ width: 26, height: 26, padding: 0, flexShrink: 0 }}
                  onClick={() => toggleGroup(group.key)}
                />
                <Typography.Text
                  strong
                  onClick={() => toggleGroup(group.key)}
                  style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                >
                  {group.title}
                </Typography.Text>
                {group.pathLabel && (
                  <Typography.Text type="tertiary" size="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={group.pathLabel}>
                    {group.pathLabel}
                  </Typography.Text>
                )}
                <Tag size="small" color={group.pageId === null ? 'grey' : pageSet.has(group.pageId) ? 'blue' : 'grey'}>
                  {group.pageId === null ? '仅接口' : pageSet.has(group.pageId) ? '页面已授权' : '页面未授权'}
                </Tag>
                <Typography.Text type="tertiary" size="small">{group.items.length} 项</Typography.Text>
                {!readonly && group.pageId !== null && (
                  <Button size="small" theme="borderless" onClick={() => toggleGroupSelection(group)}>
                    {allChecked ? '取消全选' : '全选本页'}
                  </Button>
                )}
              </div>
              {expanded && (
                <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                  {group.items.map((item) => {
                    const autoGranted = isAutoGranted(item);
                    const checked = autoGranted || selected.has(item.code);
                    return (
                      <div key={item.code} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, paddingLeft: 22 }}>
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
                            disabled={autoGranted || !item.requestable}
                            aria-label={`${item.label} ${item.code}`}
                            onChange={(event) => toggleItem(item, Boolean(event.target.checked))}
                          />
                        )}
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.path.join(' / ')}>
                          {item.label}
                        </span>
                        <Typography.Text type="tertiary" size="small" style={{ flexShrink: 0 }}>{item.code}</Typography.Text>
                        <Tag size="small" color={SURFACE_COLORS[item.surface]}>
                          {autoGranted ? '随页面' : SURFACE_LABELS[item.surface]}
                        </Tag>
                        {showPolicy && item.riskLevel && item.riskLevel !== 'low' && (
                          <Tag size="small" color={RISK_COLORS[item.riskLevel]}>{item.riskLevel === 'critical' ? '极高危' : '高危'}</Tag>
                        )}
                        {item.uiOnly && <Tag size="small" color="orange">仅前端</Tag>}
                        {covered.has(item.code) && <Tag size="small">角色已包含</Tag>}
                        {!item.requestable && <Tag size="small" color="grey">不可申请</Tag>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
