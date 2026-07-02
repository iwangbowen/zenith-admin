import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Spin, Toast } from '@douyinfe/semi-ui';
import { ArrowDown, ArrowUp, KeyRound, Link2 } from 'lucide-react';

import type {
  CellPos,
  DataGridColumn,
  DataGridHandle,
  DataGridProps,
  SelectionSnapshot,
  SelectionState,
} from './types';
import { columnKind, isNumericKind, shortTypeName, type CellKind } from './grid-format';
import { COL_MIN_WIDTH, ROW_NUMBER_WIDTH, estimateColumnWidths } from './column-width';
import {
  EMPTY_SELECTION,
  buildSelectionSnapshot,
  isCellSelected,
  rowSelectionSignature,
  selectionCellCount,
  selectionReducer,
} from './useGridSelection';
import { useGridKeyboard } from './useGridKeyboard';
import { COPY_CONFIRM_THRESHOLD, snapshotToTsv, writeClipboard } from './clipboard-format';
import { CellContent } from './cell-render';
import { GridStatusBar } from './GridStatusBar';
import { useGridEditor } from './useGridEditor';
import { CellEditorOverlay, type CommitMove } from './CellEditorOverlay';
import './data-grid.css';

const DEFAULT_ROW_HEIGHT = 32;
const LOAD_MORE_THRESHOLD = 40;
const DEFAULT_COL_WIDTH = 140;

interface StoredColState {
  widths?: Record<string, number>;
  hidden?: string[];
}

function loadStored(storageKey?: string): StoredColState | null {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(`dg:${storageKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as StoredColState;
  } catch {
    return null;
  }
}

function saveStored(storageKey: string | undefined, state: StoredColState): void {
  if (!storageKey) return;
  try {
    localStorage.setItem(`dg:${storageKey}`, JSON.stringify(state));
  } catch {
    // localStorage 不可用时静默忽略
  }
}

// ─── 行组件 ───────────────────────────────────────────────────────────────────

interface RowCallbacks {
  cellMouseDown: (pos: CellPos, shift: boolean, ctrl: boolean) => void;
  cellDragOver: (pos: CellPos) => void;
  cellDoubleClick: (rowIndex: number, columnName: string) => void;
  cellContextMenu: (e: React.MouseEvent, pos: CellPos) => void;
  rowNumMouseDown: (row: number, shift: boolean, ctrl: boolean) => void;
  rowNumContextMenu: (e: React.MouseEvent, row: number) => void;
  openDetail: (pos: CellPos) => void;
  fkClick: (columnName: string, value: unknown, rowIndex: number) => void;
}

interface GridRowProps {
  rowIndex: number;
  row: Record<string, unknown>;
  columns: DataGridColumn[];
  kinds: CellKind[];
  widths: number[];
  pinnedLefts: Array<number | undefined>;
  rowHeight: number;
  /** 选中外观签名：变化才触发重渲染 */
  selSig: string;
  /** 暂存脏列签名（\u0001 分隔的列名），变化触发重渲染 */
  dirtySig: string;
  selectionRef: React.RefObject<SelectionState>;
  hasDetailHandler: boolean;
  hasFkHandler: boolean;
  cb: RowCallbacks;
}

const GridRow = memo(function GridRow(props: GridRowProps) {
  const {
    rowIndex, row, columns, kinds, widths, pinnedLefts, rowHeight,
    dirtySig, selectionRef, hasDetailHandler, hasFkHandler, cb,
  } = props;
  const sel = selectionRef.current ?? EMPTY_SELECTION;
  const rowSelected = sel.rows.has(rowIndex);
  const dirtyCols = useMemo(
    () => (dirtySig ? new Set(dirtySig.split('\u0001')) : null),
    [dirtySig],
  );

  return (
    <div
      className={`dg-row${rowIndex % 2 === 1 ? ' dg-row--odd' : ''}`}
      style={{ transform: `translateY(${rowIndex * rowHeight}px)`, height: rowHeight }}
      data-row={rowIndex}
    >
      <div
        className={`dg-rownum${rowSelected ? ' dg-rownum--selected' : ''}`}
        style={{ width: ROW_NUMBER_WIDTH, height: rowHeight }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          cb.rowNumMouseDown(rowIndex, e.shiftKey, e.ctrlKey || e.metaKey);
        }}
        onContextMenu={(e) => cb.rowNumContextMenu(e, rowIndex)}
      >
        {rowIndex + 1}
      </div>
      {columns.map((col, ci) => {
        const value = row[col.name];
        const selected = isCellSelected(sel, rowIndex, ci);
        const active = sel.anchor?.row === rowIndex && sel.anchor.col === ci;
        const pinned = pinnedLefts[ci] !== undefined;
        let cls = 'dg-cell';
        if (isNumericKind(kinds[ci])) cls += ' dg-cell--numeric';
        if (pinned) cls += ' dg-cell--pinned';
        if (selected) cls += ' dg-cell--selected';
        if (active) cls += ' dg-cell--active';
        if (dirtyCols?.has(col.name)) cls += ' dg-cell--dirty';
        return (
          <div
            key={col.name}
            className={cls}
            style={{ width: widths[ci], height: rowHeight, left: pinnedLefts[ci] }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              cb.cellMouseDown({ row: rowIndex, col: ci }, e.shiftKey, e.ctrlKey || e.metaKey);
            }}
            onMouseEnter={() => cb.cellDragOver({ row: rowIndex, col: ci })}
            onDoubleClick={() => cb.cellDoubleClick(rowIndex, col.name)}
            onContextMenu={(e) => cb.cellContextMenu(e, { row: rowIndex, col: ci })}
          >
            <CellContent
              value={value}
              kind={kinds[ci]}
              hasFk={Boolean(col.fk) && hasFkHandler}
              onDetail={hasDetailHandler ? () => cb.openDetail({ row: rowIndex, col: ci }) : undefined}
              onFk={hasFkHandler && col.fk ? () => cb.fkClick(col.name, value, rowIndex) : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}, (prev, next) => (
  prev.row === next.row
  && prev.rowIndex === next.rowIndex
  && prev.columns === next.columns
  && prev.widths === next.widths
  && prev.pinnedLefts === next.pinnedLefts
  && prev.selSig === next.selSig
  && prev.dirtySig === next.dirtySig
  && prev.rowHeight === next.rowHeight
  && prev.hasDetailHandler === next.hasDetailHandler
  && prev.hasFkHandler === next.hasFkHandler
));

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export const DataGrid = forwardRef<DataGridHandle, DataGridProps>(function DataGrid(props, ref) {
  const {
    columns, rows, totalRows, hasMore, loadingMore, onLoadMore,
    sortState, onSortChange,
    onOpenDetail, onRowDoubleClick, onCellContextMenu,
    headerFilterRender, onFkClick, onSelectedRowsChange,
    editable, isColumnEditable, onPendingCountChange,
    rowHeight = DEFAULT_ROW_HEIGHT,
    storageKey, statusExtra, showStatusBar = true,
    className, emptyText = '暂无数据',
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── 列状态：隐藏 + 宽度（storageKey 持久化） ──
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const estimatedRef = useRef(false);
  const columnsKey = useMemo(() => columns.map((c) => c.name).join('\u0001'), [columns]);

  useEffect(() => {
    estimatedRef.current = false;
    const stored = loadStored(storageKey);
    setHiddenColumns(new Set(stored?.hidden ?? []));
    if (stored?.widths && Object.keys(stored.widths).length > 0) {
      setColWidths(stored.widths);
      estimatedRef.current = true;
    } else {
      setColWidths({});
    }
  }, [storageKey, columnsKey]);

  useEffect(() => {
    if (estimatedRef.current) return;
    if (columns.length === 0) return;
    setColWidths(estimateColumnWidths(columns, rows));
    if (rows.length > 0) estimatedRef.current = true;
  }, [columns, rows]);

  const persistColState = useCallback((widths: Record<string, number>, hidden: Set<string>) => {
    saveStored(storageKey, { widths, hidden: Array.from(hidden) });
  }, [storageKey]);

  // ── 可见列：pinned 优先 ──
  const visibleColumns = useMemo(() => {
    const shown = columns.filter((c) => !hiddenColumns.has(c.name));
    const pinned = shown.filter((c) => c.pinned);
    const normal = shown.filter((c) => !c.pinned);
    return [...pinned, ...normal];
  }, [columns, hiddenColumns]);

  const kinds = useMemo(
    () => visibleColumns.map((c) => columnKind(c.dataType)),
    [visibleColumns],
  );

  const widths = useMemo(
    () => visibleColumns.map((c) => Math.round(colWidths[c.name] ?? DEFAULT_COL_WIDTH)),
    [visibleColumns, colWidths],
  );

  /** 各列左偏移（含行号列）；pinned 列的 sticky left */
  const { colOffsets, pinnedLefts, pinnedTotalWidth } = useMemo(() => {
    const offsets: number[] = [];
    const lefts: Array<number | undefined> = [];
    let x = ROW_NUMBER_WIDTH;
    let pinnedW = ROW_NUMBER_WIDTH;
    for (let i = 0; i < visibleColumns.length; i++) {
      offsets.push(x);
      if (visibleColumns[i].pinned) {
        lefts.push(pinnedW);
        pinnedW += widths[i];
      } else {
        lefts.push(undefined);
      }
      x += widths[i];
    }
    return { colOffsets: offsets, pinnedLefts: lefts, pinnedTotalWidth: pinnedW };
  }, [visibleColumns, widths]);

  const visibleColCountRef = useRef(visibleColumns.length);
  visibleColCountRef.current = visibleColumns.length;
  const visibleColumnsRef = useRef(visibleColumns);
  visibleColumnsRef.current = visibleColumns;

  // ── 选区 ──
  const [selection, dispatchSel] = useReducer(selectionReducer, EMPTY_SELECTION, () => ({ ...EMPTY_SELECTION }));
  const selectionRef = useRef<SelectionState>(selection);
  selectionRef.current = selection;
  const draggingRef = useRef(false);

  useEffect(() => {
    const stop = () => { draggingRef.current = false; };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  // 数据源变化（换表 / 重新筛选导致行数收缩）时清空选区
  const prevRowsRef = useRef(rows);
  useEffect(() => {
    if (prevRowsRef.current !== rows && rows.length < prevRowsRef.current.length) {
      dispatchSel({ type: 'clear' });
    }
    prevRowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    dispatchSel({ type: 'clear' });
  }, [columnsKey, storageKey]);

  // 行选择同步到外部
  const onSelectedRowsChangeRef = useRef(onSelectedRowsChange);
  onSelectedRowsChangeRef.current = onSelectedRowsChange;
  useEffect(() => {
    onSelectedRowsChangeRef.current?.(new Set(selection.rows));
  }, [selection.rows]);

  // ── 内联编辑：暂存层 + 编辑态 ──
  const pkColumns = useMemo(
    () => columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
    [columns],
  );
  const gridEditor = useGridEditor({ pkColumns, onPendingCountChange });
  const [editing, setEditing] = useState<{ pos: CellPos; initialText?: string } | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // 换表时清空暂存与编辑态
  useEffect(() => {
    gridEditor.discardAll();
    setEditing(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnsKey, storageKey]);

  // 数据重载时关闭编辑器（滚动加载的纯追加不打断编辑）
  const prevRowsForEditRef = useRef(rows);
  useEffect(() => {
    const prev = prevRowsForEditRef.current;
    prevRowsForEditRef.current = rows;
    if (prev === rows) return;
    const isAppend = rows.length >= prev.length
      && prev.length > 0
      && rows[0] === prev[0]
      && rows[prev.length - 1] === prev[prev.length - 1];
    if (!isAppend) setEditing(null);
  }, [rows]);

  /** 应用暂存后的有效行（干净行保持引用）：渲染与复制统一使用 */
  const effectiveRows = useMemo(
    () => gridEditor.effectiveRows(rows),
    // gridEditor.pending 驱动重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, gridEditor.pending],
  );
  const effectiveRowsRef = useRef(effectiveRows);
  effectiveRowsRef.current = effectiveRows;

  const canEditColumn = useCallback((col: DataGridColumn | undefined): boolean => {
    if (!editable || !col || pkColumns.length === 0) return false;
    if (isColumnEditable) return isColumnEditable(col);
    return !col.isPrimaryKey;
  }, [editable, pkColumns, isColumnEditable]);

  // ── 虚拟滚动 ──
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  // 滚近底部加载更多
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;
  const lastVisibleIndex = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;
  useEffect(() => {
    if (!hasMore || loadingMore || rows.length === 0) return;
    if (lastVisibleIndex >= rows.length - LOAD_MORE_THRESHOLD) {
      onLoadMoreRef.current?.();
    }
  }, [lastVisibleIndex, hasMore, loadingMore, rows.length]);

  // ── 滚动定位 ──
  const ensureCellVisible = useCallback((pos: CellPos) => {
    rowVirtualizer.scrollToIndex(pos.row);
    const el = scrollRef.current;
    if (!el) return;
    if (visibleColumns[pos.col]?.pinned) return;
    const left = colOffsets[pos.col];
    const right = left + (widths[pos.col] ?? DEFAULT_COL_WIDTH);
    const viewLeft = el.scrollLeft + pinnedTotalWidth;
    const viewRight = el.scrollLeft + el.clientWidth;
    if (left < viewLeft) el.scrollLeft = Math.max(0, left - pinnedTotalWidth);
    else if (right > viewRight) el.scrollLeft = right - el.clientWidth;
  }, [rowVirtualizer, visibleColumns, colOffsets, widths, pinnedTotalWidth]);

  // ── 复制 ──
  const doCopySelection = useCallback(async (): Promise<boolean> => {
    const snap = buildSelectionSnapshot(selectionRef.current, visibleColumns.length);
    if (snap.cellCount === 0) return false;
    if (snap.cellCount > COPY_CONFIRM_THRESHOLD) {
      Toast.warning('选区过大，请缩小选择范围后复制');
      return false;
    }
    const text = snapshotToTsv({ snapshot: snap, rows: effectiveRowsRef.current, columns: visibleColumns });
    const ok = await writeClipboard(text);
    if (ok) Toast.success(`已复制 ${snap.cellCount} 个单元格`);
    else Toast.warning('复制失败');
    return ok;
  }, [visibleColumns]);

  // ── 编辑生命周期 ──
  const canEditColumnRef = useRef(canEditColumn);
  canEditColumnRef.current = canEditColumn;

  const startEdit = useCallback((pos: CellPos, initialText?: string): boolean => {
    const col = visibleColumnsRef.current[pos.col];
    if (!canEditColumnRef.current(col)) return false;
    if (!rowsRef.current[pos.row]) return false;
    ensureCellVisible(pos);
    dispatchSel({ type: 'moveTo', pos, shift: false });
    setEditing({ pos, initialText });
    return true;
  }, [ensureCellVisible]);

  const finishEdit = useCallback((move: CommitMove) => {
    setEditing(null);
    const el = scrollRef.current;
    el?.focus({ preventScroll: true });
    if (move === 'none') return;
    const cur = selectionRef.current.anchor;
    if (!cur) return;
    const next: CellPos = move === 'down'
      ? { row: Math.min(cur.row + 1, rowsRef.current.length - 1), col: cur.col }
      : { row: cur.row, col: Math.min(cur.col + 1, visibleColCountRef.current - 1) };
    dispatchSel({ type: 'moveTo', pos: next, shift: false });
    ensureCellVisible(next);
  }, [ensureCellVisible]);

  const handleEditorCommit = useCallback((value: unknown, move: CommitMove) => {
    const cur = editingRef.current;
    if (cur) {
      const col = visibleColumnsRef.current[cur.pos.col];
      const row = rowsRef.current[cur.pos.row];
      if (col && row) gridEditor.stageCell(row, col.name, value);
    }
    finishEdit(move);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishEdit]);

  const handleEditorCancel = useCallback(() => {
    finishEdit('none');
  }, [finishEdit]);

  // ── 键盘 ──
  const handleKeyDown = useGridKeyboard({
    rowCount: rows.length,
    colCount: visibleColumns.length,
    state: selection,
    dispatch: dispatchSel,
    ensureCellVisible,
    visibleRowCount: () => {
      const el = scrollRef.current;
      return el ? Math.max(1, Math.floor(el.clientHeight / rowHeight) - 1) : 20;
    },
    onCopy: () => { void doCopySelection(); },
    onOpenDetail,
    isEditing: () => editingRef.current !== null,
    onStartEdit: startEdit,
  });

  // ── 行内回调（stable） ──
  const onOpenDetailRef = useRef(onOpenDetail);
  onOpenDetailRef.current = onOpenDetail;
  const onRowDoubleClickRef = useRef(onRowDoubleClick);
  onRowDoubleClickRef.current = onRowDoubleClick;
  const onCellContextMenuRef = useRef(onCellContextMenu);
  onCellContextMenuRef.current = onCellContextMenu;
  const onFkClickRef = useRef(onFkClick);
  onFkClickRef.current = onFkClick;
  const startEditRef = useRef(startEdit);
  startEditRef.current = startEdit;

  const rowCallbacks = useMemo<RowCallbacks>(() => ({
    cellMouseDown: (pos, shift, ctrl) => {
      // 点击其他单元格时关闭未提交的编辑器（单行编辑器已先经 blur 提交）
      if (editingRef.current) setEditing(null);
      scrollRef.current?.focus({ preventScroll: true });
      draggingRef.current = !shift && !ctrl;
      dispatchSel({ type: 'cellMouseDown', pos, shift, ctrl });
    },
    cellDragOver: (pos) => {
      if (draggingRef.current) dispatchSel({ type: 'cellDragOver', pos });
    },
    cellDoubleClick: (rowIndex, columnName) => {
      // 可编辑列：双击进入内联编辑；否则交给外部（详情等）
      const colIdx = visibleColumnsRef.current.findIndex((c) => c.name === columnName);
      if (colIdx >= 0 && startEditRef.current({ row: rowIndex, col: colIdx })) return;
      onRowDoubleClickRef.current?.(rowIndex, columnName);
    },
    cellContextMenu: (e, pos) => {
      const handler = onCellContextMenuRef.current;
      if (!handler) return;
      e.preventDefault();
      scrollRef.current?.focus({ preventScroll: true });
      // 同步计算 ensure 后的选区快照，避免 setState 异步导致菜单读到旧选区
      const nextState = selectionReducer(selectionRef.current, { type: 'ensureCellSelected', pos });
      dispatchSel({ type: 'ensureCellSelected', pos });
      handler(e, pos, buildSelectionSnapshot(nextState, visibleColCountRef.current));
    },
    rowNumMouseDown: (row, shift, ctrl) => {
      if (editingRef.current) setEditing(null);
      scrollRef.current?.focus({ preventScroll: true });
      dispatchSel({ type: 'rowClick', row, shift, ctrl });
    },
    rowNumContextMenu: (e, row) => {
      const handler = onCellContextMenuRef.current;
      if (!handler) return;
      e.preventDefault();
      let st = selectionRef.current;
      if (!st.rows.has(row)) {
        st = selectionReducer(st, { type: 'rowClick', row, shift: false, ctrl: false });
        dispatchSel({ type: 'rowClick', row, shift: false, ctrl: false });
      }
      handler(e, { row, col: 0 }, buildSelectionSnapshot(st, visibleColCountRef.current));
    },
    openDetail: (pos) => {
      dispatchSel({ type: 'moveTo', pos, shift: false });
      onOpenDetailRef.current?.(pos);
    },
    fkClick: (columnName, value, rowIndex) => {
      onFkClickRef.current?.(columnName, value, rowIndex);
    },
  }), []);

  // ── 列宽拖拽 ──
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const resizeRef = useRef<{ name: string; startX: number; startW: number } | null>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { name, startX: e.clientX, startW: colWidths[name] ?? DEFAULT_COL_WIDTH };
    setResizingCol(name);

    const onMove = (me: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const w = Math.max(COL_MIN_WIDTH, r.startW + (me.clientX - r.startX));
      setColWidths((prev) => ({ ...prev, [r.name]: w }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      resizeRef.current = null;
      setResizingCol(null);
      setColWidths((prev) => {
        persistColState(prev, hiddenColumns);
        return prev;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [colWidths, hiddenColumns, persistColState]);

  const handleAutoFit = useCallback((name: string) => {
    const col = columns.find((c) => c.name === name);
    if (!col) return;
    const est = estimateColumnWidths([col], rows.slice(0, 200))[name];
    setColWidths((prev) => {
      const next = { ...prev, [name]: est };
      persistColState(next, hiddenColumns);
      return next;
    });
  }, [columns, rows, hiddenColumns, persistColState]);

  // ── 排序 ──
  const handleHeaderClick = useCallback((name: string) => {
    if (!onSortChange) return;
    if (sortState?.column === name) {
      if (sortState.dir === 'asc') onSortChange({ column: name, dir: 'desc' });
      else onSortChange(null);
    } else {
      onSortChange({ column: name, dir: 'asc' });
    }
  }, [sortState, onSortChange]);

  // ── 列设置 ──
  const handleToggleColumn = useCallback((name: string, visible: boolean) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(name);
      else next.add(name);
      persistColState(colWidths, next);
      return next;
    });
  }, [colWidths, persistColState]);

  const handleResetColumns = useCallback(() => {
    setHiddenColumns(new Set());
    const est = estimateColumnWidths(columns, rows);
    setColWidths(est);
    if (storageKey) {
      try { localStorage.removeItem(`dg:${storageKey}`); } catch { /* ignore */ }
    }
  }, [columns, rows, storageKey]);

  // ── 对外句柄 ──
  useImperativeHandle(ref, () => ({
    getSelectionSnapshot: (): SelectionSnapshot =>
      buildSelectionSnapshot(selectionRef.current, visibleColCountRef.current),
    getVisibleColumns: () => visibleColumnsRef.current,
    clearSelection: () => dispatchSel({ type: 'clear' }),
    scrollToTop: () => { scrollRef.current?.scrollTo({ top: 0 }); },
    copySelection: doCopySelection,
    getPendingUpdates: () => gridEditor.getUpdates(),
    discardPending: () => {
      gridEditor.discardAll();
      setEditing(null);
    },
    stageCellValue: (rowIndex: number, columnName: string, value: unknown) => {
      const row = rowsRef.current[rowIndex];
      if (row) gridEditor.stageCell(row, columnName, value);
    },
    getEffectiveRows: () => effectiveRowsRef.current,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [doCopySelection]);

  // ── 渲染 ──
  const totalWidth = pinnedTotalWidth + widths.reduce(
    (sum, w, i) => (visibleColumns[i].pinned ? sum : sum + w),
    0,
  );
  const bodyHeight = rowVirtualizer.getTotalSize() + (loadingMore ? 36 : 0);

  return (
    <div className={`dg-root${className ? ` ${className}` : ''}`}>
      <div
        ref={scrollRef}
        className="dg-scroll"
        tabIndex={0}
        role="grid"
        aria-rowcount={totalRows ?? rows.length}
        aria-colcount={visibleColumns.length}
        onKeyDown={handleKeyDown}
      >
        <div className="dg-header" style={{ width: totalWidth }}>
          <div
            className="dg-rownum"
            style={{ width: ROW_NUMBER_WIDTH, height: 34, cursor: 'pointer' }}
            title="全选"
            onClick={() => dispatchSel({ type: 'selectAll', rowCount: rows.length })}
          >
            #
          </div>
          {visibleColumns.map((col, ci) => {
            const sorted = sortState?.column === col.name ? sortState.dir : null;
            const pinned = pinnedLefts[ci] !== undefined;
            return (
              <div
                key={col.name}
                className={`dg-header-cell${pinned ? ' dg-header-cell--pinned' : ''}`}
                style={{ width: widths[ci], left: pinnedLefts[ci] }}
                title={col.comment ? `${col.name} · ${col.comment}` : col.name}
                onClick={() => handleHeaderClick(col.name)}
              >
                {col.isPrimaryKey && <KeyRound size={11} className="dg-pk-icon" />}
                {col.fk && <Link2 size={11} style={{ color: 'var(--semi-color-info)', flexShrink: 0 }} />}
                <span className="dg-header-cell__name">{col.name}</span>
                {col.dataType && (
                  <span className="dg-header-cell__type">{shortTypeName(col.dataType)}</span>
                )}
                <span className="dg-header-cell__icons" onClick={(e) => e.stopPropagation()}>
                  {sorted && (
                    <span className="dg-header-cell__sort" onClick={() => handleHeaderClick(col.name)}>
                      {sorted === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                    </span>
                  )}
                  {headerFilterRender?.(col)}
                </span>
                <span
                  className={`dg-resize-handle${resizingCol === col.name ? ' dg-resize-handle--active' : ''}`}
                  onMouseDown={(e) => handleResizeStart(e, col.name)}
                  onDoubleClick={(e) => { e.stopPropagation(); handleAutoFit(col.name); }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            );
          })}
        </div>

        {rows.length === 0 && !loadingMore ? (
          <div className="dg-empty">{emptyText}</div>
        ) : (
          <div className="dg-body" style={{ height: bodyHeight, width: totalWidth }}>
            {virtualItems.map((vi) => {
              const rawRow = rows[vi.index];
              const dirtyCols = gridEditor.dirtyColumnsOfRow(rawRow);
              return (
                <GridRow
                  key={vi.index}
                  rowIndex={vi.index}
                  row={effectiveRows[vi.index]}
                  columns={visibleColumns}
                  kinds={kinds}
                  widths={widths}
                  pinnedLefts={pinnedLefts}
                  rowHeight={rowHeight}
                  selSig={rowSelectionSignature(selection, vi.index, visibleColumns.length)}
                  dirtySig={dirtyCols ? Array.from(dirtyCols).sort((a, b) => a.localeCompare(b)).join('\u0001') : ''}
                  selectionRef={selectionRef}
                  hasDetailHandler={Boolean(onOpenDetail)}
                  hasFkHandler={Boolean(onFkClick)}
                  cb={rowCallbacks}
                />
              );
            })}
            {editing && (() => {
              const col = visibleColumns[editing.pos.col];
              const rawRow = rows[editing.pos.row];
              if (!col || !rawRow) return null;
              const pinned = pinnedLefts[editing.pos.col] !== undefined;
              const left = pinned
                ? (scrollRef.current?.scrollLeft ?? 0) + (pinnedLefts[editing.pos.col] ?? 0)
                : colOffsets[editing.pos.col];
              const entryValue = effectiveRows[editing.pos.row]?.[col.name];
              return (
                <CellEditorOverlay
                  key={`${editing.pos.row}:${col.name}`}
                  column={col}
                  kind={kinds[editing.pos.col]}
                  value={entryValue}
                  rect={{
                    left,
                    top: editing.pos.row * rowHeight,
                    width: widths[editing.pos.col],
                    height: rowHeight,
                  }}
                  initialText={editing.initialText}
                  onCommit={handleEditorCommit}
                  onCancel={handleEditorCancel}
                />
              );
            })()}
            {loadingMore && (
              <div className="dg-loadmore" style={{ top: rowVirtualizer.getTotalSize() }}>
                <Spin size="small" />
                <span>加载中…</span>
              </div>
            )}
          </div>
        )}
      </div>

      {showStatusBar && (
        <GridStatusBar
          loaded={rows.length}
          total={totalRows}
          hasMore={hasMore}
          loadingMore={loadingMore}
          selectedRowCount={selection.rows.size}
          selectedCellCount={selectionCellCount(selection, visibleColumns.length)}
          columns={columns}
          hiddenColumns={hiddenColumns}
          onToggleColumn={handleToggleColumn}
          onResetColumns={handleResetColumns}
          extra={statusExtra}
        />
      )}
    </div>
  );
});
