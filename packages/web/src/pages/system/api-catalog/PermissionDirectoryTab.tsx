/** 权限目录：能力定义、形态和绑定页面；页面读、按钮操作与 API-only 权限统一查看。 */
import { useMemo, useState } from 'react';
import { Input, Select, Table, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { usePermissionCatalog } from '@/hooks/queries/permission-matrix';

type Surface = 'page' | 'button' | 'api';
type Item = NonNullable<ReturnType<typeof usePermissionCatalog>['data']>['items'][number];

const SURFACE_LABELS: Record<Surface, string> = { page: '页面读', button: '操作', api: '仅接口' };
const SURFACE_COLORS: Record<Surface, 'blue' | 'green' | 'grey'> = { page: 'blue', button: 'green', api: 'grey' };

export default function PermissionDirectoryTab() {
  const query = usePermissionCatalog();
  const [keyword, setKeyword] = useState('');
  const [surface, setSurface] = useState<Surface | undefined>();
  const rows = useMemo(() => (query.data?.items ?? []).filter(item => {
    if (surface && item.surface !== surface) return false;
    const text = `${item.code} ${item.label} ${item.pageTitle ?? ''} ${item.path ?? ''}`.toLowerCase();
    return !keyword.trim() || text.includes(keyword.trim().toLowerCase());
  }), [query.data?.items, keyword, surface]);
  const columns: ColumnProps<Item>[] = [
    { title: '权限码', dataIndex: 'code', width: 260, render: (code: string) => <Typography.Text code>{code}</Typography.Text> },
    { title: '名称', dataIndex: 'label', width: 160 },
    { title: '形态', dataIndex: 'surface', width: 100, render: (value: Surface) => <Tag size="small" color={SURFACE_COLORS[value]}>{SURFACE_LABELS[value]}</Tag> },
    { title: '绑定页面', dataIndex: 'pageTitle', width: 180, render: (value: string | null) => value ?? '—' },
    { title: '路径', dataIndex: 'path', render: (value: string | null) => value ?? '—' },
    { title: '备注', dataIndex: 'uiOnly', width: 100, render: (value: boolean) => value ? <Tag size="small" color="orange">仅前端</Tag> : '—' },
  ];
  return <div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      <Input value={keyword} onChange={setKeyword} placeholder="搜索权限码、名称或页面" showClear style={{ width: 300 }} />
      <Select value={surface} onChange={value => setSurface(value as Surface | undefined)} placeholder="全部形态" showClear style={{ width: 150 }}
        optionList={Object.entries(SURFACE_LABELS).map(([value, label]) => ({ value, label }))} />
      <Typography.Text type="tertiary" style={{ alignSelf: 'center' }}>共 {rows.length} 项能力</Typography.Text>
    </div>
    <Table rowKey="code" dataSource={rows} columns={columns} loading={query.isFetching} pagination={{ pageSize: 20 }} size="small" />
  </div>;
}
