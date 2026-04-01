/**
 * 钉钉/飞书风格流程设计器 — 工具函数
 */
import type { FlowNode, FlowBranch, FlowProcess, FlowNodeType, BranchNodeType } from './types';
import { DEFAULT_BRANCH_COUNT } from './constants';

let idCounter = 0;

/** 生成唯一节点 ID */
export function genId(prefix = 'node'): string {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}

/** 创建默认发起人节点 */
export function createDefaultProcess(): FlowProcess {
  return {
    initiator: {
      id: genId('initiator'),
      type: 'initiator',
      name: '发起人',
      props: {},
      children: undefined,
    },
  };
}

/** 创建一个简单节点 */
export function createNode(type: FlowNode['type'], name?: string): FlowNode {
  const node: FlowNode = {
    id: genId(type),
    type,
    name: name ?? '',
    props: {},
  };

  // 分支节点需要初始化默认分支
  if (type === 'conditionBranch' || type === 'parallelBranch' || type === 'inclusiveBranch' || type === 'routeBranch') {
    const count = DEFAULT_BRANCH_COUNT[type as BranchNodeType];
    node.branches = [];
    for (let i = 0; i < count; i++) {
      if (type === 'conditionBranch' && i === count - 1) {
        // 条件分支的最后一个是"其它情况"
        node.branches.push({
          id: genId('branch'),
          name: '其它情况',
          priority: i + 1,
          isDefault: true,
        });
      } else {
        let branchName: string;
        if (type === 'conditionBranch') branchName = `条件${i + 1}`;
        else if (type === 'parallelBranch') branchName = `并行${i + 1}`;
        else branchName = `分支${i + 1}`;
        node.branches.push({
          id: genId('branch'),
          name: branchName,
          priority: type === 'parallelBranch' ? undefined : i + 1,
        });
      }
    }
  }

  return node;
}

/** 创建一个分支 */
export function createBranch(parentType: BranchNodeType, index: number): FlowBranch {
  let name: string;
  if (parentType === 'conditionBranch') name = `条件${index}`;
  else if (parentType === 'parallelBranch') name = `并行${index}`;
  else name = `分支${index}`;
  return {
    id: genId('branch'),
    name,
    priority: parentType === 'parallelBranch' ? undefined : index,
  };
}

// ─── 深拷贝 ──────────────────────────────────────────────────────────

export function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

/** 收集流程树中所有节点（用于"节点审批人"等下拉选择） */
export function collectAllNodes(root: FlowNode | undefined): Array<{ id: string; name: string; type: FlowNodeType }> {
  const result: Array<{ id: string; name: string; type: FlowNodeType }> = [];
  function walk(node: FlowNode | undefined) {
    if (!node) return;
    result.push({ id: node.id, name: node.name, type: node.type });
    if (node.children) walk(node.children);
    if (node.branches) {
      for (const b of node.branches) {
        if (b.children) walk(b.children);
      }
    }
  }
  walk(root);
  return result;
}

// ─── 节点链表操作 ────────────────────────────────────────────────────

/**
 * 在指定父节点之后插入新节点。
 * parentId — 目标父节点 ID
 * newNode  — 要插入的节点
 * 返回新的流程树（不可变更新）
 */
export function insertNodeAfter(process: FlowProcess, parentId: string, newNode: FlowNode): FlowProcess {
  const cloned = deepClone(process);
  const parent = findNodeById(cloned.initiator, parentId);
  if (parent) {
    newNode.children = parent.children;
    parent.children = newNode;
  }
  return cloned;
}

/**
 * 在指定分支内顶部插入节点
 */
export function insertNodeInBranch(
  process: FlowProcess,
  branchParentId: string,
  branchId: string,
  newNode: FlowNode,
): FlowProcess {
  const cloned = deepClone(process);
  const branchParent = findNodeById(cloned.initiator, branchParentId);
  if (branchParent?.branches) {
    const branch = branchParent.branches.find(b => b.id === branchId);
    if (branch) {
      newNode.children = branch.children;
      branch.children = newNode;
    }
  }
  return cloned;
}

/** 删除节点（将其 children 接到父节点上） */
export function removeNode(process: FlowProcess, nodeId: string): FlowProcess {
  const cloned = deepClone(process);
  removeNodeRecursive(cloned.initiator, nodeId);
  // 也搜索分支内
  traverseAll(cloned.initiator, (_node, _parent, branch) => {
    if (branch?.children?.id === nodeId) {
      branch.children = branch.children.children;
    }
    if (branch?.children) {
      removeNodeRecursive(branch.children, nodeId);
    }
  });
  return cloned;
}

function removeNodeRecursive(node: FlowNode, targetId: string): void {
  if (node.children?.id === targetId) {
    node.children = node.children.children;
    return;
  }
  if (node.children) {
    removeNodeRecursive(node.children, targetId);
  }
  if (node.branches) {
    for (const branch of node.branches) {
      if (branch.children) {
        if (branch.children.id === targetId) {
          branch.children = branch.children.children;
        } else {
          removeNodeRecursive(branch.children, targetId);
        }
      }
    }
  }
}

/** 更新指定节点的属性 */
export function updateNode(
  process: FlowProcess,
  nodeId: string,
  updates: Partial<Pick<FlowNode, 'name' | 'props'>>,
): FlowProcess {
  const cloned = deepClone(process);
  const node = findNodeById(cloned.initiator, nodeId);
  if (node) {
    if (updates.name !== undefined) node.name = updates.name;
    if (updates.props !== undefined) node.props = { ...node.props, ...updates.props };
  }
  return cloned;
}

/** 更新指定分支 */
export function updateBranch(
  process: FlowProcess,
  branchId: string,
  updates: Partial<Pick<FlowBranch, 'name' | 'conditions' | 'priority'>>,
): FlowProcess {
  const cloned = deepClone(process);
  traverseAll(cloned.initiator, (node) => {
    if (node.branches) {
      const branch = node.branches.find(b => b.id === branchId);
      if (branch) {
        if (updates.name !== undefined) branch.name = updates.name;
        if (updates.conditions !== undefined) branch.conditions = updates.conditions;
        if (updates.priority !== undefined) branch.priority = updates.priority;
      }
    }
  });
  return cloned;
}

/** 添加分支到分支节点 */
export function addBranch(process: FlowProcess, branchNodeId: string, newBranch: FlowBranch): FlowProcess {
  const cloned = deepClone(process);
  const node = findNodeById(cloned.initiator, branchNodeId);
  if (node?.branches) {
    // 条件分支：在"其它情况"之前插入
    if (node.type === 'conditionBranch') {
      const defaultIdx = node.branches.findIndex(b => b.isDefault);
      if (defaultIdx >= 0) {
        node.branches.splice(defaultIdx, 0, newBranch);
      } else {
        node.branches.push(newBranch);
      }
    } else {
      node.branches.push(newBranch);
    }
    // 重新编号 priority
    node.branches.forEach((b, i) => {
      if (node.type !== 'parallelBranch') {
        b.priority = i + 1;
      }
    });
  }
  return cloned;
}

/** 删除分支 */
export function removeBranch(process: FlowProcess, branchNodeId: string, branchId: string): FlowProcess {
  const cloned = deepClone(process);
  const node = findNodeById(cloned.initiator, branchNodeId);
  if (node?.branches) {
    node.branches = node.branches.filter(b => b.id !== branchId);
    // 如果剩余不到2个分支，移除整个分支节点并拼接
    if (node.branches.length < 2) {
      // 保留唯一分支的 children 拼接到分支节点之后
      const remaining = node.branches[0]?.children;
      // 找到 node 在树中的位置并替换
      replaceNodeInTree(cloned.initiator, node.id, remaining);
    }
  }
  return cloned;
}

// ─── 内部辅助 ────────────────────────────────────────────────────────

function findNodeById(node: FlowNode | undefined, id: string): FlowNode | undefined {
  if (!node) return undefined;
  if (node.id === id) return node;
  if (node.children) {
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  if (node.branches) {
    for (const branch of node.branches) {
      if (branch.children) {
        const found = findNodeById(branch.children, id);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function traverseAll(
  node: FlowNode | undefined,
  callback: (node: FlowNode, parent?: FlowNode, branch?: FlowBranch) => void,
  parent?: FlowNode,
  branch?: FlowBranch,
): void {
  if (!node) return;
  callback(node, parent, branch);
  if (node.children) {
    traverseAll(node.children, callback, node);
  }
  if (node.branches) {
    for (const b of node.branches) {
      if (b.children) {
        traverseAll(b.children, callback, node, b);
      }
    }
  }
}

function replaceNodeInTree(root: FlowNode, targetId: string, replacement?: FlowNode): void {
  // Check direct child
  if (root.children?.id === targetId) {
    // Merge: replacement → old.children
    if (replacement) {
      // Find tail of replacement chain
      let tail: FlowNode = replacement;
      while (tail.children) tail = tail.children;
      tail.children = root.children.children;
      root.children = replacement;
    } else {
      root.children = root.children.children;
    }
    return;
  }
  if (root.children) {
    replaceNodeInTree(root.children, targetId, replacement);
  }
  if (root.branches) {
    for (const b of root.branches) {
      if (b.children?.id === targetId) {
        if (replacement) {
          let tail: FlowNode = replacement;
          while (tail.children) tail = tail.children;
          tail.children = b.children.children;
          b.children = replacement;
        } else {
          b.children = b.children.children;
        }
        return;
      }
      if (b.children) {
        replaceNodeInTree(b.children, targetId, replacement);
      }
    }
  }
}

// ─── 树结构 ↔ 扁平 nodes+edges 转换 ─────────────────────────────────

interface FlatNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: {
    key: string;
    type: string;
    label: string;
    assigneeId?: number | null;
    assigneeName?: string | null;
    assigneeIds?: number[] | null;
    assigneeNames?: string[] | null;
    [key: string]: unknown;
  };
}

interface FlatEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  label?: string;
  condition?: {
    field: string;
    operator: string;
    value: string | number | boolean;
  } | null;
}

/** 将树结构转换为扁平 nodes + edges（用于后端保存） */
export function treeToFlat(process: FlowProcess): { nodes: FlatNode[]; edges: FlatEdge[] } {
  const nodes: FlatNode[] = [];
  const edges: FlatEdge[] = [];

  // 添加 start 节点
  const startId = 'node-start';
  nodes.push({
    id: startId,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { key: 'start', type: 'start', label: '发起' },
  });

  // 添加 end 节点
  const endId = 'node-end';
  nodes.push({
    id: endId,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { key: 'end', type: 'end', label: '结束' },
  });

  // 递归处理
  const lastIds = flattenNode(process.initiator.children, startId, nodes, edges);
  for (const lid of lastIds) {
    edges.push({ id: `e-${lid}-${endId}`, source: lid, target: endId });
  }

  return { nodes, edges };
}

function flattenNode(
  node: FlowNode | undefined,
  previousId: string,
  nodes: FlatNode[],
  edges: FlatEdge[],
): string[] {
  if (!node) return [previousId];

  const nodeType = mapNodeType(node.type);
  const flatId = `node-${node.id}`;

  if (node.branches && node.branches.length > 0) {
    // 分支节点 → 网关
    const gwType = node.type === 'parallelBranch' || node.type === 'inclusiveBranch'
      ? 'parallelGateway' : 'exclusiveGateway';

    // Fork gateway
    const forkId = `gw-fork-${node.id}`;
    nodes.push({
      id: forkId,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: { key: `fork-${node.id}`, type: gwType, label: node.name || gwType },
    });
    edges.push({ id: `e-${previousId}-${forkId}`, source: previousId, target: forkId });

    // Join gateway
    const joinId = `gw-join-${node.id}`;
    nodes.push({
      id: joinId,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: { key: `join-${node.id}`, type: gwType, label: `${node.name || gwType}(汇聚)` },
    });

    // Process each branch
    for (const branch of node.branches) {
      const branchEndIds = flattenNode(branch.children, forkId, nodes, edges);

      // 如果分支有条件，在 fork → first_node 的边上加条件
      if (branch.conditions?.length && branch.conditions[0].rules.length > 0) {
        const firstRule = branch.conditions[0].rules[0];
        const existingEdge = edges.find(e => e.source === forkId && branchEndIds.includes(e.target));
        // 只在无分支内容时需要直接连接 fork→join
        if (!branch.children) {
          edges.push({
            id: `e-${forkId}-${joinId}-${branch.id}`,
            source: forkId,
            target: joinId,
            condition: { field: firstRule.field, operator: firstRule.operator, value: firstRule.value },
          });
        } else if (existingEdge) {
          existingEdge.condition = { field: firstRule.field, operator: firstRule.operator, value: firstRule.value };
        }
      } else if (!branch.children) {
        edges.push({ id: `e-${forkId}-${joinId}-${branch.id}`, source: forkId, target: joinId });
      }

      for (const endId of branchEndIds) {
        if (endId !== forkId) {
          edges.push({ id: `e-${endId}-${joinId}`, source: endId, target: joinId });
        }
      }
    }

    // Continue with children after the branch
    return flattenNode(node.children, joinId, nodes, edges);
  }

  // Regular node
  nodes.push({
    id: flatId,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      key: node.id,
      type: nodeType,
      label: node.name,
      ...node.props,
    },
  });
  edges.push({ id: `e-${previousId}-${flatId}`, source: previousId, target: flatId });

  return flattenNode(node.children, flatId, nodes, edges);
}

function mapNodeType(type: FlowNodeType): string {
  switch (type) {
    case 'initiator': return 'start';
    case 'approver': return 'approve';
    case 'handler': return 'approve';
    case 'cc': return 'ccNode';
    case 'delay': return 'timerEvent';
    case 'trigger': return 'receiveTask';
    case 'subProcess': return 'callActivity';
    default: return 'approve';
  }
}
