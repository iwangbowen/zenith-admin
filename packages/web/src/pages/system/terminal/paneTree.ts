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
  /** 不可变的 session 标识，始终等于叶子首次创建时的 id，跨 split/collapse 操作保持稳定 */
  stableSessionId: string;
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

/** 恢复布局时调用：确保 paneCounter 大于已恢复节点 id 的最大数字后缀，避免新建节点 id 冲突 */
export function ensurePaneCounterFloor(n: number): void {
  if (n > paneCounter) paneCounter = n;
}

/** 收集子树中所有节点（leaf + split）的 id */
export function collectAllIds(node: PaneNode): string[] {
  if (node.type === 'leaf') return [node.id];
  return [node.id, ...node.children.flatMap(collectAllIds)];
}

/** 创建一个叶子节点（未指定 id 时自动生成） */
export function createLeaf(init: Omit<PaneLeaf, 'type' | 'id' | 'stableSessionId'> & { id?: string }): PaneLeaf {
  const id = init.id ?? nextPaneId();
  return {
    type: 'leaf',
    id,
    stableSessionId: id,  // 不可变，后续 spread 操作会自动保留
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

/** 更新指定叶子的标题，返回新树（不可变更新）。 */
export function updateLeafTitle(root: PaneNode, paneId: string, newTitle: string): PaneNode {
  if (root.type === 'leaf') {
    return root.id === paneId ? { ...root, title: newTitle } : root;
  }
  return { ...root, children: root.children.map((c) => updateLeafTitle(c, paneId, newTitle)) };
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
      // 关键：新 split 复用被拆分叶子的 id，使父级看到的子节点 id 保持稳定，
      // 避免 react-resizable-panels 因 Panel id 突变而丢失布局状态、导致嵌套分屏错乱。
      // 原叶子下移进 split 并分配新 id。
      const movedOriginal: PaneLeaf = { ...node, id: nextPaneId() };
      return {
        type: 'split',
        id: targetId,
        direction,
        children: [movedOriginal, newLeaf],
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
 *   - 非根层折叠：继承 split 节点的 id，使父级 Panel key 保持稳定，避免 react-resizable-panels 重置布局。
 *   - 根层折叠：不重命名 id，配合 PaneTreeView 单叶包裹，让剩余终端面板不重建、WebSocket 不断线。
 * - 返回新树、下一个应聚焦的叶子 id，以及折叠时可能发生的 id 重命名信息。
 */
export function closePane(
  root: PaneNode,
  targetId: string,
): { root: PaneNode | null; nextActiveId: string | null; renamedPaneId: { from: string; to: string } | null } {
  const leaves = collectLeaves(root);
  const idx = leaves.findIndex((l) => l.id === targetId);
  if (idx < 0) return { root, nextActiveId: null, renamedPaneId: null };
  if (leaves.length === 1) return { root: null, nextActiveId: null, renamedPaneId: null };

  const nextActiveLeafId = (leaves[idx + 1] ?? leaves[idx - 1]).id;

  // 用对象属性记录重命名信息（TypeScript 不对对象属性做控制流窄化，避免被平干为 never）
  const renameState: { id: { from: string; to: string } | null } = { id: null };

  function recur(node: PaneNode, isRoot = false): PaneNode | null {
    if (node.type === 'leaf') return node.id === targetId ? null : node;
    const children = node.children
      .map((c) => recur(c, false))
      .filter((c): c is PaneNode => c !== null);
    if (children.length === 0) return null;
    if (children.length === 1) {
      const child = children[0];
      if (isRoot) {
        // 根层折叠：不重命名 id。
        // PaneTreeView 根节点始终包裹在 PanelGroup+Panel 中，
        // 剩余面板的 Panel key 不变，终端不重建、WebSocket 不断线。
        return child;
      }
      // 层叠折叠：继承 split 节点的 id，保证父级 PanelGroup 中该 Panel key 不变。
      if (child.id !== node.id && child.type === 'leaf') {
        renameState.id = { from: child.id, to: node.id };
      }
      return { ...child, id: node.id };
    }
    return { ...node, children };
  }

  const newRoot = recur(root, true);
  const renamedPaneId = renameState.id;

  // 若 nextActiveId 所指的叶子 id 被重命名，同步更新
  const rp = renamedPaneId;
  const finalNextActiveId =
    rp !== null && rp.from === nextActiveLeafId
      ? rp.to
      : nextActiveLeafId;

  return { root: newRoot, nextActiveId: finalNextActiveId, renamedPaneId };
}
