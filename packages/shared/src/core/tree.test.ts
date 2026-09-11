import { describe, expect, it } from 'vitest';
import { buildTree, flattenTree, mapTree } from './tree';

interface Node { id: number; parentId: number | null; name: string; children?: Node[] }

const list: Node[] = [
  { id: 1, parentId: null, name: 'root' },
  { id: 2, parentId: 1, name: 'a' },
  { id: 3, parentId: 2, name: 'a-1' },
  { id: 4, parentId: 1, name: 'b' },
  { id: 5, parentId: 99, name: 'orphan' },
];

describe('tree helpers', () => {
  it('buildTree 挂接 children，父节点缺失的节点提升为根', () => {
    const tree = buildTree(list);
    expect(tree.map((n) => n.id)).toEqual([1, 5]);
    expect(tree[0].children?.map((n) => n.id)).toEqual([2, 4]);
    expect(tree[0].children?.[0].children?.[0].id).toBe(3);
    expect(tree[1].children).toBeUndefined();
  });

  it('flattenTree 先序平铺，父节点在子树之前，节点不拷贝', () => {
    const tree = buildTree(list);
    const flat = flattenTree(tree);
    expect(flat.map((n) => n.id)).toEqual([1, 2, 3, 4, 5]);
    expect(flat[0]).toBe(tree[0]);
    expect(flattenTree([])).toEqual([]);
    expect(flattenTree([{ id: 9, parentId: null, name: 'x', children: null } as unknown as Node])).toHaveLength(1);
  });

  it('mapTree 递归映射并保留层级', () => {
    const mapped = mapTree<Node, { key: string; children?: { key: string }[] }>(buildTree(list), (n) => ({ key: `k${n.id}` }));
    expect(mapped[0].key).toBe('k1');
    expect(mapped[0].children?.[0].children?.[0].key).toBe('k3');
    expect(mapped[1].children).toBeUndefined();
  });
});
