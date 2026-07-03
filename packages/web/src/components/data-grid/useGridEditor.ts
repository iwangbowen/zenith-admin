import { useCallback, useMemo, useRef, useState } from 'react';
import { valuesEqual } from './cell-coercion';

type Row = Record<string, unknown>;

/** 单行暂存变更（以主键定位，跨刷新/排序稳定） */
export interface PendingRowChange {
  pk: Record<string, unknown>;
  /** colName → 新值 */
  changes: Map<string, unknown>;
  /** colName → 首次暂存时的原值（用于等值回退与 SQL 预览） */
  originals: Map<string, unknown>;
}

export type PendingMap = Map<string, PendingRowChange>;

/** 暂存的新增行（客户端 id 定位，保存后由服务端生成真实主键） */
export interface NewRowDraft {
  clientId: number;
  values: Row;
}

/** 编辑器完整状态（undo/redo 快照单元） */
export interface EditorState {
  pending: PendingMap;
  newRows: NewRowDraft[];
  /** 已标记删除的行（pkKey） */
  deletedKeys: Set<string>;
}

export const EMPTY_EDITOR_STATE: EditorState = {
  pending: new Map(),
  newRows: [],
  deletedKeys: new Set(),
};

const MAX_HISTORY = 100;

export function pkKeyOf(pk: Record<string, unknown>, pkColumns: string[]): string {
  return JSON.stringify(pkColumns.map((c) => pk[c]));
}

export function pkOfRow(row: Row, pkColumns: string[]): Record<string, unknown> {
  const pk: Record<string, unknown> = {};
  for (const c of pkColumns) pk[c] = row[c];
  return pk;
}

/**
 * 纯函数：暂存一个单元格变更。
 * 新值与原值等价时撤销该格暂存；行内无剩余变更时移除整行。
 */
export function stagePendingCell(
  pending: PendingMap,
  row: Row,
  pkColumns: string[],
  columnName: string,
  newValue: unknown,
): PendingMap {
  if (pkColumns.length === 0) return pending;
  const pk = pkOfRow(row, pkColumns);
  const key = pkKeyOf(pk, pkColumns);
  const next = new Map(pending);
  const entry = next.get(key);
  const original = entry?.originals.has(columnName)
    ? entry.originals.get(columnName)
    : row[columnName];

  if (valuesEqual(newValue, original)) {
    if (!entry) return pending;
    const changes = new Map(entry.changes);
    const originals = new Map(entry.originals);
    changes.delete(columnName);
    originals.delete(columnName);
    if (changes.size === 0) next.delete(key);
    else next.set(key, { pk, changes, originals });
    return next;
  }

  const changes = new Map(entry?.changes ?? []);
  const originals = new Map(entry?.originals ?? []);
  if (!originals.has(columnName)) originals.set(columnName, row[columnName]);
  changes.set(columnName, newValue);
  next.set(key, { pk, changes, originals });
  return next;
}

/** 纯函数：统计暂存的单元格总数 */
export function pendingCellCount(pending: PendingMap): number {
  let n = 0;
  for (const entry of pending.values()) n += entry.changes.size;
  return n;
}

export interface PendingUpdateItem {
  pk: Record<string, unknown>;
  changes: Record<string, unknown>;
  originals: Record<string, unknown>;
}

/** 纯函数：修改暂存导出为 batch-mutate / SQL 预览所需结构 */
export function pendingToUpdates(pending: PendingMap): PendingUpdateItem[] {
  return Array.from(pending.values()).map((entry) => ({
    pk: entry.pk,
    changes: Object.fromEntries(entry.changes),
    originals: Object.fromEntries(entry.originals),
  }));
}

export interface EditorMutations {
  inserts: Row[];
  updates: PendingUpdateItem[];
  deletes: Array<{ pk: Record<string, unknown> }>;
}

/** 纯函数：完整状态导出为事务变更集（已删除行的 update 暂存自动剔除） */
export function editorMutations(state: EditorState, rows: Row[], pkColumns: string[]): EditorMutations {
  const updates = pendingToUpdates(state.pending).filter(
    (u) => !state.deletedKeys.has(pkKeyOf(u.pk, pkColumns)),
  );
  const deletes: Array<{ pk: Record<string, unknown> }> = [];
  if (state.deletedKeys.size > 0 && pkColumns.length > 0) {
    // 从当前行集恢复 pk 值（deletedKeys 只是 key，需要行数据映射回对象）
    const seen = new Set<string>();
    for (const row of rows) {
      const pk = pkOfRow(row, pkColumns);
      const key = pkKeyOf(pk, pkColumns);
      if (state.deletedKeys.has(key) && !seen.has(key)) {
        seen.add(key);
        deletes.push({ pk });
      }
    }
  }
  const inserts = state.newRows
    .map((d) => Object.fromEntries(Object.entries(d.values).filter(([, v]) => v !== undefined)))
    .filter((values) => Object.keys(values).length > 0);
  return { inserts, updates, deletes };
}

/** 纯函数：变更计数（供操作条展示） */
export function editorCounts(state: EditorState): { modified: number; added: number; deleted: number; total: number } {
  const modified = pendingCellCount(state.pending);
  const added = state.newRows.length;
  const deleted = state.deletedKeys.size;
  return { modified, added, deleted, total: modified + added + deleted };
}

// ─── 状态迁移纯函数（全部返回新 state；无变化返回原引用） ──────────────────────

export function stateStageCell(
  state: EditorState, row: Row, pkColumns: string[], columnName: string, newValue: unknown,
): EditorState {
  const pending = stagePendingCell(state.pending, row, pkColumns, columnName, newValue);
  if (pending === state.pending) return state;
  return { ...state, pending };
}

export function stateToggleDeleteRows(
  state: EditorState, rows: Row[], pkColumns: string[], deleted: boolean,
): EditorState {
  if (pkColumns.length === 0 || rows.length === 0) return state;
  const next = new Set(state.deletedKeys);
  let changed = false;
  for (const row of rows) {
    const key = pkKeyOf(pkOfRow(row, pkColumns), pkColumns);
    if (deleted && !next.has(key)) { next.add(key); changed = true; }
    else if (!deleted && next.has(key)) { next.delete(key); changed = true; }
  }
  if (!changed) return state;
  return { ...state, deletedKeys: next };
}

export function stateAddNewRow(state: EditorState, clientId: number, initial: Row = {}): EditorState {
  return { ...state, newRows: [...state.newRows, { clientId, values: { ...initial } }] };
}

export function stateUpdateNewRowCell(
  state: EditorState, clientId: number, columnName: string, value: unknown,
): EditorState {
  const idx = state.newRows.findIndex((d) => d.clientId === clientId);
  if (idx === -1) return state;
  const draft = state.newRows[idx];
  if (valuesEqual(draft.values[columnName], value)) return state;
  const newRows = [...state.newRows];
  newRows[idx] = { ...draft, values: { ...draft.values, [columnName]: value } };
  return { ...state, newRows };
}

export function stateRemoveNewRows(state: EditorState, clientIds: number[]): EditorState {
  if (clientIds.length === 0) return state;
  const ids = new Set(clientIds);
  const newRows = state.newRows.filter((d) => !ids.has(d.clientId));
  if (newRows.length === state.newRows.length) return state;
  return { ...state, newRows };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseGridEditorOptions {
  pkColumns: string[];
  onCountsChange?: (counts: { modified: number; added: number; deleted: number; total: number }) => void;
}

/**
 * 内联编辑暂存层：修改（PK 定位）/ 新增（clientId 定位）/ 删除标记，
 * 带 undo/redo 快照栈（最多 100），供 DataGrid 内部使用。
 */
export function useGridEditor(options: UseGridEditorOptions) {
  const { pkColumns, onCountsChange } = options;
  const [state, setState] = useState<EditorState>(EMPTY_EDITOR_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const undoStackRef = useRef<EditorState[]>([]);
  const redoStackRef = useRef<EditorState[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const clientIdSeqRef = useRef(1);
  const notifyRef = useRef(onCountsChange);
  notifyRef.current = onCountsChange;
  const pkColumnsRef = useRef(pkColumns);
  pkColumnsRef.current = pkColumns;

  const commit = useCallback((next: EditorState, recordHistory = true) => {
    if (next === stateRef.current) return;
    if (recordHistory) {
      undoStackRef.current.push(stateRef.current);
      if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift();
      redoStackRef.current = [];
    }
    // 同步更新 ref：支持同一事件循环内连续多次暂存（如批量粘贴）
    stateRef.current = next;
    setState(next);
    setHistoryVersion((v) => v + 1);
    notifyRef.current?.(editorCounts(next));
  }, []);

  const stageCell = useCallback((row: Row, columnName: string, newValue: unknown) => {
    commit(stateStageCell(stateRef.current, row, pkColumnsRef.current, columnName, newValue));
  }, [commit]);

  /** 批量暂存（粘贴等场景）：多格变更合并为一个 undo 快照 */
  const stageCellsBatch = useCallback((items: Array<
    { kind: 'existing'; row: Row; columnName: string; value: unknown }
    | { kind: 'new'; clientId: number; columnName: string; value: unknown }
  >) => {
    let next = stateRef.current;
    for (const item of items) {
      next = item.kind === 'existing'
        ? stateStageCell(next, item.row, pkColumnsRef.current, item.columnName, item.value)
        : stateUpdateNewRowCell(next, item.clientId, item.columnName, item.value);
    }
    commit(next);
  }, [commit]);

  const stageDeleteRows = useCallback((rows: Row[]) => {
    commit(stateToggleDeleteRows(stateRef.current, rows, pkColumnsRef.current, true));
  }, [commit]);

  const unstageDeleteRows = useCallback((rows: Row[]) => {
    commit(stateToggleDeleteRows(stateRef.current, rows, pkColumnsRef.current, false));
  }, [commit]);

  const addNewRow = useCallback((initial: Row = {}): number => {
    const clientId = clientIdSeqRef.current++;
    commit(stateAddNewRow(stateRef.current, clientId, initial));
    return clientId;
  }, [commit]);

  const updateNewRowCell = useCallback((clientId: number, columnName: string, value: unknown) => {
    commit(stateUpdateNewRowCell(stateRef.current, clientId, columnName, value));
  }, [commit]);

  const removeNewRows = useCallback((clientIds: number[]) => {
    commit(stateRemoveNewRows(stateRef.current, clientIds));
  }, [commit]);

  const undo = useCallback((): boolean => {
    const prev = undoStackRef.current.pop();
    if (!prev) return false;
    redoStackRef.current.push(stateRef.current);
    stateRef.current = prev;
    setState(prev);
    setHistoryVersion((v) => v + 1);
    notifyRef.current?.(editorCounts(prev));
    return true;
  }, []);

  const redo = useCallback((): boolean => {
    const next = redoStackRef.current.pop();
    if (!next) return false;
    undoStackRef.current.push(stateRef.current);
    stateRef.current = next;
    setState(next);
    setHistoryVersion((v) => v + 1);
    notifyRef.current?.(editorCounts(next));
    return true;
  }, []);

  const discardAll = useCallback(() => {
    if (stateRef.current === EMPTY_EDITOR_STATE && undoStackRef.current.length === 0) return;
    undoStackRef.current = [];
    redoStackRef.current = [];
    stateRef.current = EMPTY_EDITOR_STATE;
    setState(EMPTY_EDITOR_STATE);
    setHistoryVersion((v) => v + 1);
    notifyRef.current?.(editorCounts(EMPTY_EDITOR_STATE));
  }, []);

  const entryForRow = useCallback((row: Row): PendingRowChange | undefined => {
    if (pkColumnsRef.current.length === 0 || stateRef.current.pending.size === 0) return undefined;
    return stateRef.current.pending.get(pkKeyOf(pkOfRow(row, pkColumnsRef.current), pkColumnsRef.current));
  }, []);

  /** 应用暂存后的有效行（干净行保持引用不变，天然兼容行级 memo） */
  const effectiveRows = useCallback((rows: Row[]): Row[] => {
    if (stateRef.current.pending.size === 0) return rows;
    return rows.map((row) => {
      const entry = entryForRow(row);
      if (!entry || entry.changes.size === 0) return row;
      return { ...row, ...Object.fromEntries(entry.changes) };
    });
  }, [entryForRow]);

  const dirtyColumnsOfRow = useCallback((row: Row): Set<string> | undefined => {
    const entry = entryForRow(row);
    if (!entry || entry.changes.size === 0) return undefined;
    return new Set(entry.changes.keys());
  }, [entryForRow]);

  const isRowDeleted = useCallback((row: Row): boolean => {
    if (stateRef.current.deletedKeys.size === 0 || pkColumnsRef.current.length === 0) return false;
    return stateRef.current.deletedKeys.has(pkKeyOf(pkOfRow(row, pkColumnsRef.current), pkColumnsRef.current));
  }, []);

  const counts = useMemo(() => editorCounts(state), [state]);
  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;
  void historyVersion;

  return {
    state,
    counts,
    canUndo,
    canRedo,
    stageCell,
    stageCellsBatch,
    stageDeleteRows,
    unstageDeleteRows,
    addNewRow,
    updateNewRowCell,
    removeNewRows,
    undo,
    redo,
    discardAll,
    effectiveRows,
    dirtyColumnsOfRow,
    isRowDeleted,
    getMutations: useCallback(
      (rows: Row[]) => editorMutations(stateRef.current, rows, pkColumnsRef.current),
      [],
    ),
  };
}
