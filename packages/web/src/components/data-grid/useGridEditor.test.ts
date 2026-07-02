import { describe, expect, it } from 'vitest';
import {
  pendingCellCount,
  pendingToUpdates,
  pkKeyOf,
  pkOfRow,
  stagePendingCell,
  type PendingMap,
} from './useGridEditor';

const PK = ['id'];
const row1 = { id: 1, name: 'Alice', age: 30 };
const row2 = { id: 2, name: 'Bob', age: 25 };

describe('stagePendingCell', () => {
  it('暂存新值并记录原值', () => {
    const p = stagePendingCell(new Map(), row1, PK, 'name', 'Alicia');
    expect(pendingCellCount(p)).toBe(1);
    const entry = p.get(pkKeyOf(pkOfRow(row1, PK), PK))!;
    expect(entry.changes.get('name')).toBe('Alicia');
    expect(entry.originals.get('name')).toBe('Alice');
    expect(entry.pk).toEqual({ id: 1 });
  });

  it('同一格再次编辑回原值 → 撤销暂存', () => {
    let p: PendingMap = stagePendingCell(new Map(), row1, PK, 'name', 'Alicia');
    p = stagePendingCell(p, row1, PK, 'name', 'Alice');
    expect(pendingCellCount(p)).toBe(0);
    expect(p.size).toBe(0);
  });

  it('多行多列独立累积', () => {
    let p: PendingMap = new Map();
    p = stagePendingCell(p, row1, PK, 'name', 'X');
    p = stagePendingCell(p, row1, PK, 'age', 31);
    p = stagePendingCell(p, row2, PK, 'name', 'Y');
    expect(pendingCellCount(p)).toBe(3);
    expect(p.size).toBe(2);
  });

  it('行内一列回退仅移除该列，保留其他列', () => {
    let p: PendingMap = new Map();
    p = stagePendingCell(p, row1, PK, 'name', 'X');
    p = stagePendingCell(p, row1, PK, 'age', 31);
    p = stagePendingCell(p, row1, PK, 'name', 'Alice');
    expect(pendingCellCount(p)).toBe(1);
    const entry = p.get(pkKeyOf({ id: 1 }, PK))!;
    expect(entry.changes.has('name')).toBe(false);
    expect(entry.changes.get('age')).toBe(31);
  });

  it('二次编辑同格保留首个原值（与原值比较基于首次快照）', () => {
    let p: PendingMap = new Map();
    p = stagePendingCell(p, row1, PK, 'name', 'X');
    p = stagePendingCell(p, row1, PK, 'name', 'Y');
    const entry = p.get(pkKeyOf({ id: 1 }, PK))!;
    expect(entry.changes.get('name')).toBe('Y');
    expect(entry.originals.get('name')).toBe('Alice');
  });

  it('无主键列时不产生暂存', () => {
    const p = stagePendingCell(new Map(), row1, [], 'name', 'X');
    expect(p.size).toBe(0);
  });

  it('NULL 值暂存', () => {
    const p = stagePendingCell(new Map(), row1, PK, 'name', null);
    expect(p.get(pkKeyOf({ id: 1 }, PK))!.changes.get('name')).toBeNull();
  });
});

describe('pendingToUpdates', () => {
  it('导出 batch-mutate 结构', () => {
    let p: PendingMap = new Map();
    p = stagePendingCell(p, row1, PK, 'name', 'X');
    p = stagePendingCell(p, row1, PK, 'age', 31);
    const updates = pendingToUpdates(p);
    expect(updates).toEqual([
      { pk: { id: 1 }, changes: { name: 'X', age: 31 }, originals: { name: 'Alice', age: 30 } },
    ]);
  });
});

describe('pkKeyOf', () => {
  it('复合主键序列化稳定', () => {
    expect(pkKeyOf({ a: 1, b: 'x' }, ['a', 'b'])).toBe(pkKeyOf({ b: 'x', a: 1 }, ['a', 'b']));
    expect(pkKeyOf({ a: 1 }, ['a'])).not.toBe(pkKeyOf({ a: 2 }, ['a']));
  });
});
