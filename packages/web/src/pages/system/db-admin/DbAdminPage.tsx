import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Collapse,
  Dropdown,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
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
  Download,
  RefreshCw,
  History,
  Trash2,
  Copy,
  ArrowRight,
  Plus,
  Network,
  MoreHorizontal,
  Search,
  Gauge,
  Boxes,
  Server,
} from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import { useThemeController } from '@/providers/theme-controller';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import ConfigurableTable from '@/components/ConfigurableTable';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import { formatDateTime } from '@/utils/date';
import { RowEditModal } from './RowEditModal';
import { EditableCell } from './EditableCell';
import { ErDiagram, type ErSchema } from './ErDiagram';
import { buildInsertSql, buildUpdateSql, copyToClipboard, generateCreateTableDdl } from './sql-format';
import { OverviewPanel, KindTag } from './OverviewPanel';
import { SqlConsole, type SqlConsoleHandle } from './SqlConsole';
import { OpsPanel } from './OpsPanel';
import { ObjectsPanel } from './ObjectsPanel';

async function copyRowSqlAndToast(sql: string, label: string) {
  const ok = await copyToClipboard(sql);
  if (ok) Toast.success(`已复制 ${label}`);
  else Toast.warning('复制失败');
}

function renderRowSqlMenu(
  schema: string,
  table: string,
  pkCols: string[],
  record: Record<string, unknown>,
) {
  const cleanRow: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (!k.startsWith('__')) cleanRow[k] = v;
  }
  const pk: Record<string, unknown> = {};
  for (const k of pkCols) pk[k] = record[k];
  const insertSql = buildInsertSql(schema, table, cleanRow);
  const updateChanges: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cleanRow)) {
    if (!pkCols.includes(k)) updateChanges[k] = v;
  }
  const updateSql = buildUpdateSql(schema, table, pk, updateChanges);
  return (
    <Dropdown.Menu>
      <Dropdown.Item onClick={() => void copyRowSqlAndToast(insertSql, 'INSERT SQL')}>
        复制为 INSERT SQL
      </Dropdown.Item>
      <Dropdown.Item onClick={() => void copyRowSqlAndToast(updateSql, 'UPDATE SQL')}>
        复制为 UPDATE SQL
      </Dropdown.Item>
    </Dropdown.Menu>
  );
}

interface RenderEditableCellOptions {
  columnName: string;
  dataType?: string;
  schema: string;
  table: string;
  primaryKey: string[];
  readOnly: boolean;
  onCellSaved: (rowKey: unknown, columnName: string, newValue: unknown) => void;
}

function renderEditableCell(opts: RenderEditableCellOptions) {
  const Cell = (value: unknown, record: Record<string, unknown>) => (
    <EditableCell
      value={value}
      columnName={opts.columnName}
      dataType={opts.dataType}
      schema={opts.schema}
      table={opts.table}
      primaryKey={opts.primaryKey}
      record={record}
      readOnly={opts.readOnly}
      onSaved={(nv) => opts.onCellSaved(record.__key, opts.columnName, nv)}
    />
  );
  return Cell;
}

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
  const initialRaw = Array.isArray(tempFilteredValue) && tempFilteredValue.length > 0
    ? String(tempFilteredValue[0])
    : '';
  const parseInitial = (s: string): { op: string; value: string } => {
    const m = /^(eq|neq|gt|gte|lt|lte|like|ilike|isnull|notnull)\|(.*)$/s.exec(s);
    if (m) return { op: m[1], value: m[2] };
    return { op: 'ilike', value: s };
  };
  const initial = parseInitial(initialRaw);
  const needsValue = !['isnull', 'notnull'].includes(initial.op);
  const buildEncoded = (op: string, value: string): string => {
    if (op === 'isnull' || op === 'notnull') return `${op}|`;
    return `${op}|${value}`;
  };
  const apply = () => {
    const kw = initial.value.trim();
    const op = initial.op;
    if (op !== 'isnull' && op !== 'notnull' && kw.length === 0) {
      confirm({ filteredValue: [] });
      return;
    }
    confirm({ filteredValue: [buildEncoded(op, kw)] });
  };
  const reset = () => { clear(); close(); };
  const handleOpChange = (v: unknown) => {
    const op = String(v);
    if (op === 'isnull' || op === 'notnull') {
      setTempFilteredValue([buildEncoded(op, '')]);
    } else {
      setTempFilteredValue([buildEncoded(op, initial.value)]);
    }
  };
  const handleValueChange = (v: string) => {
    setTempFilteredValue([buildEncoded(initial.op, v)]);
  };
  return (
    <div style={{ padding: 8, width: 260 }}>
      <Space vertical align="start" style={{ width: '100%' }}>
        <Select
          size="small"
          value={initial.op}
          onChange={handleOpChange}
          style={{ width: '100%' }}
          optionList={[
            { label: '包含 (ILIKE)', value: 'ilike' },
            { label: '等于 =', value: 'eq' },
            { label: '不等于 ≠', value: 'neq' },
            { label: '大于 >', value: 'gt' },
            { label: '大于等于 ≥', value: 'gte' },
            { label: '小于 <', value: 'lt' },
            { label: '小于等于 ≤', value: 'lte' },
            { label: '为空 IS NULL', value: 'isnull' },
            { label: '非空 IS NOT NULL', value: 'notnull' },
          ]}
        />
        {needsValue && (
          <Input
            size="small"
            autoFocus
            value={initial.value}
            onChange={handleValueChange}
            onEnterPress={apply}
            placeholder={`筛选 ${columnName}……`}
          />
        )}
      </Space>
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
  kind: 'table' | 'view' | 'matview';
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

const SYSTEM_SCHEMAS = new Set(['pg_catalog', 'information_schema', 'pg_toast', 'drizzle']);
const SYSTEM_TABLES = new Set([
  'public.db_admin_query_history',
  'public.audit_logs',
  'public.__drizzle_migrations',
]);

export default function DbAdminPage() {
  const { hasPermission } = usePermission();
  const canQuery = hasPermission('system:db-admin:query');
  const canExport = hasPermission('system:db-admin:export');
  const canWrite = hasPermission('system:db-admin:write');
  const canMaintain = hasPermission('system:db-admin:maintain');
  const { isDark } = useThemeController();
  const monacoTheme = isDark ? 'vs-dark' : 'light';

  const [activeTab, setActiveTab] = useState<string>('overview');
  const sqlConsoleRef = useRef<SqlConsoleHandle | null>(null);

  // ER 图
  const [erSchema, setErSchema] = useState<ErSchema | null>(null);
  const [erLoading, setErLoading] = useState(false);

  // 表浏览
  const [tables, setTables] = useState<TableItem[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tableFilter, setTableFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'table' | 'view'>('all');
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
  const [rowsSearch, setRowsSearch] = useState('');
  const [rowsSearchInput, setRowsSearchInput] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<Array<string | number>>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);

  // 历史
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 行编辑 Modal
  const [rowModalOpen, setRowModalOpen] = useState(false);
  const [rowModalMode, setRowModalMode] = useState<'create' | 'edit'>('create');
  const [rowModalInitial, setRowModalInitial] = useState<Record<string, unknown> | undefined>(undefined);
  const [rowModalFocusField, setRowModalFocusField] = useState<string | undefined>(undefined);

  const filteredTables = useMemo(() => {
    const kw = tableFilter.trim().toLowerCase();
    return tables.filter((t) => {
      if (kindFilter === 'table' && t.kind !== 'table') return false;
      if (kindFilter === 'view' && t.kind === 'table') return false;
      if (!kw) return true;
      return `${t.schema}.${t.name}`.toLowerCase().includes(kw)
        || (t.comment ?? '').toLowerCase().includes(kw);
    });
  }, [tables, tableFilter, kindFilter]);

  const groupedTables = useMemo(() => {
    const map = new Map<string, TableItem[]>();
    for (const t of filteredTables) {
      const arr = map.get(t.schema) ?? [];
      arr.push(t);
      map.set(t.schema, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredTables]);

  // 列名缓存：用于 SQL 控制台自动补全；按需在 loadStructure 后追加，透传给 SqlConsole
  const structureColumnsCacheRef = useRef<Map<string, string[]>>(new Map());
  // 全列搜索关键字引用：在 loadRows 闭包中读最新值，避免逐处透传
  const rowsSearchRef = useRef('');

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
    if (res.code === 0 && res.data) {
      setStructure(res.data);
      structureColumnsCacheRef.current.set(
        `${item.schema}.${item.name}`,
        res.data.columns.map((c) => c.name),
      );
    }
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
    if (rowsSearchRef.current.trim()) {
      qs.set('search', rowsSearchRef.current.trim());
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

  const loadEr = useCallback(async () => {
    setErLoading(true);
    const res = await request.get<ErSchema>('/api/db-admin/er-schema');
    if (res.code === 0 && res.data) setErSchema(res.data);
    setErLoading(false);
  }, []);

  useEffect(() => { void loadTables(); }, [loadTables]);

  useEffect(() => {
    if (!selected) return;
    void loadStructure(selected);
    if (innerTab === 'data') {
      setRowsPage(1);
      void loadRows(selected, 1, rowsPageSize, rowsOrderBy, rowsOrderDir, rowsFilters);
    }
  }, [selected, innerTab, loadStructure, loadRows, rowsPageSize, rowsOrderBy, rowsOrderDir, rowsFilters]);

  useEffect(() => {
    if (activeTab === 'history') void loadHistory(historyPage, historyPageSize);
  }, [activeTab, historyPage, historyPageSize, loadHistory]);

  useEffect(() => {
    if (activeTab === 'er' && erSchema === null && !erLoading) void loadEr();
  }, [activeTab, erSchema, erLoading, loadEr]);

  const handleSelectTable = (item: TableItem) => {
    setSelected(item);
    setStructure(null);
    setRows(null);
    setRowsPage(1);
    setRowsOrderBy(undefined);
    setRowsOrderDir(undefined);
    setRowsFilters({});
    setRowsSearch('');
    setRowsSearchInput('');
    rowsSearchRef.current = '';
    setSelectedRowKeys([]);
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
    setRowsSearch('');
    setRowsSearchInput('');
    rowsSearchRef.current = '';
    setRowsPage(1);
    void loadRows(selected, 1, rowsPageSize, undefined, undefined, {});
  };

  const handleRunSearch = (kw: string) => {
    if (!selected) return;
    const trimmed = kw.trim();
    setRowsSearch(trimmed);
    rowsSearchRef.current = trimmed;
    setRowsPage(1);
    void loadRows(selected, 1, rowsPageSize, rowsOrderBy, rowsOrderDir, rowsFilters);
  };

  // ─── 表名右侧快捷操作 ─────────────────────────────────────────────────────
  const fullName = (t: TableItem) => (t.schema === 'public' ? t.name : `${t.schema}.${t.name}`);
  const copyToClipboard = async (text: string, msg: string) => {
    try { await navigator.clipboard.writeText(text); Toast.success(msg); }
    catch { Toast.error('复制失败'); }
  };
  const handleCopyName = (t: TableItem) => copyToClipboard(fullName(t), `已复制 ${fullName(t)}`);
  const handleCopySelect = (t: TableItem) =>
    copyToClipboard(`SELECT * FROM ${fullName(t)} LIMIT 50;`, '已复制 SELECT 语句');
  const handleOpenInConsole = (t: TableItem) => {
    setActiveTab('console');
    sqlConsoleRef.current?.loadSql(`SELECT * FROM ${fullName(t)} LIMIT 50;`, { newTab: true });
  };

  // ─── 表右键上下文菜单操作 ────────────────────────────────────────────────────
  const handleExportTableCsv = async (t: TableItem) => {
    if (!canExport) return;
    const token = localStorage.getItem(TOKEN_KEY);
    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/db-admin/tables/${encodeURIComponent(t.schema)}/${encodeURIComponent(t.name)}/export.csv`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        Toast.error((err as { message?: string })?.message ?? '导出失败');
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${t.schema}_${t.name}_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      Toast.success(`${fullName(t)} 导出成功`);
    } catch (err) {
      Toast.error('导出失败：' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleExportTableSql = async (t: TableItem, mode: 'ddl' | 'data' | 'full') => {
    if (!canExport) return;
    const token = localStorage.getItem(TOKEN_KEY);
    try {
      const res = await fetch(
        `${config.apiBaseUrl}/api/db-admin/tables/${encodeURIComponent(t.schema)}/${encodeURIComponent(t.name)}/export.sql?mode=${mode}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        Toast.error((err as { message?: string })?.message ?? '导出失败');
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const suffixMap: Record<string, string> = { ddl: 'ddl', data: 'data', full: 'full' };
      const suffix = suffixMap[mode] ?? 'full';
      a.download = `${t.schema}_${t.name}_${suffix}_${Date.now()}.sql`;
      a.click();
      URL.revokeObjectURL(a.href);
      Toast.success(`${fullName(t)} SQL 导出成功`);
    } catch (err) {
      Toast.error('导出失败：' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleCopyDdl = async (t: TableItem) => {
    let str: TableStructure | null =
      (selected?.schema === t.schema && selected?.name === t.name) ? structure : null;
    if (!str) {
      const res = await request.get<TableStructure>(
        `/api/db-admin/tables/${encodeURIComponent(t.schema)}/${encodeURIComponent(t.name)}/structure`,
      );
      if (res.code !== 0 || !res.data) { Toast.error('获取结构失败'); return; }
      str = res.data;
    }
    const ddl = generateCreateTableDdl(t.schema, t.name, str.columns, str.primaryKey);
    await copyToClipboard(ddl, '已复制 CREATE TABLE DDL');
  };

  const handleTruncateTable = async (t: TableItem) => {
    const res = await request.post(
      `/api/db-admin/tables/${encodeURIComponent(t.schema)}/${encodeURIComponent(t.name)}/truncate`,
      {},
    );
    if (res.code === 0) {
      Toast.success(`已截断 ${fullName(t)}`);
      if (selected?.schema === t.schema && selected?.name === t.name) refreshRows();
    } else {
      Toast.error(res.message ?? '截断失败');
    }
  };

  const handleRefreshMatview = async (t: TableItem) => {
    const res = await request.post(
      `/api/db-admin/tables/${encodeURIComponent(t.schema)}/${encodeURIComponent(t.name)}/refresh`,
      {},
    );
    if (res.code === 0) {
      Toast.success(`已刷新 ${fullName(t)}`);
      if (selected?.schema === t.schema && selected?.name === t.name) refreshRows();
    } else {
      Toast.error(res.message ?? '刷新失败');
    }
  };

  const renderTableContextMenu = (t: TableItem) => {
    const isWritable = t.kind === 'table' && !SYSTEM_SCHEMAS.has(t.schema) && !SYSTEM_TABLES.has(`${t.schema}.${t.name}`);
    return (
      <Dropdown.Menu>
        <Dropdown.Item onClick={() => { handleSelectTable(t); setInnerTab('structure'); }}>
          查看结构
        </Dropdown.Item>
        <Dropdown.Item onClick={() => { handleSelectTable(t); setInnerTab('data'); }}>
          查看数据
        </Dropdown.Item>
        <Dropdown.Item onClick={() => handleOpenInConsole(t)}>
          在控制台查询
        </Dropdown.Item>
        {t.kind === 'matview' && canMaintain && (
          <Dropdown.Item icon={<RefreshCw size={14} />} onClick={() => void handleRefreshMatview(t)}>
            刷新物化视图
          </Dropdown.Item>
        )}
        {canExport && (
          <>
            <Dropdown.Divider />
            <Dropdown.Item icon={<Download size={14} />} onClick={() => void handleExportTableCsv(t)}>
              导出数据 CSV
            </Dropdown.Item>
            <Dropdown.Item icon={<Download size={14} />} onClick={() => void handleExportTableSql(t, 'ddl')}>
              导出表结构 SQL
            </Dropdown.Item>
            <Dropdown.Item icon={<Download size={14} />} onClick={() => void handleExportTableSql(t, 'data')}>
              导出数据 SQL (INSERT)
            </Dropdown.Item>
            <Dropdown.Item icon={<Download size={14} />} onClick={() => void handleExportTableSql(t, 'full')}>
              导出完整 SQL (结构 + 数据)
            </Dropdown.Item>
          </>
        )}
        <Dropdown.Divider />
        <Dropdown.Item onClick={() => void handleCopyName(t)}>复制表名</Dropdown.Item>
        <Dropdown.Item onClick={() => void handleCopySelect(t)}>复制 SELECT *</Dropdown.Item>
        <Dropdown.Item
          onClick={() => void copyToClipboard(`SELECT COUNT(*) FROM ${fullName(t)};`, '已复制 COUNT 语句')}
        >
          复制 COUNT 语句
        </Dropdown.Item>
        <Dropdown.Item onClick={() => void handleCopyDdl(t)}>
          复制 CREATE TABLE DDL
        </Dropdown.Item>
        {canWrite && isWritable && (
          <>
            <Dropdown.Divider />
            <Dropdown.Item
              type="danger"
              onClick={() => {
                Modal.confirm({
                  title: `确定截断 ${fullName(t)} 吗？`,
                  content: '此操作将清空表内所有数据，且不可恢复！',
                  onOk: async () => { await handleTruncateTable(t); },
                });
              }}
            >
              截断表 (TRUNCATE)
            </Dropdown.Item>
          </>
        )}
      </Dropdown.Menu>
    );
  };

  // ─── 查询历史 ────────────────────────────────────────────────────────────────
  const applyHistorySql = (text: string) => {
    setActiveTab('console');
    sqlConsoleRef.current?.loadSql(text, { newTab: true });
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

  // ─── 表数据写入（INSERT / UPDATE / DELETE）─────────────────────────────────
  const isWritableTable = useMemo(() => {
    if (!selected) return false;
    if (selected.kind !== 'table') return false;
    if (SYSTEM_SCHEMAS.has(selected.schema)) return false;
    if (SYSTEM_TABLES.has(`${selected.schema}.${selected.name}`)) return false;
    return true;
  }, [selected]);
  const hasPrimaryKey = (structure?.primaryKey.length ?? 0) > 0;

  const refreshRows = useCallback(() => {
    if (!selected) return;
    setSelectedRowKeys([]);
    void loadRows(selected, rowsPage, rowsPageSize, rowsOrderBy, rowsOrderDir, rowsFilters);
  }, [selected, rowsPage, rowsPageSize, rowsOrderBy, rowsOrderDir, rowsFilters, loadRows]);

  const handleBatchDelete = useCallback(async () => {
    if (!selected || !structure || structure.primaryKey.length === 0 || !rows) return;
    const pkCols = structure.primaryKey;
    const targets = selectedRowKeys
      .map((k) => rows.list[Number(k)])
      .filter((r): r is Record<string, unknown> => Boolean(r));
    if (targets.length === 0) return;
    setBatchDeleting(true);
    let ok = 0;
    let fail = 0;
    for (const row of targets) {
      const pk: Record<string, unknown> = {};
      for (const k of pkCols) pk[k] = row[k];
      const res = await request.delete<{ deleted: number }>(
        `/api/db-admin/tables/${encodeURIComponent(selected.schema)}/${encodeURIComponent(selected.name)}/rows`,
        { pk },
      );
      if (res.code === 0) ok++;
      else fail++;
    }
    setBatchDeleting(false);
    setSelectedRowKeys([]);
    if (fail === 0) Toast.success(`已删除 ${ok} 行`);
    else Toast.warning(`删除完成：成功 ${ok}，失败 ${fail}`);
    if (selected) void loadRows(selected, rowsPage, rowsPageSize, rowsOrderBy, rowsOrderDir, rowsFilters);
  }, [selected, structure, rows, selectedRowKeys, rowsPage, rowsPageSize, rowsOrderBy, rowsOrderDir, rowsFilters, loadRows]);

  const selectedRowsData = useCallback((): Array<Record<string, unknown>> => {
    if (!rows) return [];
    return selectedRowKeys
      .map((k) => rows.list[Number(k)])
      .filter((r): r is Record<string, unknown> => Boolean(r));
  }, [rows, selectedRowKeys]);

  const handleBatchCopyInsert = useCallback(async () => {
    if (!selected) return;
    const targets = selectedRowsData();
    if (targets.length === 0) return;
    const sqls = targets.map((row) => {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) if (!k.startsWith('__')) clean[k] = v;
      return buildInsertSql(selected.schema, selected.name, clean);
    });
    void copyToClipboard(sqls.join('\n'), `已复制 ${targets.length} 条 INSERT SQL`);
  }, [selected, selectedRowsData]);

  const handleBatchCopyUpdate = useCallback(async () => {
    if (!selected || !structure || structure.primaryKey.length === 0) return;
    const pkCols = structure.primaryKey;
    const targets = selectedRowsData();
    if (targets.length === 0) return;
    const sqls = targets.map((row) => {
      const pk: Record<string, unknown> = {};
      for (const k of pkCols) pk[k] = row[k];
      const changes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (k.startsWith('__')) continue;
        if (pkCols.includes(k)) continue;
        changes[k] = v;
      }
      return buildUpdateSql(selected.schema, selected.name, pk, changes);
    });
    void copyToClipboard(sqls.join('\n'), `已复制 ${targets.length} 条 UPDATE SQL`);
  }, [selected, structure, selectedRowsData]);

  const openCreateRow = () => {
    setRowModalMode('create');
    setRowModalInitial(undefined);
    setRowModalFocusField(undefined);
    setRowModalOpen(true);
  };

  const openEditRow = (row: Record<string, unknown>, focusField?: string) => {
    setRowModalMode('edit');
    setRowModalInitial(row);
    setRowModalFocusField(focusField);
    setRowModalOpen(true);
  };

  const handleDeleteRow = async (row: Record<string, unknown>) => {
    if (!selected || !structure || structure.primaryKey.length === 0) return;
    const pk: Record<string, unknown> = {};
    for (const k of structure.primaryKey) pk[k] = row[k];
    const res = await request.delete<{ deleted: number }>(
      `/api/db-admin/tables/${encodeURIComponent(selected.schema)}/${encodeURIComponent(selected.name)}/rows`,
      { pk },
    );
    if (res.code === 0) {
      Toast.success('已删除');
      refreshRows();
    }
  };

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

  const resolveDataCols = (
    str: TableStructure | null,
    list: Array<Record<string, unknown>>,
    filterKeys: string[],
  ): Array<{ name: string; dataType?: string }> => {
    if (str?.columns && str.columns.length > 0) {
      return str.columns.map((c) => ({ name: c.name, dataType: c.dataType }));
    }
    if (list[0]) return Object.keys(list[0]).map((n) => ({ name: n }));
    return filterKeys.map((n) => ({ name: n }));
  };

  const handleCellSaved = useCallback(
    (rowKey: unknown, columnName: string, newValue: unknown) => {
      setRows((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          list: prev.list.map((r, i) => (i === rowKey ? { ...r, [columnName]: newValue } : r)),
        };
      });
    },
    [],
  );

  const makeOnCellDblClick = (colName: string) => (record?: Record<string, unknown>) => ({
    onDoubleClick: () => { if (record) openEditRow(record, colName); },
    style: { cursor: 'pointer' as const },
  });

  const handleFkJump = useCallback((fk: ForeignKeyInfo, value?: unknown) => {
    const target = tables.find((t) => t.schema === fk.referencedSchema && t.name === fk.referencedTable);
    if (!target) {
      Toast.warning(`未找到引用表 ${fk.referencedSchema}.${fk.referencedTable}`);
      return;
    }
    setSelected(target);
    setStructure(null);
    setRows(null);
    setRowsPage(1);
    setRowsOrderBy(undefined);
    setRowsOrderDir(undefined);
    if (value != null && fk.referencedColumns.length === 1) {
      let strVal: string;
      if (typeof value === 'string') strVal = value;
      else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') strVal = value.toString();
      else strVal = JSON.stringify(value);
      setRowsFilters({ [fk.referencedColumns[0]]: strVal });
    } else {
      setRowsFilters({});
    }
    setSelectedRowKeys([]);
    setInnerTab('data');
  }, [tables]);

  const buildDataColumns = (
    cols: Array<{ name: string; dataType?: string }>,
    options?: {
      sortable?: boolean;
      filterable?: boolean;
      editable?: { primaryKey: string[]; canWriteRow: boolean; schema?: string; table?: string };
    },
  ): ColumnProps<Record<string, unknown>>[] => {
    const sortable = options?.sortable ?? false;
    const filterable = options?.filterable ?? false;
    const editable = options?.editable;
    const fkByColumn = new Map<string, ForeignKeyInfo>();
    if (structure?.foreignKeys) {
      for (const fk of structure.foreignKeys) {
        if (fk.columns.length === 1) fkByColumn.set(fk.columns[0], fk);
      }
    }
    const inlineEnabled = Boolean(
      editable?.canWriteRow
      && editable.primaryKey.length > 0
      && editable.schema
      && editable.table,
    );
    const result: ColumnProps<Record<string, unknown>>[] = cols.map((c) => {
      const fk = fkByColumn.get(c.name);
      const titleNode = (
        <Space spacing={4}>
          <Text>{c.name}</Text>
          {c.dataType && <Text type="tertiary" size="small">{c.dataType}</Text>}
          {fk && (
            <Tooltip content={`外键 → ${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumns.join(',')}`}>
              <Tag size="small" color="blue" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); handleFkJump(fk); }}>FK</Tag>
            </Tooltip>
          )}
        </Space>
      );
      const col: ColumnProps<Record<string, unknown>> = {
        title: titleNode,
        dataIndex: c.name,
        key: c.name,
        width: 180,
        ellipsis: { showTitle: false },
        render: renderCell,
      };
      if (inlineEnabled && editable) {
        const isPk = editable.primaryKey.includes(c.name);
        col.render = renderEditableCell({
          columnName: c.name,
          dataType: c.dataType,
          schema: editable.schema!,
          table: editable.table!,
          primaryKey: editable.primaryKey,
          readOnly: isPk,
          onCellSaved: handleCellSaved,
        });
      } else if (editable?.canWriteRow) {
        col.onCell = makeOnCellDblClick(c.name);
      }
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
    if (editable?.canWriteRow && editable.primaryKey.length > 0) {
      const schemaName = editable.schema;
      const tableName = editable.table;
      const pkCols = editable.primaryKey;
      result.push({
        title: '操作',
        key: '__actions',
        width: 180,
        fixed: 'right',
        render: (_, record) => (
          <Space>
            <Button theme="borderless" size="small" onClick={() => openEditRow(record)}>编辑</Button>
            <Popconfirm
              title="确定要删除该行吗？"
              content="此操作不可恢复"
              onConfirm={() => handleDeleteRow(record)}
            >
              <Button theme="borderless" type="danger" size="small">删除</Button>
            </Popconfirm>
            {schemaName && tableName && (
              <Dropdown
                trigger="click"
                position="bottomRight"
                render={renderRowSqlMenu(schemaName, tableName, pkCols, record)}
              >
                <Button theme="borderless" size="small">SQL</Button>
              </Dropdown>
            )}
          </Space>
        ),
      });
    }
    return result;
  };

  const historyColumns: ColumnProps<HistoryItem>[] = [
    { title: '时间', dataIndex: 'executedAt', width: 180, render: (v: string) => formatDateTime(v) },
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
    <div style={{ padding: 16, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        type="line"
        lazyRender={false}
        className="tabs-fill-height"
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        contentStyle={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        tabBarStyle={{
          marginBottom: 8,
        }}
      >
        <TabPane tab={<span><Gauge size={14} style={{ verticalAlign: -2, marginRight: 4 }} />总览</span>} itemKey="overview" style={{ height: '100%' }}>
          <OverviewPanel
            onSelectTable={(s, n) => {
              const t = tables.find((x) => x.schema === s && x.name === n);
              if (t) { setActiveTab('browse'); handleSelectTable(t); setInnerTab('data'); }
            }}
          />
        </TabPane>

        <TabPane tab={<span><TableIcon size={14} style={{ verticalAlign: -2, marginRight: 4 }} />表浏览</span>} itemKey="browse" style={{ height: '100%' }}>
          <div style={{ height: '100%' }}>
            <MasterDetailLayout
              defaultSize={320}
              minSize={240}
              maxSize={520}
              persistKey="db-admin-browse"
              showDetail={selected !== null}
              onBack={() => setSelected(null)}
              master={(
                <NavListPanel
                  title="数据库表"
                  headerExtra={
                    <Space spacing={4}>
                      <Select
                        size="small"
                        value={kindFilter}
                        onChange={(v) => setKindFilter(v as 'all' | 'table' | 'view')}
                        style={{ width: 96 }}
                        optionList={[
                          { label: '全部', value: 'all' },
                          { label: '表', value: 'table' },
                          { label: '视图', value: 'view' },
                        ]}
                      />
                      <Tooltip content="刷新">
                        <Button icon={<RefreshCw size={14} />} onClick={() => void loadTables()} loading={tablesLoading} size="small" theme="borderless" />
                      </Tooltip>
                    </Space>
                  }
                  search={{
                    value: tableFilter,
                    onChange: setTableFilter,
                    placeholder: '搜索表名 / schema',
                  }}
                  loading={tablesLoading && tables.length === 0}
                  emptyText="无匹配的表"
                  bodyNoPadding
                  rawBody
                >
                  {filteredTables.length > 0 && (
                    <Collapse
                      className="db-admin-schema-collapse"
                      expandIconPosition="left"
                      defaultActiveKey={groupedTables.map(([s]) => s)}
                      keepDOM={false}
                    >
                      {groupedTables.map(([schema, list]) => (
                        <Collapse.Panel
                          key={schema}
                          itemKey={schema}
                          header={
                            <Space>
                              <Text strong>{schema}</Text>
                              <Text type="tertiary" size="small">{list.length} 张表</Text>
                            </Space>
                          }
                        >
                          <List split={false} className="nav-list-panel__list" style={{ padding: '0 8px 8px' }}>
                            {list.map((t: TableItem) => {
                              const isActive = selected?.schema === t.schema && selected?.name === t.name;
                              return (
                                <NavListItem
                                  key={`${t.schema}.${t.name}`}
                                  active={isActive}
                                  onClick={() => handleSelectTable(t)}
                                  primary={t.name}
                                  secondary={t.kind === 'table'
                                    ? t.sizeText
                                    : `${t.kind === 'view' ? '视图' : '物化视图'} · ${t.sizeText}`}
                                  extra={
                                    <Dropdown
                                      trigger="click"
                                      position="bottomLeft"
                                      render={renderTableContextMenu(t)}
                                      getPopupContainer={() => document.body}
                                      clickToHide
                                      stopPropagation
                                    >
                                      <Button
                                        size="small"
                                        theme="borderless"
                                        icon={<MoreHorizontal size={14} />}
                                        onClick={(e) => { e.stopPropagation(); }}
                                        style={{ padding: '0 2px', minWidth: 24, height: 22 }}
                                      />
                                    </Dropdown>
                                  }
                                />
                              );
                            })}
                          </List>
                        </Collapse.Panel>
                      ))}
                    </Collapse>
                  )}
                  {!tablesLoading && filteredTables.length === 0 && tables.length > 0 && (
                    <Empty title="无匹配的表" style={{ padding: 32 }} />
                  )}
                </NavListPanel>
              )}
              detail={(
                <>
              {selected ? (
                <>
                  <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <Title heading={6} style={{ margin: 0, minWidth: 0, flex: 1 }} ellipsis={{ showTooltip: true }}>
                      <KindTag kind={selected.kind} />
                      <span style={{ marginLeft: 6 }}>{selected.schema}.{selected.name}</span>
                      {selected.comment && (
                        <Text type="tertiary" size="small" style={{ marginLeft: 8 }}>
                          {selected.comment}
                        </Text>
                      )}
                      <Text type="tertiary" size="small" style={{ marginLeft: 8 }}>
                        约 {selected.rowEstimate.toLocaleString()} 行 / {selected.sizeText}
                      </Text>
                    </Title>
                    <Space spacing={4} style={{ flexShrink: 0 }}>
                      <Tooltip content="复制表名">
                        <Button size="small" theme="borderless" icon={<Copy size={14} />} onClick={() => handleCopyName(selected)} />
                      </Tooltip>
                      <Tooltip content="复制 SELECT 语句">
                        <Button size="small" theme="borderless" onClick={() => handleCopySelect(selected)}>SELECT</Button>
                      </Tooltip>
                      <Tooltip content="在 SQL 控制台中查询">
                        <Button size="small" theme="borderless" icon={<ArrowRight size={14} />} onClick={() => handleOpenInConsole(selected)}>查询</Button>
                      </Tooltip>
                    </Space>
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
                          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <Text type="tertiary" size="small">
                              共 {rows.total.toLocaleString()} 行
                              {rowsOrderBy && (<> · 排序：<Text code>{rowsOrderBy} {rowsOrderDir}</Text></>)}
                              {Object.keys(rowsFilters).length > 0 && (<> · 筛选：<Text code>{Object.keys(rowsFilters).join(', ')}</Text></>)}
                              {rowsSearch && (<> · 搜索：<Text code>{rowsSearch}</Text></>)}
                              {!hasPrimaryKey && isWritableTable && (
                                <> · <Text type="warning">无主键，仅可插入与查看</Text></>
                              )}
                              {!isWritableTable && (
                                <> · <Text type="tertiary">系统表只读</Text></>
                              )}
                            </Text>
                            <Space wrap>
                              <Input
                                size="small"
                                prefix={<Search size={14} />}
                                placeholder="全列搜索…"
                                value={rowsSearchInput}
                                onChange={setRowsSearchInput}
                                onEnterPress={() => handleRunSearch(rowsSearchInput)}
                                showClear
                                onClear={() => { setRowsSearchInput(''); handleRunSearch(''); }}
                                style={{ width: 200 }}
                              />
                              <Button size="small" onClick={() => handleRunSearch(rowsSearchInput)}>搜索</Button>
                              {canWrite && isWritableTable && (
                                <Button
                                  size="small"
                                  theme="solid"
                                  type="primary"
                                  icon={<Plus size={14} />}
                                  onClick={openCreateRow}
                                  disabled={!structure}
                                >新增行</Button>
                              )}
                              {(rowsOrderBy || Object.keys(rowsFilters).length > 0 || rowsSearch) && (
                                <Button size="small" theme="borderless" onClick={handleRowsResetAll}>重置排序 / 筛选</Button>
                              )}
                            </Space>
                          </div>
                          {selectedRowKeys.length > 0 && (
                            <div style={{ marginBottom: 8, padding: '6px 12px', background: 'var(--semi-color-fill-0)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <Text size="small">已选 <Text strong>{selectedRowKeys.length}</Text> 行</Text>
                              <Space>
                                {hasPrimaryKey && isWritableTable && canWrite && (
                                  <Popconfirm
                                    title={`确认删除选中的 ${selectedRowKeys.length} 行？`}
                                    onConfirm={() => void handleBatchDelete()}
                                  >
                                    <Button size="small" type="danger" theme="solid" loading={batchDeleting} icon={<Trash2 size={14} />}>批量删除</Button>
                                  </Popconfirm>
                                )}
                                <Button size="small" icon={<Copy size={14} />} onClick={() => void handleBatchCopyInsert()}>复制为 INSERT SQL</Button>
                                {hasPrimaryKey && (
                                  <Button size="small" icon={<Copy size={14} />} onClick={() => void handleBatchCopyUpdate()}>复制为 UPDATE SQL</Button>
                                )}
                                <Button size="small" theme="borderless" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
                              </Space>
                            </div>
                          )}
                          <ConfigurableTable
                            bordered
                            loading={rowsLoading}
                            columnSettings
                            columnSettingsKey={selected ? `db-admin:cols:${selected.schema}.${selected.name}` : undefined}
                            columns={buildDataColumns(
                              resolveDataCols(structure, rows.list, Object.keys(rowsFilters)),
                              {
                                sortable: true,
                                filterable: true,
                                editable: canWrite && isWritableTable && selected
                                  ? {
                                      primaryKey: structure?.primaryKey ?? [],
                                      canWriteRow: hasPrimaryKey,
                                      schema: selected.schema,
                                      table: selected.name,
                                    }
                                  : undefined,
                              },
                            )}
                            dataSource={rows.list.map((r, i) => ({ ...r, __key: i }))}
                            rowKey="__key"
                            rowSelection={hasPrimaryKey ? {
                              selectedRowKeys,
                              onChange: (keys?: Array<string | number>) => setSelectedRowKeys(keys ?? []),
                              fixed: true,
                            } : undefined}
                            pagination={{
                              currentPage: rowsPage,
                              pageSize: rowsPageSize,
                              total: rows.total,
                              pageSizeOpts: [20, 50, 100, 200],
                              onPageChange: (p) => {
                                setRowsPage(p);
                                if (selected) void loadRows(selected, p, rowsPageSize, rowsOrderBy, rowsOrderDir, rowsFilters);
                              },
                              onPageSizeChange: (size) => {
                                setRowsPageSize(size);
                                setRowsPage(1);
                                if (selected) void loadRows(selected, 1, size, rowsOrderBy, rowsOrderDir, rowsFilters);
                              },
                            }}
                            size="small"
                            scroll={{ x: 'max-content' }}
                            resizable
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
                </>
              )}
            />
          </div>
        </TabPane>

        <TabPane tab={<span><Boxes size={14} style={{ verticalAlign: -2, marginRight: 4 }} />对象</span>} itemKey="objects" style={{ height: '100%' }}>
          <ObjectsPanel active={activeTab === 'objects'} />
        </TabPane>

        <TabPane tab={<span><Play size={14} style={{ verticalAlign: -2, marginRight: 4 }} />SQL 控制台</span>} itemKey="console" style={{ height: '100%' }}>
          <div style={{ height: '100%', padding: 4 }}>
            <SqlConsole
              ref={sqlConsoleRef}
              tables={tables}
              structureColumnsCache={structureColumnsCacheRef}
              canQuery={canQuery}
              canExport={canExport}
              monacoTheme={monacoTheme}
            />
          </div>
        </TabPane>

        <TabPane tab={<span><Server size={14} style={{ verticalAlign: -2, marginRight: 4 }} />运维</span>} itemKey="ops" style={{ height: '100%' }}>
          <OpsPanel canMaintain={canMaintain} active={activeTab === 'ops'} />
        </TabPane>

        <TabPane tab={<span><History size={14} style={{ verticalAlign: -2, marginRight: 4 }} />查询历史</span>} itemKey="history" style={{ height: '100%', overflow: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
              size="small"
              scroll={{ x: 1000 }}
              pagination={{
                currentPage: historyPage,
                pageSize: historyPageSize,
                total: historyTotal,
                onPageChange: (p) => { setHistoryPage(p); void loadHistory(p, historyPageSize); },
                onPageSizeChange: (size) => { setHistoryPageSize(size); setHistoryPage(1); void loadHistory(1, size); },
              }}
            />
          </div>
        </TabPane>

        <TabPane tab={<span><Network size={14} style={{ verticalAlign: -2, marginRight: 4 }} />ER 图</span>} itemKey="er">
          <Space vertical align="start" style={{ width: '100%' }}>
            <Space>
              <Button icon={<RefreshCw size={14} />} onClick={() => void loadEr()} loading={erLoading}>刷新</Button>
              <Text type="tertiary" size="small">
                {erSchema ? `共 ${erSchema.tables.length} 张表，${erSchema.foreignKeys.length} 条外键关系` : ''}
              </Text>
            </Space>
            {(() => {
              if (erLoading && !erSchema) return <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>;
              if (!erSchema) return <Empty title="暂无数据" />;
              if (erSchema.tables.length === 0) return <Empty title="数据库内没有用户表" />;
              return (
                <ErDiagram
                  schema={erSchema}
                  onNodeDoubleClick={(full) => {
                    const [s, n] = full.split('.');
                    const t = tables.find((x) => x.schema === s && x.name === n);
                    if (t) {
                      setActiveTab('browse');
                      handleSelectTable(t);
                    }
                  }}
                />
              );
            })()}
          </Space>
        </TabPane>
      </Tabs>

      {selected && structure && (
        <RowEditModal
          open={rowModalOpen}
          mode={rowModalMode}
          schema={selected.schema}
          table={selected.name}
          columns={structure.columns}
          primaryKey={structure.primaryKey}
          initial={rowModalInitial}
          focusField={rowModalFocusField}
          onClose={() => setRowModalOpen(false)}
          onSuccess={() => {
            setRowModalOpen(false);
            Toast.success(rowModalMode === 'create' ? '已插入新行' : '已更新');
            refreshRows();
          }}
        />
      )}
    </div>
  );
}
