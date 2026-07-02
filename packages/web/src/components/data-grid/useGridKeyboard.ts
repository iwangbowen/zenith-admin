import type React from 'react';
import { useCallback } from 'react';
import type { CellPos, SelectionAction, SelectionState } from './types';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

interface KeyboardOptions {
  rowCount: number;
  colCount: number;
  state: SelectionState;
  dispatch: React.Dispatch<SelectionAction>;
  ensureCellVisible: (pos: CellPos) => void;
  /** 当前视口可见行数（PageUp/Down 步长） */
  visibleRowCount: () => number;
  onCopy: () => void;
  onOpenDetail?: (pos: CellPos) => void;
  /** 正在内联编辑时跳过网格快捷键（编辑器自行处理按键） */
  isEditing?: () => boolean;
  /** 尝试进入编辑（Enter / F2 / 直接打字）；返回 true 表示已进入编辑 */
  onStartEdit?: (pos: CellPos, initialText?: string) => boolean;
}

/** 网格键盘交互：方向键导航 / Shift 扩选 / Ctrl+C / Ctrl+A / Enter 编辑或详情 / Esc 清除 */
export function useGridKeyboard(opts: KeyboardOptions): (e: React.KeyboardEvent) => void {
  const {
    rowCount, colCount, state, dispatch, ensureCellVisible,
    visibleRowCount, onCopy, onOpenDetail, isEditing, onStartEdit,
  } = opts;

  return useCallback((e: React.KeyboardEvent) => {
    if (rowCount === 0 || colCount === 0) return;
    if (isEditing?.()) return;
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      onCopy();
      return;
    }
    if (ctrl && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      dispatch({ type: 'selectAll', rowCount });
      return;
    }
    if (e.key === 'Escape') {
      dispatch({ type: 'clear' });
      return;
    }
    if (e.key === 'Enter') {
      if (!state.anchor) return;
      e.preventDefault();
      // Enter 优先进入编辑；Shift+Enter 或不可编辑时打开详情
      if (!e.shiftKey && onStartEdit?.(state.anchor)) return;
      onOpenDetail?.(state.anchor);
      return;
    }
    if (e.key === 'F2') {
      if (state.anchor && onStartEdit?.(state.anchor)) e.preventDefault();
      return;
    }
    // 直接打字进入编辑并替换内容（Excel/dbx 风格）
    if (e.key.length === 1 && !ctrl && !e.altKey) {
      if (state.anchor && onStartEdit?.(state.anchor, e.key)) e.preventDefault();
      return;
    }

    const base = (e.shiftKey ? state.focus : state.anchor) ?? state.anchor;
    let target: CellPos;

    switch (e.key) {
      case 'ArrowUp':
        target = base ? { row: base.row - 1, col: base.col } : { row: 0, col: 0 };
        break;
      case 'ArrowDown':
        target = base ? { row: base.row + 1, col: base.col } : { row: 0, col: 0 };
        break;
      case 'ArrowLeft':
        target = base ? { row: base.row, col: base.col - 1 } : { row: 0, col: 0 };
        break;
      case 'ArrowRight':
        target = base ? { row: base.row, col: base.col + 1 } : { row: 0, col: 0 };
        break;
      case 'PageUp':
        target = base ? { row: base.row - visibleRowCount(), col: base.col } : { row: 0, col: 0 };
        break;
      case 'PageDown':
        target = base ? { row: base.row + visibleRowCount(), col: base.col } : { row: 0, col: 0 };
        break;
      case 'Home':
        target = ctrl ? { row: 0, col: 0 } : (base ? { row: base.row, col: 0 } : { row: 0, col: 0 });
        break;
      case 'End':
        target = ctrl
          ? { row: rowCount - 1, col: colCount - 1 }
          : (base ? { row: base.row, col: colCount - 1 } : { row: 0, col: colCount - 1 });
        break;
      default:
        return;
    }

    e.preventDefault();
    const pos: CellPos = {
      row: clamp(target.row, 0, rowCount - 1),
      col: clamp(target.col, 0, colCount - 1),
    };
    dispatch({ type: 'moveTo', pos, shift: e.shiftKey });
    ensureCellVisible(pos);
  }, [rowCount, colCount, state, dispatch, ensureCellVisible, visibleRowCount, onCopy, onOpenDetail, isEditing, onStartEdit]);
}
