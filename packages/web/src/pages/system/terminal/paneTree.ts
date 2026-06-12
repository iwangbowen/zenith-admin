/**
 * 终端分屏面板树（VS Code 风格递归嵌套）
 *
 * 每个 tab 的内容从「单一终端/编辑器」升级为一棵可递归嵌套的分屏树：
 * - leaf  叶子节点 = 一个终端或编辑器实例
 * - split 分隔节点 = 横向(左右) / 纵向(上下) 排列的若干子节点
 */

export type PaneKind = 'terminal' | 'editor';

/** horizontal = 左右排列（向右拆分）；vertical = 上下排列（向下拆分） */
export type SplitDirection = 'horizontal' | 'vertical';

export interface PaneLeaf {
  type: 'leaf';
  id: string;
  kind: PaneKind;
  title: string;
  shell?: string;
  cwd?: string;
  filePath?: string;
}

export interface PaneSplit {
  type: 'split';
  id: string;
  direction: SplitDirection;
  children: PaneNode[];
}

export type PaneNode = PaneLeaf | PaneSplit;

let paneCounter = 0;

/** 生成全局唯一的 pane / split 节点 id */
export function nextPaneId(prefix = 'pane'): string {
  paneCounter += 1;
  return `${prefix}-${paneCounter}`;
}

/** 创建一个叶子节点（未指定 id 时自动生成） */
export function createLeaf(init: Omit<PaneLeaf, 'type' | 'id'> & { id?: string }): PaneLeaf {
  return {
    type: 'leaf',
    id: init.id ?? nextPaneId(),
    kind: init.kind,
    title: init.title,
    shell: init.shell,
    cwd: init.cwd,
    filePath: init.filePath,
  };
}

/** 按 id 查找叶子节点 */
export function findLeaf(node: PaneNode, id: string): PaneLeaf | null {
  if (node.type === 'leaf') return node.id === id ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, id);
    if (found) return found;
  }
  return null;
}

/** 取树中最左/最上的第一个叶子（用于默认聚焦） */
export function firstLeaf(node: PaneNode): PaneLeaf {
  let cur: PaneNode = node;
  while (cur.type === 'split') cur = cur.children[0];
  return cur;
}

/** 按渲染顺序收集所有叶子 */
export function collectLeaves(node: PaneNode): PaneLeaf[] {
  if (node.type === 'leaf') return [node];
  return node.children.flatMap(collectLeaves);
}

/**
 * 在目标叶子处分屏：用一个 split 节点替换该叶子，包含 [原叶子, 新叶子]。
 * 若目标叶子恰好是某 split 的直接子节点且方向一致，则直接插入以保持树扁平，避免无谓嵌套。
 */
export function splitPane(
  root: PaneNode,
  targetId: string,
  direction: SplitDirection,
  newLeaf: PaneLeaf,
): PaneNode {
  function recur(node: PaneNode): PaneNode {
    if (node.type === 'leaf') {
      if (node.id !== targetId) return node;
      return {
        type: 'split',
        id: nextPaneId('split'),
        direction,
        children: [node, newLeaf],
      };
    }
    const idx = node.children.findIndex((c) => c.type === 'leaf' && c.id === targetId);
    if (idx >= 0 && node.direction === direction) {
      const children = [...node.children];
      children.splice(idx + 1, 0, newLeaf);
      return { ...node, children };
    }
    return { ...node, children: node.children.map(recur) };
  }
  return recur(root);
}

/**
 * 关闭目标叶子。
 * - 移除该叶子，若某 split 仅剩一个子节点则将其向上提升（扁平化）。
 * - 返回新树（关闭最后一个叶子时为 null）及下一个应聚焦的叶子 id。
 */
export function closePane(
  root: PaneNode,
  targetId: string,
): { root: PaneNode | null; nextActiveId: string | null } {
  const leaves = collectLeaves(root);
  const idx = leaves.findIndex((l) => l.id === targetId);
  if (idx < 0) return { root, nextActiveId: null };
  if (leaves.length === 1) return { root: null, nextActiveId: null };

  const nextActiveId = (leaves[idx + 1] ?? leaves[idx - 1]).id;

  function recur(node: PaneNode): PaneNode | null {
    if (node.type === 'leaf') return node.id === targetId ? null : node;
    const children = node.children
      .map(recur)
      .filter((c): c is PaneNode => c !== null);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { ...node, children };
  }

  return { root: recur(root), nextActiveId };
}
