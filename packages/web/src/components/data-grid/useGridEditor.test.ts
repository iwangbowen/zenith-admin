import { describe, expect, it } from 'vitest';
import {
  EMPTY_EDITOR_STATE,
  editorCounts,
  editorMutations,
  pendingCellCount,
  pendingToUpdates,
  pkKeyOf,
  pkOfRow,
  stagePendingCell,
  stateAddNewRow,
  stateRemoveNewRows,
  stateStageCell,
  stateToggleDeleteRows,
  stateUpdateNewRowCell,
  type EditorState,
  type PendingMap,
} from './useGridEditor';

const PK = ['id'];
const row1 = { id: 1, name: 'Alice', age: 30 };
const row2 = { id: 2, name: 'Bob', age: 25 };

function fresh(): EditorState {
  return { pending: new Map(), newRows: [], deletedKeys: new Set() };
}

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

describe('删除标记（stateToggleDeleteRows）', () => {
  it('标记与取消删除', () => {
    let s = stateToggleDeleteRows(fresh(), [row1, row2], PK, true);
    expect(s.deletedKeys.size).toBe(2);
    s = stateToggleDeleteRows(s, [row1], PK, false);
    expect(s.deletedKeys.size).toBe(1);
    expect(s.deletedKeys.has(pkKeyOf({ id: 2 }, PK))).toBe(true);
  });

  it('重复标记无变化（返回原引用）', () => {
    const s1 = stateToggleDeleteRows(fresh(), [row1], PK, true);
    const s2 = stateToggleDeleteRows(s1, [row1], PK, true);
    expect(s2).toBe(s1);
  });
});

describe('新增行草稿', () => {
  it('添加 / 编辑 / 移除', () => {
    let s = stateAddNewRow(fresh(), 1, { name: 'init' });
    expect(s.newRows).toHaveLength(1);
    s = stateUpdateNewRowCell(s, 1, 'age', 20);
    expect(s.newRows[0].values).toEqual({ name: 'init', age: 20 });
    s = stateRemoveNewRows(s, [1]);
    expect(s.newRows).toHaveLength(0);
  });

  it('等值更新返回原引用', () => {
    const s1 = stateAddNewRow(fresh(), 1, { name: 'x' });
    const s2 = stateUpdateNewRowCell(s1, 1, 'name', 'x');
    expect(s2).toBe(s1);
  });
});

describe('editorMutations', () => {
  it('导出完整变更集：inserts + updates + deletes', () => {
    let s = fresh();
    s = stateStageCell(s, row1, PK, 'name', 'X');
    s = stateToggleDeleteRows(s, [row2], PK, true);
    s = stateAddNewRow(s, 1, {});
    s = stateUpdateNewRowCell(s, 1, 'name', 'New');
    const m = editorMutations(s, [row1, row2], PK);
    expect(m.inserts).toEqual([{ name: 'New' }]);
    expect(m.updates).toHaveLength(1);
    expect(m.updates[0].changes).toEqual({ name: 'X' });
    expect(m.deletes).toEqual([{ pk: { id: 2 } }]);
  });

  it('已标记删除的行剔除其 update 暂存', () => {
    let s = fresh();
    s = stateStageCell(s, row1, PK, 'name', 'X');
    s = stateToggleDeleteRows(s, [row1], PK, true);
    const m = editorMutations(s, [row1], PK);
    expect(m.updates).toHaveLength(0);
    expect(m.deletes).toEqual([{ pk: { id: 1 } }]);
  });

  it('空值新增行不导出（全 undefined 过滤）', () => {
    let s = fresh();
    s = stateAddNewRow(s, 1, {});
    const m = editorMutations(s, [], PK);
    expect(m.inserts).toHaveLength(0);
  });
});

describe('editorCounts', () => {
  it('分类计数', () => {
    let s = fresh();
    s = stateStageCell(s, row1, PK, 'name', 'X');
    s = stateStageCell(s, row1, PK, 'age', 1);
    s = stateToggleDeleteRows(s, [row2], PK, true);
    s = stateAddNewRow(s, 1, {});
    expect(editorCounts(s)).toEqual({ modified: 2, added: 1, deleted: 1, total: 4 });
    expect(editorCounts(EMPTY_EDITOR_STATE).total).toBe(0);
  });
});
