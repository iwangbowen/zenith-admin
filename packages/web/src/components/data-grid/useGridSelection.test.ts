import { describe, expect, it } from 'vitest';
import type { CellPos, SelectionState } from './types';
import {
  EMPTY_SELECTION,
  buildSelectionSnapshot,
} from './useGridSelection';

function fresh(): SelectionState {
  return { ...EMPTY_SELECTION, discrete: new Set(), rows: new Set() };
}

const pos = (row: number, col: number): CellPos => ({ row, col });

describe('buildSelectionSnapshot', () => {
  it('rows 模式导出整行所有列', () => {
    const s = { ...fresh(), rows: new Set([3, 1]) };
    const snap = buildSelectionSnapshot(s, 3);
    expect(snap.mode).toBe('rows');
    expect(snap.rowIndexes).toEqual([1, 3]);
    expect(snap.matrix[0]).toEqual([pos(1, 0), pos(1, 1), pos(1, 2)]);
    expect(snap.cellCount).toBe(6);
  });

  it('矩形区域导出有序矩阵', () => {
    const s = { ...fresh(), anchor: pos(2, 2), focus: pos(0, 1) };
    const snap = buildSelectionSnapshot(s, 5);
    expect(snap.mode).toBe('cells');
    expect(snap.rowIndexes).toEqual([0, 1, 2]);
    expect(snap.matrix[0]).toEqual([pos(0, 1), pos(0, 2)]);
    expect(snap.cellCount).toBe(6);
  });

  it('离散模式按行列排序', () => {
    const s = { ...fresh(), discrete: new Set(['4:2', '1:3', '1:0']) };
    const snap = buildSelectionSnapshot(s, 5);
    expect(snap.rowIndexes).toEqual([1, 4]);
    expect(snap.matrix[0]).toEqual([pos(1, 0), pos(1, 3)]);
    expect(snap.matrix[1]).toEqual([pos(4, 2)]);
  });

  it('空选区返回 none', () => {
    const snap = buildSelectionSnapshot(fresh(), 3);
    expect(snap.mode).toBe('none');
    expect(snap.cellCount).toBe(0);
  });
});
