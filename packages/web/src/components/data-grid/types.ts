import type * as React from 'react';

/** 网格列定义 */
export interface DataGridColumn {
  /** 列名（唯一，同时作为取值 key） */
  name: string;
  /** 数据库类型串（如 integer / character varying / jsonb），驱动类型化渲染与对齐 */
  dataType?: string;
  /** 是否主键（表头钥匙标记 + 固定列） */
  isPrimaryKey?: boolean;
  /** 是否可空 */
  nullable?: boolean;
  /** 外键信息（表头 FK 标记 + 单元格跳转） */
  fk?: { schema: string; table: string; columns: string[] } | null;
  /** 固定在左侧（在行号列之后按声明顺序排列） */
  pinned?: boolean;
  /** 列注释（表头 tooltip） */
  comment?: string | null;
  /** 枚举列取值（渲染下拉编辑器） */
  enumValues?: string[] | null;
}

/** 单元格坐标（均为可见坐标系：row = 行下标，col = 可见列下标） */
export interface CellPos {
  row: number;
  col: number;
}

export type SortDir = 'asc' | 'desc';

export interface SortState {
  column: string;
  dir: SortDir;
}

/** 选区状态（reducer 管理） */
export interface SelectionState {
  /** 区域选择起点（也是 active cell） */
  anchor: CellPos | null;
  /** 区域选择终点 */
  focus: CellPos | null;
  /** Ctrl 离散选择，key = `${row}:${col}` */
  discrete: Set<string>;
  /** 行号列整行选择 */
  rows: Set<number>;
  /** 行选区间锚点（Shift 选行区间用） */
  rowAnchor: number | null;
}

export type SelectionAction =
  | { type: 'cellMouseDown'; pos: CellPos; shift: boolean; ctrl: boolean }
  | { type: 'cellDragOver'; pos: CellPos }
  | { type: 'rowClick'; row: number; shift: boolean; ctrl: boolean }
  | { type: 'move'; dRow: number; dCol: number; shift: boolean; rowCount: number; colCount: number }
  | { type: 'moveTo'; pos: CellPos; shift: boolean }
  | { type: 'selectAll'; rowCount: number }
  | { type: 'ensureCellSelected'; pos: CellPos }
  | { type: 'clear' };

/** 选区快照：右键菜单 / 复制时导出 */
export interface SelectionSnapshot {
  mode: 'rows' | 'cells' | 'none';
  /** 涉及的行下标（升序去重） */
  rowIndexes: number[];
  /** 逐行的单元格坐标（行内按列升序）；rows 模式下为整行所有可见列 */
  matrix: CellPos[][];
  /** 单元格总数 */
  cellCount: number;
}

export interface DataGridHandle {
  /** 导出当前选区快照 */
  getSelectionSnapshot: () => SelectionSnapshot;
  /** 当前可见列（pinned 优先排序，隐藏列已剔除；与快照 col 下标对齐） */
  getVisibleColumns: () => DataGridColumn[];
  /** 清空选区（含行选择） */
  clearSelection: () => void;
  /** 滚回顶部 */
  scrollToTop: () => void;
  /** 复制当前选区为 TSV（返回是否成功） */
  copySelection: () => Promise<boolean>;
  /** 导出内联编辑暂存变更（batch-mutate / SQL 预览用） */
  getPendingUpdates: () => Array<{ pk: Record<string, unknown>; changes: Record<string, unknown>; originals: Record<string, unknown> }>;
  /** 放弃所有暂存变更 */
  discardPending: () => void;
  /** 程序化暂存一个单元格值（右键「设为 NULL」等） */
  stageCellValue: (rowIndex: number, columnName: string, value: unknown) => void;
  /** 应用暂存后的有效行数据（右键菜单复制等场景使用） */
  getEffectiveRows: () => Array<Record<string, unknown>>;
}

export interface DataGridProps {
  columns: DataGridColumn[];
  rows: Array<Record<string, unknown>>;
  /** 服务端总行数（状态条展示「已加载 x / 共 y」） */
  totalRows?: number;
  /** 是否还有更多数据可加载 */
  hasMore?: boolean;
  /** 正在加载更多 */
  loadingMore?: boolean;
  /** 滚动接近底部时触发 */
  onLoadMore?: () => void;
  /** 受控排序状态（表头点击循环 asc → desc → none） */
  sortState?: SortState | null;
  onSortChange?: (s: SortState | null) => void;
  /** 打开单元格详情（Enter / 角标 / 右键菜单由父层调用） */
  onOpenDetail?: (pos: CellPos) => void;
  /** 双击单元格（db-admin 用于打开行编辑） */
  onRowDoubleClick?: (rowIndex: number, columnName: string) => void;
  /** 单元格右键（组件已先保证该格进入选区，snapshot 为 ensure 后的最新选区） */
  onCellContextMenu?: (e: React.MouseEvent, pos: CellPos, snapshot: SelectionSnapshot) => void;
  /** 表头筛选渲染插槽（返回完整的漏斗按钮元素，如 Popover 包裹的 Button） */
  headerFilterRender?: (col: DataGridColumn) => React.ReactNode;
  /** FK 单元格跳转 */
  onFkClick?: (columnName: string, value: unknown, rowIndex: number) => void;
  /** 行选择变化（供批量操作条） */
  onSelectedRowsChange?: (rows: Set<number>) => void;
  /** 启用内联编辑（需存在主键列；PK 列默认只读） */
  editable?: boolean;
  /** 覆盖默认的列可编辑判断（默认：非主键列可编辑） */
  isColumnEditable?: (col: DataGridColumn) => boolean;
  /** 暂存变更单元格数变化（供保存操作条） */
  onPendingCountChange?: (count: number) => void;
  /** 行高，默认 32 */
  rowHeight?: number;
  /** 列宽 / 列隐藏持久化 key（localStorage） */
  storageKey?: string;
  /** 状态条左侧插槽（M2 放变更提示） */
  statusExtra?: React.ReactNode;
  /** 是否显示状态条，默认 true */
  showStatusBar?: boolean;
  className?: string;
  emptyText?: string;
}
