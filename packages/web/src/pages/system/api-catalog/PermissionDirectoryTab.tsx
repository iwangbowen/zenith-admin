/** 权限目录：能力定义、形态和绑定页面；页面读、按钮操作与 API-only 权限统一查看。 */
import { useMemo } from 'react';
import { Input, Select, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DESKTOP_PAGINATION_PROPS } from '@/hooks/usePagination';
import { useListSearch } from '@/hooks/useListSearch';
import { apiCatalogKeys, usePermissionCatalog } from '@/hooks/queries/permission-matrix';

type Surface = 'page' | 'operation' | 'api';
type Item = NonNullable<ReturnType<typeof usePermissionCatalog>['data']>['items'][number];

const SURFACE_LABELS: Record<Surface, string> = { page: '页面读', operation: '操作', api: '仅接口' };
const SURFACE_COLORS: Record<Surface, 'blue' | 'green' | 'grey'> = { page: 'blue', operation: 'green', api: 'grey' };

type PermissionFilters = { keyword: string; surface: Surface | undefined };
const EMPTY_FILTERS: PermissionFilters = { keyword: '', surface: undefined };

export default function PermissionDirectoryTab() {
  const query = usePermissionCatalog();
  const search = useListSearch<PermissionFilters>({
    defaults: EMPTY_FILTERS,
    listKey: apiCatalogKeys.permissions,
    refetchOnSearch: false,
  });
  const { submittedParams, handleSearch, handleReset, page, pageSize, buildPagination } = search;
  const keywordField = search.bind('keyword');
  const surfaceField = search.bind('surface', (value: Surface | Surface[] | undefined) => Array.isArray(value) ? value[0] : value);
  const rows = useMemo(() => (query.data?.items ?? []).filter(item => {
    if (submittedParams.surface && item.surface !== submittedParams.surface) return false;
    const keyword = submittedParams.keyword.trim().toLowerCase();
    const bindings = item.pageBindings.map(page => `${page.title} ${page.path ?? ''}`).join(' ');
    const text = `${item.code} ${item.label} ${bindings}`.toLowerCase();
    return !keyword || text.includes(keyword);
  }), [query.data?.items, submittedParams]);
  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );
  const pagination = useMemo(
    () => ({ ...DESKTOP_PAGINATION_PROPS, ...buildPagination(rows.length) }),
    [buildPagination, rows.length],
  );
  const columns: ColumnProps<Item>[] = [
    { title: '权限码', dataIndex: 'code', width: 260, render: (code: string) => <Typography.Text code>{code}</Typography.Text> },
    { title: '名称', dataIndex: 'label', width: 160 },
    { title: '形态', dataIndex: 'surface', width: 100, render: (value: Surface) => <Tag size="small" color={SURFACE_COLORS[value]}>{SURFACE_LABELS[value]}</Tag> },
    { title: '绑定页面', dataIndex: 'pageBindings', width: 240, render: (value: Item['pageBindings']) => value.length ? value.map(page => page.title).join('、') : '—' },
    { title: '路径', dataIndex: 'path', render: (_value: string | null, item: Item) => item.pageBindings.length ? item.pageBindings.map(page => page.path ?? '—').join('、') : '—' },
    { title: '备注', dataIndex: 'uiOnly', width: 100, render: (value: boolean) => value ? <Tag size="small" color="orange">仅前端</Tag> : '—' },
  ];
  return <div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      <Input
        {...keywordField}
        onEnterPress={handleSearch}
        placeholder="搜索权限码、名称或页面"
        showClear
        style={{ width: 300 }}
      />
      <Select
        {...surfaceField}
        placeholder="全部形态"
        showClear
        style={{ width: 150 }}
        optionList={Object.entries(SURFACE_LABELS).map(([value, label]) => ({ value, label }))}
      />
      <SearchButton onClick={handleSearch} />
      <ResetButton onClick={handleReset} />
      <Typography.Text type="tertiary" style={{ alignSelf: 'center' }}>共 {rows.length} 项权限</Typography.Text>
    </div>
    <ConfigurableTable<Item> rowKey="code" dataSource={pageRows} columns={columns} loading={query.isFetching} pagination={pagination} size="small" />
  </div>;
}
