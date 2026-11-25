/**
 * 能力授权面板：权限码来自权限目录，包含页面读权限、按钮操作权限和 API-only 权限。
 * 页面读权限在页面已选中时自动视为授予，避免页面和读权限漏配；操作权限不会带出页面。
 */
import { useMemo, useState } from 'react';
import { Banner, Button, Checkbox, Input, Space, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { usePermissionCatalog } from '@/hooks/queries/permission-matrix';

type CapabilityItem = {
  code: string;
  label: string;
  surface: 'page' | 'button' | 'api';
  pageId: number | null;
  pageTitle: string | null;
  path: string | null;
  uiOnly: boolean;
};

const SURFACE_LABELS: Record<CapabilityItem['surface'], string> = {
  page: '页面读',
  button: '操作',
  api: '仅接口',
};

const SURFACE_COLORS: Record<CapabilityItem['surface'], 'blue' | 'green' | 'grey'> = {
  page: 'blue',
  button: 'green',
  api: 'grey',
};

type CapabilityPanelProps = Readonly<{
  selectedPermissionCodes: string[];
  onChange?: (codes: string[]) => void;
  /** 已选页面：页面的读权限自动随页面授予，在权限面板中锁定展示 */
  selectedPageIds?: number[];
  readonly?: boolean;
}>;

export function CapabilityPanel({
  selectedPermissionCodes,
  onChange,
  selectedPageIds = [],
  readonly = false,
}: CapabilityPanelProps) {
  const catalogQuery = usePermissionCatalog();
  const [keyword, setKeyword] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const selected = useMemo(() => new Set(selectedPermissionCodes), [selectedPermissionCodes]);
  const pageSet = useMemo(() => new Set(selectedPageIds), [selectedPageIds]);
  const grouped = useMemo(() => {
    const groups = new Map<string, CapabilityItem[]>();
    const query = keyword.trim().toLowerCase();
    for (const item of catalogQuery.data?.items ?? []) {
      if (query && !`${item.code} ${item.label} ${item.pageTitle ?? ''}`.toLowerCase().includes(query)) continue;
      const key = item.pageTitle ?? '仅接口权限';
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a === '仅接口权限' ? 1 : b === '仅接口权限' ? -1 : a.localeCompare(b));
  }, [catalogQuery.data?.items, keyword]);

  if (catalogQuery.isLoading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;
  if (catalogQuery.error) return <Banner type="danger" closeIcon={null} description={catalogQuery.error.message} />;

  const toggle = (item: CapabilityItem, checked: boolean) => {
    if (readonly) return;
    if (item.surface === 'page' && item.pageId !== null && pageSet.has(item.pageId)) return;
    const next = new Set(selected);
    if (checked) next.add(item.code); else next.delete(item.code);
    onChange?.([...next]);
  };

  return (
    <div>
      <Banner
        type="info"
        closeIcon={null}
        style={{ marginBottom: 8 }}
        description="接口权限只授予调用权限，不产生页面导航。页面读权限随已选页面自动锁定；只勾选读/操作权限可获得 API-only 权限。"
      />
      <Input
        value={keyword}
        onChange={(value) => setKeyword(value)}
        placeholder="搜索权限码、名称或页面"
        showClear
        style={{ marginBottom: 8 }}
      />
      <Space style={{ marginBottom: 8 }}>
        <Button size="small" theme="borderless" onClick={() => setExpandedGroups(new Set(grouped.map(([group]) => group)))}>展开全部</Button>
        <Button size="small" theme="borderless" onClick={() => setExpandedGroups(new Set())}>折叠全部</Button>
      </Space>
      <div style={{ maxHeight: 420, overflow: 'auto', paddingRight: 4 }}>
        {grouped.length === 0 && <Typography.Text type="tertiary">没有匹配的权限</Typography.Text>}
        {grouped.map(([group, items]) => {
          const expanded = keyword.trim().length > 0 || expandedGroups.has(group);
          return (
          <div key={group} style={{ marginBottom: 12 }}>
            <Button
              size="small"
              theme="borderless"
              style={{ display: 'block', paddingLeft: 0, marginBottom: 6 }}
              onClick={() => setExpandedGroups(prev => {
                const next = new Set(prev);
                if (next.has(group)) next.delete(group); else next.add(group);
                return next;
              })}
            >
              {expanded ? '▾' : '▸'} {group}（{items.length}）
            </Button>
            {expanded && <div style={{ display: 'grid', gap: 6 }}>
              {items.map((item) => {
                const autoGranted = item.surface === 'page' && item.pageId !== null && pageSet.has(item.pageId);
                const checked = autoGranted || selected.has(item.code);
                return (
                  <div key={item.code} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Checkbox
                      checked={checked}
                      disabled={readonly || autoGranted}
                      onChange={(event) => toggle(item, Boolean(event.target.checked))}
                    >
                      <span style={{ marginRight: 6 }}>{item.label}</span>
                      <Typography.Text type="tertiary" size="small">{item.code}</Typography.Text>
                    </Checkbox>
                    <Tag size="small" color={SURFACE_COLORS[item.surface]}>{autoGranted ? '随页面' : SURFACE_LABELS[item.surface]}</Tag>
                    {item.uiOnly && <Tag size="small" color="orange">仅前端</Tag>}
                  </div>
                );
              })}
            </div>}
          </div>
          );
        })}
      </div>
    </div>
  );
}
