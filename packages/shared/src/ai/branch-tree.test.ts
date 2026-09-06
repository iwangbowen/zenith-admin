/**
 * AI 消息分支树单测：有效父节点推导（显式 / legacy 隐式）、激活路径、下探叶子、祖先链、兄弟分支信息。
 * 服务端（Date）与前端（时间串）两种 createdAt 形态都要能工作。
 */
import { describe, expect, it } from 'vitest';
import {
  buildChildrenMap,
  buildEffectiveParents,
  computeBranchInfo,
  descendToLeaf,
  resolveActivePath,
  resolveAncestorPath,
  sortMessagesByTime,
  type BranchTreeNode,
} from './branch-tree';

const t = (sec: number) => new Date(2026, 0, 1, 0, 0, sec);
const node = (id: number, parentId: number | null, role: string, sec: number): BranchTreeNode => ({ id, parentId, role, createdAt: t(sec) });

/**
 * 1(user) ─ 2(assistant) ─ 3(user) ─ 4(assistant)
 *                        └ 5(assistant, 3 的重生成)
 */
const tree = [
  node(1, null, 'user', 1),
  node(2, 1, 'assistant', 2),
  node(3, 2, 'user', 3),
  node(4, 3, 'assistant', 4),
  node(5, 3, 'assistant', 5),
];

describe('sortMessagesByTime', () => {
  it('按时间升序，同一时刻按 id', () => {
    const rows = [node(3, null, 'user', 2), node(1, null, 'user', 1), node(2, null, 'user', 2)];
    expect(sortMessagesByTime(rows).map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('支持字典序可比的时间串（前端 API 返回形态）', () => {
    const rows: BranchTreeNode[] = [
      { id: 2, parentId: null, role: 'user', createdAt: '2026-01-01 10:00:01' },
      { id: 1, parentId: null, role: 'user', createdAt: '2026-01-01 09:59:59' },
    ];
    expect(sortMessagesByTime(rows).map((r) => r.id)).toEqual([1, 2]);
  });
});

describe('buildEffectiveParents', () => {
  it('显式 parentId 原样保留；指向不存在的节点视为根', () => {
    const parents = buildEffectiveParents([node(1, null, 'user', 1), node(2, 1, 'assistant', 2), node(3, 999, 'user', 3)]);
    expect(parents.get(2)).toBe(1);
    expect(parents.get(3)).toBeNull();
  });

  it('legacy 线性数据（parentId 全为 null）按时间序链接前一条', () => {
    const legacy = [node(10, null, 'user', 1), node(11, null, 'assistant', 2), node(12, null, 'user', 3)];
    const parents = buildEffectiveParents(legacy);
    expect(parents.get(10)).toBeNull();
    expect(parents.get(11)).toBe(10);
    expect(parents.get(12)).toBe(11);
  });

  it('对已归一化（服务端输出）的数据再次推导是幂等的', () => {
    const first = buildEffectiveParents(tree);
    const normalized = tree.map((r) => ({ ...r, parentId: first.get(r.id) ?? null }));
    expect(buildEffectiveParents(normalized)).toEqual(first);
  });
});

describe('resolveActivePath / descendToLeaf / resolveAncestorPath', () => {
  it('激活叶子的祖先链（含自身）', () => {
    expect(resolveActivePath(tree, 4).map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(resolveActivePath(tree, 5).map((r) => r.id)).toEqual([1, 2, 3, 5]);
  });

  it('未设置或失效的叶子退回时间最新消息', () => {
    expect(resolveActivePath(tree, null).map((r) => r.id)).toEqual([1, 2, 3, 5]);
    expect(resolveActivePath(tree, 404).map((r) => r.id)).toEqual([1, 2, 3, 5]);
    expect(resolveActivePath([], null)).toEqual([]);
  });

  it('legacy 线性数据的激活路径覆盖全部消息', () => {
    const legacy = [node(10, null, 'user', 1), node(11, null, 'assistant', 2), node(12, null, 'user', 3)];
    expect(resolveActivePath(legacy, null).map((r) => r.id)).toEqual([10, 11, 12]);
  });

  it('从任意节点沿最新子分支下探到叶子', () => {
    expect(descendToLeaf(tree, 1)).toBe(5);
    expect(descendToLeaf(tree, 4)).toBe(4);
  });

  it('祖先链以指定消息为终点；节点不存在返回空', () => {
    expect(resolveAncestorPath(tree, 3).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(resolveAncestorPath(tree, 999)).toEqual([]);
  });

  it('子节点映射按有效父节点归组、时间序', () => {
    const children = buildChildrenMap(tree);
    expect(children.get(null)?.map((r) => r.id)).toEqual([1]);
    expect(children.get(3)?.map((r) => r.id)).toEqual([4, 5]);
  });
});

describe('computeBranchInfo', () => {
  it('同父同角色兄弟 ≥ 2 时才有条目，index 为时间序位置', () => {
    const info = computeBranchInfo(tree);
    expect(info.get(4)).toEqual({ siblings: [4, 5], index: 0 });
    expect(info.get(5)).toEqual({ siblings: [4, 5], index: 1 });
    expect(info.has(2)).toBe(false);
  });
});
