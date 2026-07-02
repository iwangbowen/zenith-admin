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

/** 纯函数：导出为 batch-mutate API / SQL 预览所需结构 */
export function pendingToUpdates(pending: PendingMap): PendingUpdateItem[] {
  return Array.from(pending.values()).map((entry) => ({
    pk: entry.pk,
    changes: Object.fromEntries(entry.changes),
    originals: Object.fromEntries(entry.originals),
  }));
}

interface UseGridEditorOptions {
  pkColumns: string[];
  onPendingCountChange?: (count: number) => void;
}

/** 内联编辑暂存层：dirty 单元格集中管理（PK 定位），供 DataGrid 内部使用 */
export function useGridEditor(options: UseGridEditorOptions) {
  const { pkColumns, onPendingCountChange } = options;
  const [pending, setPending] = useState<PendingMap>(new Map());
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const notifyRef = useRef(onPendingCountChange);
  notifyRef.current = onPendingCountChange;
  const pkColumnsRef = useRef(pkColumns);
  pkColumnsRef.current = pkColumns;

  const applyPending = useCallback((next: PendingMap) => {
    if (next === pendingRef.current) return;
    setPending(next);
    notifyRef.current?.(pendingCellCount(next));
  }, []);

  const stageCell = useCallback((row: Row, columnName: string, newValue: unknown) => {
    applyPending(stagePendingCell(pendingRef.current, row, pkColumnsRef.current, columnName, newValue));
  }, [applyPending]);

  const discardAll = useCallback(() => {
    if (pendingRef.current.size === 0) return;
    applyPending(new Map());
  }, [applyPending]);

  const entryForRow = useCallback((row: Row): PendingRowChange | undefined => {
    if (pkColumnsRef.current.length === 0 || pendingRef.current.size === 0) return undefined;
    return pendingRef.current.get(pkKeyOf(pkOfRow(row, pkColumnsRef.current), pkColumnsRef.current));
  }, []);

  /** 应用暂存后的有效行（干净行保持引用不变，天然兼容行级 memo） */
  const effectiveRows = useCallback((rows: Row[]): Row[] => {
    if (pendingRef.current.size === 0) return rows;
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

  const count = useMemo(() => pendingCellCount(pending), [pending]);

  return {
    pending,
    count,
    stageCell,
    discardAll,
    effectiveRows,
    dirtyColumnsOfRow,
    getUpdates: useCallback(() => pendingToUpdates(pendingRef.current), []),
  };
}
