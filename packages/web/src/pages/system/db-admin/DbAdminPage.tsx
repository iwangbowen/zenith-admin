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
  Upload,
} from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import { useThemeController } from '@/providers/theme-controller';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import { formatDateTime } from '@/utils/date';
import { RowEditModal } from './RowEditModal';
import { ErDiagram, type ErSchema } from './ErDiagram';
import MonacoEditor from '@monaco-editor/react';
import { buildDeleteSql, buildInsertSql, buildUpdateSql, generateCreateTableDdl } from './sql-format';
import { OverviewPanel, KindTag } from './OverviewPanel';
import { SqlConsole, type SqlConsoleHandle } from './SqlConsole';
import { OpsPanel } from './OpsPanel';
import { ObjectsPanel } from './ObjectsPanel';
import { ImportModal } from './ImportModal';
import {
  DataGrid,
  CellDetailDrawer,
  type CellPos,
  type DataGridColumn,
  type DataGridHandle,
} from '@/components/data-grid';
import { useTableRowsInfinite } from './useTableRowsInfinite';
import { ColumnFilterButton } from './ColumnFilterButton';
import { GridContextMenu, type GridMenuState } from './GridContextMenu';
import './db-admin.css';

const { Title, Text } = Typography;


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
  enumValues?: string[] | null;
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
  const [rowsOrderBy, setRowsOrderBy] = useState<string | undefined>(undefined);
  const [rowsOrderDir, setRowsOrderDir] = useState<'asc' | 'desc' | undefined>(undefined);
  const [rowsFilters, setRowsFilters] = useState<Record<string, string>>({});
  const [rowsSearch, setRowsSearch] = useState('');
  const [rowsSearchInput, setRowsSearchInput] = useState('');
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<Set<number>>(new Set());
  // 数据网格
  const gridRef = useRef<DataGridHandle | null>(null);
  const [gridMenu, setGridMenu] = useState<GridMenuState | null>(null);
  const [detailState, setDetailState] = useState<{ rowIndex: number; columnName: string | null } | null>(null);
  // 内联编辑暂存
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingSaving, setPendingSaving] = useState(false);
  const [sqlPreview, setSqlPreview] = useState<string | null>(null);

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
  const [importOpen, setImportOpen] = useState(false);

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

  // 表数据：无限滚动加载（滚动近底自动取下一批）
  const rowsData = useTableRowsInfinite({
    schema: selected?.schema,
    table: selected?.name,
    enabled: innerTab === 'data' && selected !== null,
    orderBy: rowsOrderBy,
    orderDir: rowsOrderDir,
    filters: rowsFilters,
    search: rowsSearch,
  });

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
  }, [selected, loadStructure]);

  useEffect(() => {
    if (activeTab === 'history') void loadHistory(historyPage, historyPageSize);
  }, [activeTab, historyPage, historyPageSize, loadHistory]);

  useEffect(() => {
    if (activeTab === 'er' && erSchema === null && !erLoading) void loadEr();
  }, [activeTab, erSchema, erLoading, loadEr]);

  const handleSelectTable = (item: TableItem) => {
    const doSelect = () => {
      setSelected(item);
      setStructure(null);
      setRowsOrderBy(undefined);
      setRowsOrderDir(undefined);
      setRowsFilters({});
      setRowsSearch('');
      setRowsSearchInput('');
      setSelectedRowIndexes(new Set());
      setPendingCount(0);
      gridRef.current?.discardPending();
      gridRef.current?.clearSelection();
    };
    if (pendingCount > 0 && selected && (selected.schema !== item.schema || selected.name !== item.name)) {
      Modal.confirm({
        title: '有未保存的修改',
        content: `当前表有 ${pendingCount} 处暂存修改，切换表将全部放弃，确定继续？`,
        okButtonProps: { type: 'danger', theme: 'solid' },
        onOk: doSelect,
      });
      return;
    }
    doSelect();
  };

  const handleRowsSort = (col: string, dir: 'asc' | 'desc' | undefined) => {
    setRowsOrderBy(dir ? col : undefined);
    setRowsOrderDir(dir);
  };

  const handleRowsResetAll = () => {
    setRowsOrderBy(undefined);
    setRowsOrderDir(undefined);
    setRowsFilters({});
    setRowsSearch('');
    setRowsSearchInput('');
  };

  const handleRunSearch = (kw: string) => {
    setRowsSearch(kw.trim());
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
    setSelectedRowIndexes(new Set());
    gridRef.current?.clearSelection();
    void rowsData.refresh();
  }, [rowsData]);

  const handleBatchDelete = useCallback(() => {
    // 暂存删除标记（红色删除线），随「保存」统一事务提交
    gridRef.current?.stageDeleteRows(Array.from(selectedRowIndexes));
    setSelectedRowIndexes(new Set());
  }, [selectedRowIndexes]);

  const selectedRowsData = useCallback((): Array<Record<string, unknown>> => {
    return Array.from(selectedRowIndexes)
      .sort((a, b) => a - b)
      .map((i) => rowsData.rows[i])
      .filter((r): r is Record<string, unknown> => Boolean(r));
  }, [rowsData.rows, selectedRowIndexes]);

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

  const handleFkJump = useCallback((fk: ForeignKeyInfo, value?: unknown) => {
    const target = tables.find((t) => t.schema === fk.referencedSchema && t.name === fk.referencedTable);
    if (!target) {
      Toast.warning(`未找到引用表 ${fk.referencedSchema}.${fk.referencedTable}`);
      return;
    }
    setSelected(target);
    setStructure(null);
    setRowsOrderBy(undefined);
    setRowsOrderDir(undefined);
    if (value != null && fk.referencedColumns.length === 1) {
      let strVal: string;
      if (typeof value === 'string') strVal = value;
      else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') strVal = value.toString();
      else strVal = JSON.stringify(value);
      setRowsFilters({ [fk.referencedColumns[0]]: `eq|${strVal}` });
    } else {
      setRowsFilters({});
    }
    setSelectedRowIndexes(new Set());
    setInnerTab('data');
  }, [tables]);

  // ─── 数据网格接线 ────────────────────────────────────────────────────────────
  const canEditRows = canWrite && isWritableTable && hasPrimaryKey;

  /** 不可编辑的具体原因（结构加载完成后才判定，避免误报） */
  const readOnlyReason = useMemo<string | null>(() => {
    if (!selected) return null;
    if (!canWrite) return '无编辑权限（system:db-admin:write）';
    if (selected.kind === 'view') return '视图只读';
    if (selected.kind === 'matview') return '物化视图只读';
    if (!isWritableTable) return '系统表只读';
    if (structure && structure.primaryKey.length === 0) return '无主键，无法定位行，仅可插入与查看';
    return null;
  }, [selected, canWrite, isWritableTable, structure]);

  const gridColumns = useMemo<DataGridColumn[]>(() => {
    const fkByColumn = new Map<string, ForeignKeyInfo>();
    if (structure?.foreignKeys) {
      for (const fk of structure.foreignKeys) {
        if (fk.columns.length === 1) fkByColumn.set(fk.columns[0], fk);
      }
    }
    const base = resolveDataCols(structure, rowsData.rows, Object.keys(rowsFilters));
    return base.map((c) => {
      const info = structure?.columns.find((sc) => sc.name === c.name);
      const fk = fkByColumn.get(c.name);
      const isPk = structure?.primaryKey.includes(c.name) ?? false;
      return {
        name: c.name,
        dataType: c.dataType,
        isPrimaryKey: isPk,
        pinned: isPk,
        nullable: info?.isNullable,
        comment: info?.comment ?? null,
        enumValues: info?.enumValues ?? null,
        fk: fk
          ? { schema: fk.referencedSchema, table: fk.referencedTable, columns: fk.referencedColumns }
          : null,
      };
    });
  }, [structure, rowsData.rows, rowsFilters]);

  const handleGridFilterChange = useCallback((column: string, encoded: string | null) => {
    setRowsFilters((prev) => {
      const next = { ...prev };
      if (encoded === null || encoded.length === 0) delete next[column];
      else next[column] = encoded;
      return next;
    });
  }, []);

  const handleGridFkClick = useCallback((columnName: string, value: unknown) => {
    const fk = structure?.foreignKeys.find((f) => f.columns.length === 1 && f.columns[0] === columnName);
    if (fk) handleFkJump(fk, value);
  }, [structure, handleFkJump]);

  const handleGridOpenDetail = useCallback((pos: CellPos) => {
    const cols = gridRef.current?.getVisibleColumns();
    setDetailState({ rowIndex: pos.row, columnName: cols?.[pos.col]?.name ?? null });
  }, []);

  const handleGridDoubleClick = useCallback((rowIndex: number, columnName: string) => {
    // 可编辑列的双击已由 DataGrid 内联编辑消费；此处兜底打开详情（只读列 / 主键列）
    setDetailState({ rowIndex, columnName });
  }, []);

  // ─── 内联编辑：保存 / 预览 / 放弃 ────────────────────────────────────────────
  const [pendingCounts, setPendingCounts] = useState({ modified: 0, added: 0, deleted: 0, total: 0 });

  const handleCountsChange = useCallback((counts: { modified: number; added: number; deleted: number; total: number }) => {
    setPendingCounts(counts);
    setPendingCount(counts.total);
  }, []);

  const handleSavePending = useCallback(async () => {
    if (!selected) return;
    const m = gridRef.current?.getMutations();
    if (!m || (m.inserts.length + m.updates.length + m.deletes.length === 0)) return;
    setPendingSaving(true);
    const res = await request.post<{ inserted: number; updated: number; deleted: number }>(
      `/api/db-admin/tables/${encodeURIComponent(selected.schema)}/${encodeURIComponent(selected.name)}/batch-mutate`,
      {
        inserts: m.inserts.length > 0 ? m.inserts : undefined,
        updates: m.updates.length > 0 ? m.updates.map(({ pk, changes }) => ({ pk, changes })) : undefined,
        deletes: m.deletes.length > 0 ? m.deletes : undefined,
      },
    );
    setPendingSaving(false);
    if (res.code === 0) {
      const d = res.data;
      const parts = [
        d?.inserted ? `新增 ${d.inserted}` : '',
        d?.updated ? `更新 ${d.updated}` : '',
        d?.deleted ? `删除 ${d.deleted}` : '',
      ].filter(Boolean);
      Toast.success(`已保存：${parts.join('，') || '完成'}`);
      gridRef.current?.discardPending();
      setSqlPreview(null);
      await rowsData.refresh();
    }
  }, [selected, rowsData]);

  const handleDiscardPending = useCallback(() => {
    gridRef.current?.discardPending();
    setSqlPreview(null);
  }, []);

  const handleOpenSqlPreview = useCallback(() => {
    if (!selected) return;
    const m = gridRef.current?.getMutations();
    if (!m) return;
    const sqls = [
      ...m.inserts.map((values) => buildInsertSql(selected.schema, selected.name, values)),
      ...m.updates.map((u) => buildUpdateSql(selected.schema, selected.name, u.pk, u.changes)),
      ...m.deletes.map((d) => buildDeleteSql(selected.schema, selected.name, d.pk)),
    ];
    if (sqls.length === 0) return;
    setSqlPreview(sqls.join('\n'));
  }, [selected]);

  const handleStageNull = useCallback((rowIndex: number, columnName: string) => {
    gridRef.current?.stageCellValue(rowIndex, columnName, null);
  }, []);

  const pendingBarText = [
    pendingCounts.added > 0 ? `新增 ${pendingCounts.added} 行` : '',
    pendingCounts.modified > 0 ? `修改 ${pendingCounts.modified} 格` : '',
    pendingCounts.deleted > 0 ? `删除 ${pendingCounts.deleted} 行` : '',
  ].filter(Boolean).join(' · ');

  const pendingBar = pendingCount > 0 ? (
    <Space spacing={4}>
      <Text type="warning" size="small" strong>{pendingBarText}</Text>
      <Button size="small" theme="borderless" onClick={handleOpenSqlPreview}>预览 SQL</Button>
      <Button size="small" theme="solid" type="primary" loading={pendingSaving} onClick={() => void handleSavePending()}>保存</Button>
      <Button size="small" theme="borderless" onClick={handleDiscardPending}>放弃</Button>
    </Space>
  ) : undefined;

  const handleGridDeleteRows = useCallback((rowIndexes: number[]) => {
    if (!canEditRows) return;
    // 暂存删除标记（红色删除线），随「保存」统一事务提交，可撤销
    gridRef.current?.stageDeleteRows(rowIndexes);
  }, [canEditRows]);

  /** 可见列顺序（pinned 优先，与 DataGrid 内部一致），供菜单/详情按 col 下标取列 */
  const orderedGridColumns = useMemo(() => {
    const pinned = gridColumns.filter((c) => c.pinned);
    const normal = gridColumns.filter((c) => !c.pinned);
    return [...pinned, ...normal];
  }, [gridColumns]);

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
    createOperationColumn<HistoryItem>({
      width: 160,
      actions: (record) => [
        {
          key: 'use',
          label: '使用',
          onClick: () => applyHistorySql(record.sqlText),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '删除该记录？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => deleteHistoryItem(record.id),
            });
          },
        },
      ],
    }),
  ];

  // ─── 主渲染 ──────────────────────────────────────────────────────────────────
  return (
    <div className="page-container page-tabs-page page-container--stretch">
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        type="line"
        lazyRender={false}
        className="tabs-fill-height"
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
        contentStyle={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
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
                    <TabPane tab="数据" itemKey="data" style={{ height: '100%' }}>
                      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
                          <Text type="tertiary" size="small">
                            共 {rowsData.total.toLocaleString()} 行
                            {rowsOrderBy && (<> · 排序：<Text code>{rowsOrderBy} {rowsOrderDir}</Text></>)}
                            {Object.keys(rowsFilters).length > 0 && (<> · 筛选：<Text code>{Object.keys(rowsFilters).join(', ')}</Text></>)}
                            {rowsSearch && (<> · 搜索：<Text code>{rowsSearch}</Text></>)}
                            {readOnlyReason && (
                              <> · <Text type="warning">{readOnlyReason}</Text></>
                            )}
                            {canEditRows && pendingCount === 0 && (
                              <> · <Text type="tertiary">双击单元格可编辑（主键列除外）</Text></>
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
                                onClick={() => {
                                  // 有主键走内联新增（绿色草稿行）；无主键回退表单弹窗
                                  if (canEditRows) gridRef.current?.addNewRow();
                                  else openCreateRow();
                                }}
                                disabled={!structure}
                              >新增行</Button>
                            )}
                            {canWrite && isWritableTable && (
                              <Button
                                size="small"
                                icon={<Upload size={14} />}
                                onClick={() => setImportOpen(true)}
                                disabled={!structure}
                              >导入</Button>
                            )}
                            {(rowsOrderBy || Object.keys(rowsFilters).length > 0 || rowsSearch) && (
                              <Button size="small" theme="borderless" onClick={handleRowsResetAll}>重置排序 / 筛选</Button>
                            )}
                          </Space>
                        </div>
                        {selectedRowIndexes.size > 0 && (
                          <div style={{ marginBottom: 8, padding: '6px 12px', background: 'var(--semi-color-fill-0)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                            <Text size="small">已选 <Text strong>{selectedRowIndexes.size}</Text> 行</Text>
                            <Space>
                              {canEditRows && (
                                <Button
                                  size="small"
                                  type="danger"
                                  theme="solid"
                                  icon={<Trash2 size={14} />}
                                  onClick={handleBatchDelete}
                                >标记删除</Button>
                              )}
                              <Button size="small" icon={<Copy size={14} />} onClick={() => void handleBatchCopyInsert()}>复制为 INSERT SQL</Button>
                              {hasPrimaryKey && (
                                <Button size="small" icon={<Copy size={14} />} onClick={() => void handleBatchCopyUpdate()}>复制为 UPDATE SQL</Button>
                              )}
                              <Button size="small" theme="borderless" onClick={() => { gridRef.current?.clearSelection(); }}>取消选择</Button>
                            </Space>
                          </div>
                        )}
                        <div style={{ flex: 1, minHeight: 0 }}>
                          {rowsData.loading && rowsData.rows.length === 0 ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}><Spin /></div>
                          ) : (
                            <DataGrid
                              ref={gridRef}
                              columns={gridColumns}
                              rows={rowsData.rows}
                              totalRows={rowsData.total}
                              hasMore={rowsData.hasMore}
                              loadingMore={rowsData.loadingMore}
                              onLoadMore={rowsData.loadMore}
                              sortState={rowsOrderBy && rowsOrderDir ? { column: rowsOrderBy, dir: rowsOrderDir } : null}
                              onSortChange={(s) => handleRowsSort(s?.column ?? rowsOrderBy ?? '', s?.dir)}
                              onOpenDetail={handleGridOpenDetail}
                              onRowDoubleClick={handleGridDoubleClick}
                              onCellContextMenu={(e, pos, snapshot) => {
                                setGridMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  pos,
                                  snapshot,
                                  columns: gridRef.current?.getVisibleColumns() ?? orderedGridColumns,
                                });
                              }}
                              headerFilterRender={(col) => (
                                <ColumnFilterButton
                                  columnName={col.name}
                                  value={rowsFilters[col.name] ?? ''}
                                  onChange={(encoded) => handleGridFilterChange(col.name, encoded)}
                                />
                              )}
                              onFkClick={handleGridFkClick}
                              onSelectedRowsChange={setSelectedRowIndexes}
                              editable={canEditRows}
                              onPendingCountChange={handleCountsChange}
                              statusExtra={pendingBar}
                              storageKey={selected ? `db-admin:grid:${selected.schema}.${selected.name}` : undefined}
                              emptyText="无数据"
                            />
                          )}
                        </div>
                      </div>
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

      {selected && structure && isWritableTable && (
        <ImportModal
          open={importOpen}
          schema={selected.schema}
          table={selected.name}
          columns={structure.columns}
          onClose={() => setImportOpen(false)}
          onSuccess={() => { setImportOpen(false); refreshRows(); }}
        />
      )}

      <CellDetailDrawer
        visible={detailState !== null}
        onClose={() => setDetailState(null)}
        columns={gridColumns}
        row={detailState !== null
          ? ((gridRef.current?.getEffectiveRows() ?? rowsData.rows)[detailState.rowIndex] ?? null)
          : null}
        rowNumber={detailState !== null ? detailState.rowIndex + 1 : null}
        columnName={detailState?.columnName ?? null}
      />

      <GridContextMenu
        menu={gridMenu}
        onClose={() => setGridMenu(null)}
        rows={gridMenu !== null ? (gridRef.current?.getEffectiveRows() ?? rowsData.rows) : rowsData.rows}
        schema={selected?.schema}
        table={selected?.name}
        primaryKey={structure?.primaryKey ?? []}
        canEditRows={canEditRows}
        onFilterByValue={(column, encoded) => handleGridFilterChange(column, encoded)}
        onOpenDetail={handleGridOpenDetail}
        onEditRow={(rowIndex, focusField) => {
          const row = rowsData.rows[rowIndex];
          if (row) openEditRow(row, focusField);
        }}
        onDeleteRows={handleGridDeleteRows}
        onSetNull={handleStageNull}
      />

      <Modal
        title={`SQL 预览（${pendingCount} 处修改）`}
        visible={sqlPreview !== null}
        onCancel={() => setSqlPreview(null)}
        width={720}
        footer={
          <Space>
            <Button
              icon={<Copy size={14} />}
              onClick={() => { if (sqlPreview) void copyToClipboard(sqlPreview, '已复制 SQL'); }}
            >复制</Button>
            <Button onClick={() => setSqlPreview(null)}>关闭</Button>
            <Button theme="solid" type="primary" loading={pendingSaving} onClick={() => void handleSavePending()}>
              确认保存
            </Button>
          </Space>
        }
      >
        <div style={{ height: 360, border: '1px solid var(--semi-color-border)', borderRadius: 4, overflow: 'hidden' }}>
          <MonacoEditor
            value={sqlPreview ?? ''}
            language="sql"
            theme={monacoTheme}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              wordWrap: 'on',
              fontSize: 12,
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>
        <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 8 }}>
          以上语句将在同一事务中执行，任意一条失败即整体回滚。
        </Text>
      </Modal>
    </div>
  );
}
