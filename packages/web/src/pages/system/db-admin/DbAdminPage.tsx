import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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
import { downloadBlob } from '@/utils/download';
import { useThemeController } from '@/providers/theme-controller';
import { usePermission } from '@/hooks/usePermission';
import { usePreferences } from '@/hooks/usePreferences';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import { confirmDanger, confirmDelete } from '@/utils/confirm';
import { copyTextWithToast } from '@/utils/clipboard';
import { RowEditModal } from './RowEditModal';
import { buildDeleteSql, buildInsertSql, buildUpdateSql, generateCreateTableDdl } from './sql-format';
import { OverviewPanel, KindTag } from './OverviewPanel';
import type { SqlConsoleHandle } from './SqlConsole';
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
import { QuickOpenDialog } from './QuickOpenDialog';
import {
  dbAdminKeys,
  dbAdminTableExportCsvUrl,
  dbAdminTableExportSqlUrl,
  fetchDbAdminTableStructure,
  useClearDbQueryHistory,
  useDbAdminBatchMutateRows,
  useDbAdminErSchema,
  useDbAdminHistory,
  useDbAdminRefreshMatview,
  useDbAdminTables,
  useDbAdminTableStructure,
  useDbAdminTruncateTable,
  useDeleteDbQueryHistory,
} from '@/hooks/queries/db-admin';
import type {
  DbAdminColumn as DbAdminColumnInfo,
  DbAdminForeignKey as DbAdminForeignKeyInfo,
  DbAdminIndex as DbAdminIndexInfo,
  DbAdminQueryHistoryItem,
  DbAdminSqlExportMode,
  DbAdminTableItem,
  DbAdminTableStructure,
} from '@zenith/shared/ops';
import './db-admin.css';
import { dateTimeColumn } from '@/utils/table-columns';
import { request } from '@/utils/request';

const ErDiagram = lazy(() => import('./ErDiagram').then((module) => ({
  default: module.ErDiagram,
})));
const MonacoEditor = lazy(() => import('@monaco-editor/react'));
const SqlConsole = lazy(() => import('./SqlConsole').then((module) => ({
  default: module.SqlConsole,
})));
const lazyPanelFallback = (
  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <Spin />
  </div>
);

const { Title, Text } = Typography;


type TableItem = DbAdminTableItem;
type ColumnInfo = DbAdminColumnInfo;
type IndexInfo = DbAdminIndexInfo;
type ForeignKeyInfo = DbAdminForeignKeyInfo;
type TableStructure = DbAdminTableStructure;
type HistoryItem = DbAdminQueryHistoryItem;

const SYSTEM_SCHEMAS = new Set(['pg_catalog', 'information_schema', 'pg_toast', 'drizzle']);
const SYSTEM_TABLES = new Set([
  'public.db_admin_query_history',
  'public.audit_logs',
  'public.__drizzle_migrations',
]);
const EMPTY_TABLES: TableItem[] = [];

const VALID_TABS = new Set(['overview', 'browse', 'objects', 'console', 'ops', 'history', 'er']);

export default function DbAdminPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const { preferences: { syncPageStateToUrl } } = usePreferences();
  const canQuery = hasPermission('system:db-admin:query');
  const canExport = hasPermission('system:db-admin:export');
  const canWrite = hasPermission('system:db-admin:write');
  const canMaintain = hasPermission('system:db-admin:maintain');
  // psql 终端等价于服务器 shell（\!、\copy），入口与服务端 ws-terminal 权限一致：还需 system:terminal:execute
  const canTerminal = hasPermission('system:db-admin:terminal') && hasPermission('system:terminal:execute');
  const { isDark } = useThemeController();
  const monacoTheme = isDark ? 'vs-dark' : 'light';

  // Tab 与选中表同步到 URL（?tab=&table=schema.name），刷新恢复、可直接分享
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(() => {
    const tab = searchParams.get('tab');
    return tab && VALID_TABS.has(tab) ? tab : 'overview';
  });
  const initialTableParamRef = useRef<string | null>(searchParams.get('table'));
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<string>>(() => new Set(['overview']));
  const sqlConsoleRef = useRef<SqlConsoleHandle | null>(null);
  const pendingConsoleSqlRef = useRef<string | null>(null);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);

  useEffect(() => {
    setVisitedTabs((current) => {
      if (current.has(activeTab)) return current;
      const next = new Set(current);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  const handleSqlConsoleRef = useCallback((instance: SqlConsoleHandle | null) => {
    sqlConsoleRef.current = instance;
    if (instance && pendingConsoleSqlRef.current !== null) {
      const sql = pendingConsoleSqlRef.current;
      pendingConsoleSqlRef.current = null;
      instance.loadSql(sql, { newTab: true });
    }
  }, []);

  const openSqlInConsole = useCallback((sql: string) => {
    setActiveTab('console');
    if (sqlConsoleRef.current) {
      sqlConsoleRef.current.loadSql(sql, { newTab: true });
    } else {
      pendingConsoleSqlRef.current = sql;
    }
  }, []);

  // 表浏览
  const [tableFilter, setTableFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'table' | 'view'>('all');
  const [selected, setSelected] = useState<TableItem | null>(null);

  // 记住表详情内层 Tab（结构/数据/索引/外键）：按上次使用习惯打开
  const [innerTab, setInnerTabState] = useState<string>(() => {
    const saved = localStorage.getItem('db-admin:inner-tab');
    return saved && ['structure', 'data', 'indexes', 'foreignKeys'].includes(saved) ? saved : 'structure';
  });
  const setInnerTab = useCallback((key: string) => {
    setInnerTabState(key);
    localStorage.setItem('db-admin:inner-tab', key);
  }, []);

  // 最近打开的表（最多 8 张），展示在表清单顶部便于回访
  const [recentTableKeys, setRecentTableKeys] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('db-admin:recent-tables') ?? '[]') as unknown;
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, 8) : [];
    } catch {
      return [];
    }
  });
  const recordRecentTable = useCallback((item: TableItem) => {
    setRecentTableKeys((prev) => {
      const key = `${item.schema}.${item.name}`;
      const next = [key, ...prev.filter((k) => k !== key)].slice(0, 8);
      localStorage.setItem('db-admin:recent-tables', JSON.stringify(next));
      return next;
    });
  }, []);

  const [rowsOrderBy, setRowsOrderBy] = useState<string | undefined>(undefined);
  const [rowsOrderDir, setRowsOrderDir] = useState<'asc' | 'desc' | undefined>(undefined);
  const [rowsFilters, setRowsFilters] = useState<Record<string, string>>({});
  const [rowsSearch, setRowsSearch] = useState('');
  const [rowsSearchInput, setRowsSearchInput] = useState('');
  const [rowsWhere, setRowsWhere] = useState('');
  const [rowsWhereInput, setRowsWhereInput] = useState('');
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<Set<number>>(new Set());
  // 数据网格
  const gridRef = useRef<DataGridHandle | null>(null);
  const [gridMenu, setGridMenu] = useState<GridMenuState | null>(null);
  const [detailState, setDetailState] = useState<{ rowIndex: number; columnName: string | null } | null>(null);
  // 内联编辑暂存
  const [pendingCount, setPendingCount] = useState(0);
  const [sqlPreview, setSqlPreview] = useState<string | null>(null);

  // 历史
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);

  // 行编辑 Modal
  const [rowModalOpen, setRowModalOpen] = useState(false);
  const [rowModalMode, setRowModalMode] = useState<'create' | 'edit'>('create');
  const [rowModalInitial, setRowModalInitial] = useState<Record<string, unknown> | undefined>(undefined);
  const [rowModalFocusField, setRowModalFocusField] = useState<string | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);

  const tablesQuery = useDbAdminTables();
  const tables = tablesQuery.data ?? EMPTY_TABLES;
  const tablesLoading = tablesQuery.isFetching;

  // 深链恢复：?table=schema.name 在表清单加载完成后解析选中
  useEffect(() => {
    if (!initialTableParamRef.current || tablesQuery.isPending) return;
    const key = initialTableParamRef.current;
    initialTableParamRef.current = null;
    const dotIndex = key.indexOf('.');
    if (dotIndex <= 0) return;
    const schema = key.slice(0, dotIndex);
    const name = key.slice(dotIndex + 1);
    const item = tables.find((t) => t.schema === schema && t.name === name);
    if (item) {
      setSelected(item);
      recordRecentTable(item);
    }
  }, [tablesQuery.isPending, tables, recordRecentTable]);

  // 状态 → URL：仅写非默认值，replace 避免污染浏览器历史；
  // 深链表尚未解析完成时不接管，避免首轮渲染把 table 参数抹掉。
  // 偏好「页面状态同步到地址栏」关闭时消费即焚：深链应用后清参、不再写回
  useEffect(() => {
    if (initialTableParamRef.current) return;
    const current = new URLSearchParams(window.location.search);
    current.delete('redirect');
    const next = new URLSearchParams(current);
    next.delete('tab');
    next.delete('table');
    if (syncPageStateToUrl) {
      if (activeTab !== 'overview') next.set('tab', activeTab);
      if (selected) next.set('table', `${selected.schema}.${selected.name}`);
    }
    if (next.toString() !== current.toString()) setSearchParams(next, { replace: true });
  }, [activeTab, selected, setSearchParams, syncPageStateToUrl]);

  const structureQuery = useDbAdminTableStructure(selected?.schema, selected?.name, selected !== null);
  const structure = structureQuery.data ?? null;
  const structureLoading = structureQuery.isFetching;
  const historyQuery = useDbAdminHistory({ page: historyPage, pageSize: historyPageSize }, activeTab === 'history');
  const history = historyQuery.data?.list ?? [];
  const historyTotal = historyQuery.data?.total ?? 0;
  const historyLoading = historyQuery.isFetching;
  const erQuery = useDbAdminErSchema(activeTab === 'er');
  const erSchema = erQuery.data ?? null;
  const erLoading = erQuery.isFetching;
  const deleteHistoryMutation = useDeleteDbQueryHistory();
  const clearHistoryMutation = useClearDbQueryHistory();
  const truncateTableMutation = useDbAdminTruncateTable();
  const refreshMatviewMutation = useDbAdminRefreshMatview();
  const batchMutateRowsMutation = useDbAdminBatchMutateRows();
  const pendingSaving = batchMutateRowsMutation.isPending;

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

  // 最近打开的表（按 key 还原为最新的表信息，已删除的表自动消失）
  const recentTables = useMemo(() => {
    if (tables.length === 0) return [];
    return recentTableKeys
      .map((key) => tables.find((t) => `${t.schema}.${t.name}` === key))
      .filter((t): t is TableItem => !!t);
  }, [recentTableKeys, tables]);

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
    whereRaw: rowsWhere,
  });

  // Ctrl+P / Cmd+P 快速打开（拦截浏览器打印）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P') && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setQuickOpenVisible(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!selected || !structure) return;
    structureColumnsCacheRef.current.set(
      `${selected.schema}.${selected.name}`,
      structure.columns.map((c) => c.name),
    );
  }, [selected, structure]);

  const handleSelectTable = (item: TableItem) => {
    // 重复选中同一张表（如双击）直接忽略：setSelected 同引用不会重跑加载 effect，
    // 若继续执行清理会把已加载的结构清空且不再恢复
    if (selected && selected.schema === item.schema && selected.name === item.name) return;
    const doSelect = () => {
      setSelected(item);
      recordRecentTable(item);
      setRowsOrderBy(undefined);
      setRowsOrderDir(undefined);
      setRowsFilters({});
      setRowsSearch('');
      setRowsSearchInput('');
      setRowsWhere('');
      setRowsWhereInput('');
      setSelectedRowIndexes(new Set());
      setPendingCount(0);
      gridRef.current?.discardPending();
      gridRef.current?.clearSelection();
    };
    if (pendingCount > 0 && selected && (selected.schema !== item.schema || selected.name !== item.name)) {
      confirmDanger({
        title: '有未保存的修改',
        content: `当前表有 ${pendingCount} 处暂存修改，切换表将全部放弃，确定继续？`,
        onOk: doSelect,
      });
      return;
    }
    doSelect();
  };

  const handleRowsSort = (col: string, dir: 'asc' | 'desc' | undefined) => {
    // 服务端重排后行下标语义失效，清空选区（暂存按主键定位不受影响）
    gridRef.current?.clearSelection();
    setRowsOrderBy(dir ? col : undefined);
    setRowsOrderDir(dir);
  };

  const handleRowsResetAll = () => {
    setRowsOrderBy(undefined);
    setRowsOrderDir(undefined);
    setRowsFilters({});
    setRowsSearch('');
    setRowsSearchInput('');
    setRowsWhere('');
    setRowsWhereInput('');
  };

  const handleApplyWhere = (raw: string) => {
    const s = raw.trim();
    if (s.includes(';') || s.includes('--') || s.includes('/*')) {
      Toast.warning('WHERE 条件不允许包含分号或注释');
      return;
    }
    gridRef.current?.clearSelection();
    setRowsWhere(s);
  };

  const handleRunSearch = (kw: string) => {
    setRowsSearch(kw.trim());
  };

  // ─── 表名右侧快捷操作 ─────────────────────────────────────────────────────
  const fullName = (t: TableItem) => (t.schema === 'public' ? t.name : `${t.schema}.${t.name}`);
  const copyToClipboard = (text: string, msg: string) => copyTextWithToast(text, { success: msg, error: '复制失败' });
  const handleCopyName = (t: TableItem) => copyToClipboard(fullName(t), `已复制 ${fullName(t)}`);
  const handleCopySelect = (t: TableItem) =>
    copyToClipboard(`SELECT * FROM ${fullName(t)} LIMIT 50;`, '已复制 SELECT 语句');
  const handleOpenInConsole = (t: TableItem) => {
    openSqlInConsole(`SELECT * FROM ${fullName(t)} LIMIT 50;`);
  };

  // ─── 表右键上下文菜单操作 ────────────────────────────────────────────────────
  const handleExportTableCsv = async (t: TableItem) => {
    if (!canExport) return;
    try {
      const blob = await request.getBlob(dbAdminTableExportCsvUrl(t.schema, t.name));
      if (!blob) return;
      downloadBlob(blob, `${t.schema}_${t.name}_${Date.now()}.csv`);
      Toast.success(`${fullName(t)} 导出成功`);
    } catch (err) {
      Toast.error('导出失败：' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleExportTableSql = async (t: TableItem, mode: DbAdminSqlExportMode) => {
    if (!canExport) return;
    try {
      const blob = await request.getBlob(dbAdminTableExportSqlUrl(t.schema, t.name, mode));
      if (!blob) return;
      const suffixMap: Record<string, string> = { ddl: 'ddl', data: 'data', full: 'full' };
      const suffix = suffixMap[mode] ?? 'full';
      downloadBlob(blob, `${t.schema}_${t.name}_${suffix}_${Date.now()}.sql`);
      Toast.success(`${fullName(t)} SQL 导出成功`);
    } catch (err) {
      Toast.error('导出失败：' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleCopyDdl = async (t: TableItem) => {
    let str: TableStructure | null =
      (selected?.schema === t.schema && selected?.name === t.name) ? structure : null;
    if (!str) {
      try {
        str = await queryClient.fetchQuery({
          queryKey: dbAdminKeys.structure(t.schema, t.name),
          queryFn: () => fetchDbAdminTableStructure(t.schema, t.name),
        });
      } catch {
        Toast.error('获取结构失败');
        return;
      }
    }
    if (!str) return;
    const ddl = generateCreateTableDdl(t.schema, t.name, str.columns, str.primaryKey);
    await copyToClipboard(ddl, '已复制 CREATE TABLE DDL');
  };

  const handleTruncateTable = async (t: TableItem) => {
    try {
      await truncateTableMutation.mutateAsync({ params: { schema: t.schema, name: t.name } });
      Toast.success(`已截断 ${fullName(t)}`);
      if (selected?.schema === t.schema && selected?.name === t.name) refreshRows();
    }
    catch (err) { Toast.error(err instanceof Error ? err.message : '截断失败'); }
  };

  const handleRefreshMatview = async (t: TableItem) => {
    try {
      await refreshMatviewMutation.mutateAsync({ params: { schema: t.schema, name: t.name } });
      Toast.success(`已刷新 ${fullName(t)}`);
      if (selected?.schema === t.schema && selected?.name === t.name) refreshRows();
    }
    catch (err) { Toast.error(err instanceof Error ? err.message : '刷新失败'); }
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
                confirmDanger({
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
    openSqlInConsole(text);
  };

  const deleteHistoryItem = async (id: number) => {
    await deleteHistoryMutation.mutateAsync({ params: { id } });
    Toast.success('已删除');
  };

  const clearHistory = async () => {
    await clearHistoryMutation.mutateAsync({});
    Toast.success('已清空');
    setHistoryPage(1);
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
  }, [tables, setInnerTab]);

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
    try {
      const d = await batchMutateRowsMutation.mutateAsync({
        params: { schema: selected.schema, name: selected.name },
        body: {
          inserts: m.inserts.length > 0 ? m.inserts : undefined,
          updates: m.updates.length > 0 ? m.updates.map(({ pk, changes }) => ({ pk, changes })) : undefined,
          deletes: m.deletes.length > 0 ? m.deletes : undefined,
        },
      });
      const parts = [
        d.inserted ? `新增 ${d.inserted}` : '',
        d.updated ? `更新 ${d.updated}` : '',
        d.deleted ? `删除 ${d.deleted}` : '',
      ].filter(Boolean);
      Toast.success(`已保存：${parts.join('，') || '完成'}`);
      gridRef.current?.discardPending();
      setSqlPreview(null);
      await rowsData.refresh();
    } catch {
      // request 层已提示错误，保留暂存修改供用户修正或重试
    }
  }, [selected, batchMutateRowsMutation, rowsData]);

  const handleDiscardPending = useCallback(() => {
    const doDiscard = () => {
      gridRef.current?.discardPending();
      setSqlPreview(null);
    };
    // 单处修改直接放弃；多处修改需确认，避免紧邻「保存」的误点造成批量丢失
    if (pendingCount <= 1) {
      doDiscard();
      return;
    }
    confirmDanger({
      title: '放弃全部暂存修改？',
      content: `当前有 ${pendingCount} 处暂存修改（含新增/修改/删除标记），放弃后无法恢复。`,
      okText: '放弃修改',
      onOk: doDiscard,
    });
  }, [pendingCount]);

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
    dateTimeColumn('时间', 'executedAt'),
    { title: '状态', dataIndex: 'success', width: 80, render: (v: boolean) =>
      v ? <Badge type="success" dot /> : <Badge type="danger" dot />,
    },
    { title: 'SQL', dataIndex: 'sqlText', ellipsis: { showTitle: false }, render: (v: string) => (
      <Tooltip content={<div style={{ maxWidth: 500, whiteSpace: 'pre-wrap' }}>{v}</div>}>
        <Text code>{v.length > 100 ? v.slice(0, 100) + '…' : v}</Text>
      </Tooltip>
    )},
    { title: '耗时', dataIndex: 'durationMs', width: 100, align: 'right', render: (v: number) => `${v}ms` },
    { title: '行数', dataIndex: 'rowCount', width: 80, align: 'right' },
    { title: '错误', dataIndex: 'errorMessage', ellipsis: { showTitle: false }, render: (v: string | null) =>
      v ? <Tooltip content={<div style={{ maxWidth: 400 }}>{v}</div>}><Text type="danger">{v.slice(0, 60)}</Text></Tooltip> : '-',
    },
    createOperationColumn<HistoryItem>({
      width: 150,
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
            confirmDelete({
              title: '删除该记录？',
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
        collapsible="auto"
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
                        <Button icon={<RefreshCw size={14} />} onClick={() => void tablesQuery.refetch()} loading={tablesLoading} size="small" theme="borderless" />
                      </Tooltip>
                    </Space>
                  }
                  search={{
                    value: tableFilter,
                    onChange: setTableFilter,
                    placeholder: '搜索表名 / schema（Ctrl+P 快速打开）',
                  }}
                  loading={tablesLoading && tables.length === 0}
                  emptyText="无匹配的表"
                  bodyNoPadding
                  rawBody
                >
                  {recentTables.length > 0 && !tableFilter.trim() && (
                    <div style={{ padding: '0 8px 4px' }}>
                      <div style={{ padding: '8px 8px 2px' }}>
                        <Space>
                          <History size={13} style={{ color: 'var(--semi-color-text-2)', verticalAlign: -2 }} />
                          <Text type="tertiary" size="small" strong>最近打开</Text>
                        </Space>
                      </div>
                      <List split={false} className="nav-list-panel__list">
                        {recentTables.map((t: TableItem) => (
                          <NavListItem
                            key={`recent:${t.schema}.${t.name}`}
                            active={selected?.schema === t.schema && selected?.name === t.name}
                            onClick={() => handleSelectTable(t)}
                            primary={t.name}
                            secondary={`${t.schema} · ${t.sizeText}`}
                          />
                        ))}
                      </List>
                    </div>
                  )}
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
                  <Tabs collapsible="auto" activeKey={innerTab} onChange={setInnerTab} type="line" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }} contentStyle={{ flex: 1, overflow: 'auto', padding: 12, minHeight: 0, minWidth: 0 }}>
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
                            {rowsWhere && (<> · WHERE：<Text code>{rowsWhere.length > 40 ? rowsWhere.slice(0, 40) + '…' : rowsWhere}</Text></>)}
                            {readOnlyReason && (
                              <> · <Text type="warning">{readOnlyReason}</Text></>
                            )}
                            {canEditRows && pendingCount === 0 && (
                              <> · <Text type="tertiary">双击单元格可编辑（主键列除外）</Text></>
                            )}
                          </Text>
                          <Space wrap>
                            {canQuery && (
                              <Input
                                size="small"
                                prefix={<Text size="small" strong style={{ color: 'var(--semi-color-warning)', paddingLeft: 6 }}>WHERE</Text>}
                                placeholder={'status = \'failed\' AND duration_ms > 100'}
                                value={rowsWhereInput}
                                onChange={setRowsWhereInput}
                                onEnterPress={() => handleApplyWhere(rowsWhereInput)}
                                showClear
                                onClear={() => { setRowsWhereInput(''); handleApplyWhere(''); }}
                                style={{ width: 300, fontFamily: 'Menlo, Monaco, Consolas, monospace' }}
                              />
                            )}
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
                            {(rowsOrderBy || Object.keys(rowsFilters).length > 0 || rowsSearch || rowsWhere) && (
                              <Button size="small" theme="borderless" onClick={handleRowsResetAll}>重置排序 / 筛选</Button>
                            )}
                          </Space>
                        </div>
                        {selectedRowIndexes.size > 0 && (
                          <div style={{ marginBottom: 8, padding: '6px 12px', background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-small)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
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
                              refreshing={rowsData.refreshing}
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
            {(activeTab === 'console' || visitedTabs.has('console')) && (
              <Suspense fallback={lazyPanelFallback}>
                <SqlConsole
                  ref={handleSqlConsoleRef}
                  tables={tables}
                  structureColumnsCache={structureColumnsCacheRef}
                  canQuery={canQuery}
                  canExport={canExport}
                  canTerminal={canTerminal}
                  canWrite={canWrite}
                  monacoTheme={monacoTheme}
                />
              </Suspense>
            )}
          </div>
        </TabPane>

        <TabPane tab={<span><Server size={14} style={{ verticalAlign: -2, marginRight: 4 }} />运维</span>} itemKey="ops" style={{ height: '100%' }}>
          <OpsPanel canMaintain={canMaintain} active={activeTab === 'ops'} />
        </TabPane>

        <TabPane tab={<span><History size={14} style={{ verticalAlign: -2, marginRight: 4 }} />查询历史</span>} itemKey="history" style={{ height: '100%', overflow: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Space>
              <Button icon={<RefreshCw size={14} />} onClick={() => void historyQuery.refetch()} loading={historyLoading}>刷新</Button>
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
              pagination={{
                currentPage: historyPage,
                pageSize: historyPageSize,
                total: historyTotal,
                onPageChange: (p) => { setHistoryPage(p); },
                onPageSizeChange: (size) => { setHistoryPageSize(size); setHistoryPage(1); },
              }}
            />
          </div>
        </TabPane>

        <TabPane tab={<span><Network size={14} style={{ verticalAlign: -2, marginRight: 4 }} />ER 图</span>} itemKey="er">
          <Space vertical align="start" style={{ width: '100%' }}>
            <Space>
              <Button icon={<RefreshCw size={14} />} onClick={() => void erQuery.refetch()} loading={erLoading}>刷新</Button>
              <Text type="tertiary" size="small">
                {erSchema ? `共 ${erSchema.tables.length} 张表，${erSchema.foreignKeys.length} 条外键关系` : ''}
              </Text>
            </Space>
            {(() => {
              if (erLoading && !erSchema) return <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>;
              if (!erSchema) return <Empty title="暂无数据" />;
              if (erSchema.tables.length === 0) return <Empty title="数据库内没有用户表" />;
              return (activeTab === 'er' || visitedTabs.has('er')) ? (
                <Suspense fallback={lazyPanelFallback}>
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
                </Suspense>
              ) : null;
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
          // 用网格显示顺序取行（本地排序后与 rowsData.rows 下标可能不同），并携带暂存值
          const row = (gridRef.current?.getEffectiveRows() ?? rowsData.rows)[rowIndex];
          if (row) openEditRow(row, focusField);
        }}
        onDeleteRows={handleGridDeleteRows}
        onCloneRows={canEditRows ? (rowIndexes) => {
          const n = gridRef.current?.cloneRows(rowIndexes) ?? 0;
          if (n > 0) Toast.success(`已克隆 ${n} 行为新增草稿（主键已清空）`);
        } : undefined}
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
        <div style={{ height: 360, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)', overflow: 'hidden' }}>
          {sqlPreview !== null && (
            <Suspense fallback={lazyPanelFallback}>
              <MonacoEditor
                value={sqlPreview}
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
            </Suspense>
          )}
        </div>
        <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 8 }}>
          以上语句将在同一事务中执行，任意一条失败即整体回滚。
        </Text>
      </Modal>

      <QuickOpenDialog
        visible={quickOpenVisible}
        tables={tables}
        onClose={() => setQuickOpenVisible(false)}
        onSelect={(t) => {
          const target = tables.find((x) => x.schema === t.schema && x.name === t.name);
          if (target) {
            setActiveTab('browse');
            handleSelectTable(target);
            setInnerTab('data');
          }
        }}
      />
    </div>
  );
}
