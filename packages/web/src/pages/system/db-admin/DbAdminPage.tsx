import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Empty,
  Input,
  JsonViewer,
  List,
  Modal,
  Pagination,
  Popconfirm,
  Space,
  Spin,
  Tabs,
  TabPane,
  Tag,
  Toast,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import {
  Database,
  Table as TableIcon,
  Play,
  Eye,
  Download,
  RefreshCw,
  History,
  Trash2,
  Search,
} from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import Editor from '@monaco-editor/react';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import { useThemeController } from '@/providers/theme-controller';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateTime } from '@/utils/date';

const { Title, Text } = Typography;

interface ColumnFilterDropdownProps {
  columnName: string;
  tempFilteredValue: unknown[];
  setTempFilteredValue: (value: unknown[]) => void;
  confirm: (props?: { closeDropdown?: boolean; filteredValue?: unknown[] }) => void;
  clear: (props?: { closeDropdown?: boolean }) => void;
  close: () => void;
}

function ColumnFilterDropdown(props: Readonly<ColumnFilterDropdownProps>) {
  const { columnName, tempFilteredValue, setTempFilteredValue, confirm, clear, close } = props;
  const tempValue = Array.isArray(tempFilteredValue) && tempFilteredValue.length > 0
    ? String(tempFilteredValue[0])
    : '';
  const apply = () => {
    const kw = tempValue.trim();
    confirm({ filteredValue: kw ? [kw] : [] });
  };
  const reset = () => { clear(); close(); };
  const handleInputChange = (v: string) => setTempFilteredValue(v ? [v] : []);
  return (
    <div style={{ padding: 8, width: 240 }}>
      <Input
        size="small"
        autoFocus
        value={tempValue}
        onChange={handleInputChange}
        onEnterPress={apply}
        placeholder={`筛选 ${columnName}……`}
      />
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
        <Button size="small" theme="borderless" onClick={reset}>重置</Button>
        <Button size="small" theme="solid" type="primary" onClick={apply}>筛选</Button>
      </div>
    </div>
  );
}

interface TableItem {
  schema: string;
  name: string;
  rowEstimate: number;
  sizeBytes: number;
  sizeText: string;
  comment: string | null;
}

interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  comment: string | null;
  maxLength: number | null;
}

interface IndexInfo {
  name: string; columns: string[]; isUnique: boolean; isPrimary: boolean; definition: string;
}

interface ForeignKeyInfo {
  name: string; columns: string[]; referencedSchema: string; referencedTable: string;
  referencedColumns: string[]; onUpdate: string; onDelete: string;
}

interface TableStructure {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  primaryKey: string[];
}

interface QueryResult {
  columns: Array<{ name: string; dataType: string }>;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

interface HistoryItem {
  id: number;
  sqlText: string;
  durationMs: number;
  rowCount: number;
  success: boolean;
  errorMessage: string | null;
  executedAt: string;
}

interface TableRowsResponse {
  list: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
}

interface PaginatedResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_SQL = '-- 只读模式：仅允许 SELECT / EXPLAIN 等查询语句\nSELECT * FROM users LIMIT 50;';

export default function DbAdminPage() {
  const { hasPermission } = usePermission();
  const canQuery = hasPermission('system:db-admin:query');
  const canExport = hasPermission('system:db-admin:export');
  const { isDark } = useThemeController();
  const monacoTheme = isDark ? 'vs-dark' : 'light';

  const [activeTab, setActiveTab] = useState<string>('browse');

  // 表浏览
  const [tables, setTables] = useState<TableItem[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tableFilter, setTableFilter] = useState('');
  const [selected, setSelected] = useState<TableItem | null>(null);
  const [innerTab, setInnerTab] = useState<string>('structure');
  const [structure, setStructure] = useState<TableStructure | null>(null);
  const [structureLoading, setStructureLoading] = useState(false);
  const [rows, setRows] = useState<TableRowsResponse | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsPage, setRowsPage] = useState(1);
  const [rowsPageSize, setRowsPageSize] = useState(20);
  const [rowsOrderBy, setRowsOrderBy] = useState<string | undefined>(undefined);
  const [rowsOrderDir, setRowsOrderDir] = useState<'asc' | 'desc' | undefined>(undefined);
  const [rowsFilters, setRowsFilters] = useState<Record<string, string>>({});

  // SQL 控制台
  const [sql, setSql] = useState<string>(DEFAULT_SQL);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainData, setExplainData] = useState<unknown>(null);

  // 历史
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [historyLoading, setHistoryLoading] = useState(false);

  const filteredTables = useMemo(() => {
    const kw = tableFilter.trim().toLowerCase();
    if (!kw) return tables;
    return tables.filter((t) => `${t.schema}.${t.name}`.toLowerCase().includes(kw));
  }, [tables, tableFilter]);

  const loadTables = useCallback(async () => {
    setTablesLoading(true);
    const res = await request.get<TableItem[]>('/api/db-admin/tables');
    if (res.code === 0 && res.data) setTables(res.data);
    setTablesLoading(false);
  }, []);

  const loadStructure = useCallback(async (item: TableItem) => {
    setStructureLoading(true);
    const res = await request.get<TableStructure>(
      `/api/db-admin/tables/${encodeURIComponent(item.schema)}/${encodeURIComponent(item.name)}/structure`,
    );
    if (res.code === 0 && res.data) setStructure(res.data);
    setStructureLoading(false);
  }, []);

  const loadRows = useCallback(async (
    item: TableItem,
    page: number,
    pageSize: number,
    orderBy?: string,
    orderDir?: 'asc' | 'desc',
    filters?: Record<string, string>,
  ) => {
    setRowsLoading(true);
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('pageSize', String(pageSize));
    if (orderBy && orderDir) {
      qs.set('orderBy', orderBy);
      qs.set('orderDir', orderDir);
    }
    const activeFilters = filters
      ? Object.fromEntries(Object.entries(filters).filter(([, v]) => v.length > 0))
      : {};
    if (Object.keys(activeFilters).length > 0) {
      qs.set('filters', JSON.stringify(activeFilters));
    }
    const res = await request.get<TableRowsResponse>(
      `/api/db-admin/tables/${encodeURIComponent(item.schema)}/${encodeURIComponent(item.name)}/rows?${qs.toString()}`,
    );
    if (res.code === 0 && res.data) setRows(res.data);
    setRowsLoading(false);
  }, []);

  const loadHistory = useCallback(async (page: number, pageSize: number) => {
    setHistoryLoading(true);
    const res = await request.get<PaginatedResponse<HistoryItem>>(
      `/api/db-admin/query/history?page=${page}&pageSize=${pageSize}`,
    );
    if (res.code === 0 && res.data) {
      setHistory(res.data.list);
      setHistoryTotal(res.data.total);
    }
    setHistoryLoading(false);
  }, []);

  useEffect(() => { void loadTables(); }, [loadTables]);

  useEffect(() => {
    if (!selected) return;
    if (innerTab === 'structure') void loadStructure(selected);
    if (innerTab === 'data') {
      setRowsPage(1);
      void loadRows(selected, 1, rowsPageSize, rowsOrderBy, rowsOrderDir, rowsFilters);
    }
  }, [selected, innerTab, loadStructure, loadRows, rowsPageSize, rowsOrderBy, rowsOrderDir, rowsFilters]);

  useEffect(() => {
    if (activeTab === 'history') void loadHistory(historyPage, historyPageSize);
  }, [activeTab, historyPage, historyPageSize, loadHistory]);

  const handleSelectTable = (item: TableItem) => {
    setSelected(item);
    setStructure(null);
    setRows(null);
    setRowsPage(1);
    setRowsOrderBy(undefined);
    setRowsOrderDir(undefined);
    setRowsFilters({});
  };

  const handleRowsPageChange = (page: number, pageSize: number) => {
    if (!selected) return;
    setRowsPage(page);
    setRowsPageSize(pageSize);
    void loadRows(selected, page, pageSize, rowsOrderBy, rowsOrderDir, rowsFilters);
  };

  const handleRowsSort = (col: string, dir: 'asc' | 'desc' | undefined) => {
    if (!selected) return;
    const nextBy = dir ? col : undefined;
    const nextDir = dir;
    setRowsOrderBy(nextBy);
    setRowsOrderDir(nextDir);
    setRowsPage(1);
    void loadRows(selected, 1, rowsPageSize, nextBy, nextDir, rowsFilters);
  };

  const handleRowsResetAll = () => {
    if (!selected) return;
    setRowsOrderBy(undefined);
    setRowsOrderDir(undefined);
    setRowsFilters({});
    setRowsPage(1);
    void loadRows(selected, 1, rowsPageSize, undefined, undefined, {});
  };

  // ─── SQL 执行 ────────────────────────────────────────────────────────────────
  const editorRef = useRef<{ getValue: () => string } | null>(null);

  const runQuery = async () => {
    const text = editorRef.current?.getValue() ?? sql;
    if (!text.trim()) { Toast.warning('请输入 SQL'); return; }
    setQueryLoading(true);
    setQueryError(null);
    setQueryResult(null);
    const res = await request.post<QueryResult>('/api/db-admin/query', { sql: text }, { silent: true });
    setQueryLoading(false);
    if (res.code === 0 && res.data) {
      setQueryResult(res.data);
      if (res.data.truncated) {
        Toast.warning(`结果超出 5000 行已截断`);
      } else {
        Toast.success(`返回 ${res.data.rowCount} 行 / ${res.data.durationMs}ms`);
      }
    } else {
      setQueryError(res.message ?? '执行失败');
    }
  };

  const runExplain = async () => {
    const text = editorRef.current?.getValue() ?? sql;
    if (!text.trim()) { Toast.warning('请输入 SQL'); return; }
    const res = await request.post<{ plan: unknown; durationMs: number }>(
      '/api/db-admin/explain', { sql: text }, { silent: true },
    );
    if (res.code === 0 && res.data) {
      setExplainData(res.data.plan);
      setExplainOpen(true);
    } else {
      Toast.error(res.message ?? 'EXPLAIN 失败');
    }
  };

  const exportCsv = async () => {
    const text = editorRef.current?.getValue() ?? sql;
    if (!text.trim()) { Toast.warning('请输入 SQL'); return; }
    const token = localStorage.getItem(TOKEN_KEY);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/db-admin/query/export.csv`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sql: text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        Toast.error(err?.message ?? '导出失败');
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `query_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      Toast.error('导出失败：' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const applyHistorySql = (text: string) => {
    setSql(text);
    setActiveTab('console');
  };

  const deleteHistoryItem = async (id: number) => {
    const res = await request.delete(`/api/db-admin/query/history/${id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      void loadHistory(historyPage, historyPageSize);
    }
  };

  const clearHistory = async () => {
    const res = await request.delete('/api/db-admin/query/history');
    if (res.code === 0) {
      Toast.success('已清空');
      setHistoryPage(1);
      void loadHistory(1, historyPageSize);
    }
  };

  // ─── 渲染辅助 ────────────────────────────────────────────────────────────────
  const structureColumns: ColumnProps<ColumnInfo>[] = [
    { title: '列名', dataIndex: 'name', width: 200, render: (v: string, r) => (
      <Space>
        <Text strong>{v}</Text>
        {r.isPrimaryKey && <Tag color="orange" size="small">PK</Tag>}
      </Space>
    )},
    { title: '类型', dataIndex: 'dataType', width: 180 },
    { title: '可空', dataIndex: 'isNullable', width: 80, render: (v: boolean) => v ? '是' : '否' },
    { title: '默认值', dataIndex: 'defaultValue', width: 180, render: (v: string | null) => v ?? '-' },
    { title: '注释', dataIndex: 'comment', render: (v: string | null) => v ?? '-' },
  ];

  const indexColumns: ColumnProps<IndexInfo>[] = [
    { title: '索引名', dataIndex: 'name' },
    { title: '列', dataIndex: 'columns', render: (v: string[]) => v.join(', ') },
    { title: '类型', render: (_, r) => (
      <Space>
        {r.isPrimary && <Tag color="orange" size="small">PRIMARY</Tag>}
        {r.isUnique && !r.isPrimary && <Tag color="blue" size="small">UNIQUE</Tag>}
        {!r.isUnique && !r.isPrimary && <Tag size="small">INDEX</Tag>}
      </Space>
    )},
  ];

  const fkColumns: ColumnProps<ForeignKeyInfo>[] = [
    { title: '约束名', dataIndex: 'name' },
    { title: '本表列', dataIndex: 'columns', render: (v: string[]) => v.join(', ') },
    { title: '引用表', render: (_, r) => `${r.referencedSchema}.${r.referencedTable}` },
    { title: '引用列', dataIndex: 'referencedColumns', render: (v: string[]) => v.join(', ') },
    { title: 'ON DELETE', dataIndex: 'onDelete', width: 120 },
    { title: 'ON UPDATE', dataIndex: 'onUpdate', width: 120 },
  ];

  const renderCell = (v: unknown): React.ReactNode => {
    if (v == null) return <Text type="quaternary">NULL</Text>;
    if (typeof v === 'object') return <Text code>{JSON.stringify(v)}</Text>;
    let str: string;
    if (typeof v === 'string') str = v;
    else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') str = v.toString();
    else str = JSON.stringify(v);
    if (str.length > 80) return <Tooltip content={<div style={{ maxWidth: 400, wordBreak: 'break-all' }}>{str}</div>}>{str.slice(0, 80) + '…'}</Tooltip>;
    return str;
  };

  const buildDataColumns = (
    cols: Array<{ name: string; dataType?: string }>,
    options?: { sortable?: boolean; filterable?: boolean },
  ): ColumnProps<Record<string, unknown>>[] => {
    const sortable = options?.sortable ?? false;
    const filterable = options?.filterable ?? false;
    return cols.map((c) => {
      const titleNode = c.dataType
        ? <Space spacing={4}><Text>{c.name}</Text><Text type="tertiary" size="small">{c.dataType}</Text></Space>
        : c.name;
      const col: ColumnProps<Record<string, unknown>> = {
        title: titleNode,
        dataIndex: c.name,
        key: c.name,
        width: 180,
        ellipsis: { showTitle: false },
        render: renderCell,
      };
      if (sortable) {
        col.sorter = true;
        let sortOrder: 'ascend' | 'descend' | false = false;
        if (rowsOrderBy === c.name) sortOrder = rowsOrderDir === 'asc' ? 'ascend' : 'descend';
        col.sortOrder = sortOrder;
      }
      if (filterable) {
        const current = rowsFilters[c.name] ?? '';
        const active = current.length > 0;
        col.filteredValue = active ? [current] : [];
        col.renderFilterDropdown = (renderProps) => (
          <ColumnFilterDropdown
            columnName={c.name}
            tempFilteredValue={renderProps.tempFilteredValue}
            setTempFilteredValue={renderProps.setTempFilteredValue}
            confirm={renderProps.confirm}
            clear={renderProps.clear}
            close={renderProps.close}
          />
        );
      }
      return col;
    });
  };

  const historyColumns: ColumnProps<HistoryItem>[] = [
    { title: '时间', dataIndex: 'executedAt', width: 170, render: (v: string) => formatDateTime(v) },
    { title: '状态', dataIndex: 'success', width: 80, render: (v: boolean) =>
      v ? <Badge type="success" dot /> : <Badge type="danger" dot />,
    },
    { title: 'SQL', dataIndex: 'sqlText', ellipsis: { showTitle: false }, render: (v: string) => (
      <Tooltip content={<div style={{ maxWidth: 500, whiteSpace: 'pre-wrap' }}>{v}</div>}>
        <Text code>{v.length > 100 ? v.slice(0, 100) + '…' : v}</Text>
      </Tooltip>
    )},
    { title: '耗时', dataIndex: 'durationMs', width: 100, render: (v: number) => `${v}ms` },
    { title: '行数', dataIndex: 'rowCount', width: 80 },
    { title: '错误', dataIndex: 'errorMessage', ellipsis: { showTitle: false }, render: (v: string | null) =>
      v ? <Tooltip content={<div style={{ maxWidth: 400 }}>{v}</div>}><Text type="danger">{v.slice(0, 60)}</Text></Tooltip> : '-',
    },
    { title: '操作', width: 160, fixed: 'right', render: (_, r) => (
      <Space>
        <Button theme="borderless" size="small" onClick={() => applyHistorySql(r.sqlText)}>使用</Button>
        <Popconfirm title="删除该记录？" onConfirm={() => deleteHistoryItem(r.id)}>
          <Button theme="borderless" type="danger" size="small">删除</Button>
        </Popconfirm>
      </Space>
    )},
  ];

  // ─── 主渲染 ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 16 }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        type="line"
        tabBarStyle={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--semi-color-bg-1)',
          marginBottom: 8,
        }}
      >
        <TabPane tab={<span><TableIcon size={14} style={{ verticalAlign: -2, marginRight: 4 }} />表浏览</span>} itemKey="browse">
          <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 240px)', minHeight: 480 }}>
            {/* 左侧表列表 */}
            <div style={{ width: 320, display: 'flex', flexDirection: 'column', border: '1px solid var(--semi-color-border)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ padding: 12, borderBottom: '1px solid var(--semi-color-border)', flexShrink: 0 }}>
                <Space style={{ width: '100%' }}>
                  <Input
                    prefix={<Search size={14} />}
                    placeholder="搜索表名 / schema"
                    value={tableFilter}
                    onChange={setTableFilter}
                    showClear
                    style={{ flex: 1 }}
                  />
                  <Tooltip content="刷新">
                    <Button icon={<RefreshCw size={14} />} onClick={() => void loadTables()} loading={tablesLoading} />
                  </Tooltip>
                </Space>
                <div style={{ marginTop: 6 }}>
                  <Text type="tertiary" size="small">{filteredTables.length} / {tables.length} 张表</Text>
                </div>
              </div>
              <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <List
                dataSource={filteredTables}
                loading={tablesLoading}
                emptyContent={<Empty title="无匹配的表" style={{ padding: 32 }} />}
                split={false}
                size="small"
                renderItem={(t) => {
                  const isActive = selected?.schema === t.schema && selected?.name === t.name;
                  return (
                    <List.Item
                      key={`${t.schema}.${t.name}`}
                      onClick={() => handleSelectTable(t)}
                      style={{
                        cursor: 'pointer',
                        padding: '8px 12px',
                        background: isActive ? 'var(--semi-color-primary-light-default)' : undefined,
                        borderBottom: '1px solid var(--semi-color-fill-0)',
                      }}
                      main={
                        <div style={{ minWidth: 0, width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <Text strong={isActive} ellipsis={{ showTooltip: true }} style={{ flex: 1, minWidth: 0 }}>
                              {t.schema !== 'public' && <Text type="tertiary" size="small">{t.schema}.</Text>}
                              {t.name}
                            </Text>
                            <Text type="tertiary" size="small">{t.sizeText}</Text>
                          </div>
                          {t.comment && (
                            <Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ display: 'block' }}>
                              {t.comment}
                            </Text>
                          )}
                        </div>
                      }
                    />
                  );
                }}
              />
              </div>
            </div>

            {/* 右侧详情 */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid var(--semi-color-border)', borderRadius: 6, overflow: 'hidden', minWidth: 0 }}>
              {selected ? (
                <>
                  <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--semi-color-border)' }}>
                    <Title heading={6} style={{ margin: 0 }}>
                      {selected.schema}.{selected.name}
                      <Text type="tertiary" size="small" style={{ marginLeft: 8 }}>
                        约 {selected.rowEstimate.toLocaleString()} 行 / {selected.sizeText}
                      </Text>
                    </Title>
                  </div>
                  <Tabs activeKey={innerTab} onChange={setInnerTab} type="line" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }} contentStyle={{ flex: 1, overflow: 'auto', padding: 12, minHeight: 0, minWidth: 0 }}>
                    <TabPane tab={`结构（${structure?.columns.length ?? 0}）`} itemKey="structure">
                      {structureLoading ? <Spin /> : structure && (
                        <ConfigurableTable<ColumnInfo>
                          bordered
                          columns={structureColumns}
                          dataSource={structure.columns}
                          rowKey="name"
                          pagination={false}
                          size="small"
                          scroll={{ x: 'max-content' }}
                        />
                      )}
                    </TabPane>
                    <TabPane tab="数据" itemKey="data">
                      {!rows && rowsLoading && <Spin />}
                      {rows && (
                        <div style={{ width: '100%' }}>
                          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text type="tertiary" size="small">
                              共 {rows.total.toLocaleString()} 行
                              {rowsOrderBy && (<>　·　排序：<Text code>{rowsOrderBy} {rowsOrderDir}</Text></>)}
                              {Object.keys(rowsFilters).length > 0 && (<>　·　筛选：<Text code>{Object.keys(rowsFilters).join(', ')}</Text></>)}
                            </Text>
                            {(rowsOrderBy || Object.keys(rowsFilters).length > 0) && (
                              <Button size="small" theme="borderless" onClick={handleRowsResetAll}>重置排序 / 筛选</Button>
                            )}
                          </div>
                          <ConfigurableTable
                            bordered
                            loading={rowsLoading}
                            columns={buildDataColumns(
                              rows.list[0]
                                ? Object.keys(rows.list[0]).map((n) => ({ name: n }))
                                : Object.keys(rowsFilters).map((n) => ({ name: n })),
                              { sortable: true, filterable: true },
                            )}
                            dataSource={rows.list.map((r, i) => ({ ...r, __key: i }))}
                            rowKey="__key"
                            pagination={false}
                            size="small"
                            scroll={{ x: 'max-content' }}
                            onChange={({ filters: columnFilters, sorter, extra }) => {
                              const changeType = extra?.changeType;
                              if (changeType === 'sorter') {
                                const s = sorter as { dataIndex?: string; sortOrder?: 'ascend' | 'descend' | false } | undefined;
                                if (!s?.dataIndex) return;
                                if (s.sortOrder === 'ascend') handleRowsSort(s.dataIndex, 'asc');
                                else if (s.sortOrder === 'descend') handleRowsSort(s.dataIndex, 'desc');
                                else handleRowsSort(s.dataIndex, undefined);
                              } else if (changeType === 'filter' && Array.isArray(columnFilters)) {
                                // 将 Table 传出的 per-column filteredValue 汇总为与后端交互的平坑结构
                                const next: Record<string, string> = {};
                                for (const f of columnFilters as Array<{ dataIndex?: string; filteredValue?: unknown[] }>) {
                                  if (!f.dataIndex) continue;
                                  const v = Array.isArray(f.filteredValue) && f.filteredValue.length > 0
                                    ? String(f.filteredValue[0]).trim()
                                    : '';
                                  if (v) next[f.dataIndex] = v;
                                }
                                setRowsFilters(next);
                                setRowsPage(1);
                                if (selected) void loadRows(selected, 1, rowsPageSize, rowsOrderBy, rowsOrderDir, next);
                              }
                            }}
                          />
                          <div style={{ marginTop: 12, textAlign: 'right' }}>
                            <Pagination
                              currentPage={rowsPage}
                              pageSize={rowsPageSize}
                              total={rows.total}
                              showSizeChanger
                              showQuickJumper
                              pageSizeOpts={[20, 50, 100, 200]}
                              onChange={handleRowsPageChange}
                            />
                          </div>
                        </div>
                      )}
                    </TabPane>
                    <TabPane tab={`索引（${structure?.indexes.length ?? 0}）`} itemKey="indexes">
                      {structureLoading && <Spin />}
                      {!structureLoading && structure?.indexes.length === 0 && <Empty title="无索引" />}
                      {!structureLoading && structure && structure.indexes.length > 0 && (
                        <ConfigurableTable<IndexInfo>
                          bordered
                          columns={indexColumns}
                          dataSource={structure.indexes}
                          rowKey="name"
                          pagination={false}
                          size="small"
                          scroll={{ x: 'max-content' }}
                        />
                      )}
                    </TabPane>
                    <TabPane tab={`外键（${structure?.foreignKeys.length ?? 0}）`} itemKey="foreignKeys">
                      {structureLoading && <Spin />}
                      {!structureLoading && structure?.foreignKeys.length === 0 && <Empty title="无外键" />}
                      {!structureLoading && structure && structure.foreignKeys.length > 0 && (
                        <ConfigurableTable<ForeignKeyInfo>
                          bordered
                          columns={fkColumns}
                          dataSource={structure.foreignKeys}
                          rowKey="name"
                          pagination={false}
                          size="small"
                          scroll={{ x: 'max-content' }}
                        />
                      )}
                    </TabPane>
                  </Tabs>
                </>
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Empty image={<Database size={48} />} title="请选择一张表" />
                </div>
              )}
            </div>
          </div>
        </TabPane>

        <TabPane tab={<span><Play size={14} style={{ verticalAlign: -2, marginRight: 4 }} />SQL 控制台</span>} itemKey="console">
          <Space vertical align="start" style={{ width: '100%' }}>
            <div style={{ width: '100%', border: '1px solid var(--semi-color-border)', borderRadius: 6, overflow: 'hidden' }}>
              <Editor
                height="240px"
                defaultLanguage="sql"
                theme={monacoTheme}
                value={sql}
                onChange={(v) => setSql(v ?? '')}
                onMount={(ed) => { editorRef.current = ed; }}
                options={{ minimap: { enabled: false }, fontSize: 13, automaticLayout: true, wordWrap: 'on' }}
              />
            </div>
            <Space>
              <Tooltip content="只读模式，仅允许 SELECT / EXPLAIN 等查询语句">
                <Button
                  type="primary"
                  icon={<Play size={14} />}
                  onClick={runQuery}
                  loading={queryLoading}
                  disabled={!canQuery}
                >执行</Button>
              </Tooltip>
              <Button icon={<Eye size={14} />} onClick={runExplain} disabled={!canQuery}>EXPLAIN</Button>
              <Button icon={<Download size={14} />} onClick={exportCsv} disabled={!canExport}>导出 CSV</Button>
              <Text type="tertiary" size="small">硬上限 5000 行 / 60 秒</Text>
            </Space>

            {queryError && <Text type="danger" style={{ whiteSpace: 'pre-wrap' }}>{queryError}</Text>}

            {queryResult && (
              <div style={{ width: '100%' }}>
                <Space style={{ marginBottom: 8 }}>
                  <Tag color="blue">{queryResult.rowCount} 行</Tag>
                  <Tag color="grey">{queryResult.durationMs}ms</Tag>
                  {queryResult.truncated && <Tag color="orange">已截断</Tag>}
                </Space>
                {queryResult.rows.length === 0 ? <Empty title="无结果" /> : (
                  <ConfigurableTable
                    bordered
                    columns={buildDataColumns(queryResult.columns)}
                    dataSource={queryResult.rows.map((r, i) => ({ ...r, __key: i }))}
                    rowKey="__key"
                    pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOpts: [20, 50, 100] }}
                    size="small"
                    scroll={{ x: 'max-content', y: 400 }}
                  />
                )}
              </div>
            )}
          </Space>
        </TabPane>

        <TabPane tab={<span><History size={14} style={{ verticalAlign: -2, marginRight: 4 }} />查询历史</span>} itemKey="history">
          <Space vertical align="start" style={{ width: '100%' }}>
            <Space>
              <Button icon={<RefreshCw size={14} />} onClick={() => void loadHistory(historyPage, historyPageSize)} loading={historyLoading}>刷新</Button>
              <Popconfirm title="确定清空所有历史？" onConfirm={clearHistory}>
                <Button type="danger" icon={<Trash2 size={14} />}>清空</Button>
              </Popconfirm>
            </Space>
            <ConfigurableTable<HistoryItem>
              bordered
              columns={historyColumns}
              dataSource={history}
              rowKey="id"
              loading={historyLoading}
              pagination={false}
              size="small"
              style={{ width: '100%' }}
            />
            <Pagination
              currentPage={historyPage}
              pageSize={historyPageSize}
              total={historyTotal}
              showSizeChanger
              showQuickJumper
              pageSizeOpts={[20, 50, 100]}
              onChange={(p, ps) => { setHistoryPage(p); setHistoryPageSize(ps); }}
            />
          </Space>
        </TabPane>
      </Tabs>

      <Modal
        title="查询计划 (EXPLAIN)"
        visible={explainOpen}
        onCancel={() => setExplainOpen(false)}
        footer={null}
        width={800}
      >
        <JsonViewer value={JSON.stringify(explainData, null, 2)} height={500} width="100%" />
      </Modal>
    </div>
  );
}
