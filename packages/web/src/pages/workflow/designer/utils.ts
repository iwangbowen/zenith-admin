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
    const count = DEFAULT_BRANCH_COUNT[type];
    node.branches = [];
    const hasDefault = type === 'conditionBranch' || type === 'routeBranch' || type === 'inclusiveBranch';
    for (let i = 0; i < count; i++) {
      if (hasDefault && i === count - 1) {
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
    if (type === 'routeBranch') {
      node.props = { routeFieldKey: '' };
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
export function collectAllNodes(root: FlowNode | undefined): Array<{ id: string; key?: string; name: string; type: FlowNodeType }> {
  const result: Array<{ id: string; key?: string; name: string; type: FlowNodeType }> = [];
  function walk(node: FlowNode | undefined) {
    if (!node) return;
    result.push({ id: node.id, key: node.key, name: node.name, type: node.type });
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

/**
 * 在流程树中查找指定节点的"祖先链"上所有审批/办理节点。
 * 用于审批节点"驳回到指定节点"功能 — 候选节点必须是当前节点之前、同一执行路径上的节点。
 * 不包含当前节点自身，不包含分支节点本身（仅审批人 / 办理人）。
 */
export function findAncestorApproverNodes(
  root: FlowNode | undefined,
  targetId: string,
): Array<{ id: string; key?: string; name: string; type: FlowNodeType }> {
  const path: FlowNode[] = [];
  function walk(node: FlowNode | undefined): boolean {
    if (!node) return false;
    if (node.id === targetId) return true;
    path.push(node);
    if (walk(node.children)) return true;
    if (node.branches) {
      for (const b of node.branches) {
        if (walk(b.children)) return true;
      }
    }
    path.pop();
    return false;
  }
  if (!walk(root)) return [];
  return path
    .filter((n) => n.type === 'approver' || n.type === 'handler')
    .map((n) => ({ id: n.id, key: n.key, name: n.name, type: n.type }));
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
  updates: Partial<Pick<FlowNode, 'name' | 'props' | 'key'>>,
): FlowProcess {
  const cloned = deepClone(process);
  const node = findNodeById(cloned.initiator, nodeId);
  if (node) {
    if (updates.name !== undefined) node.name = updates.name;
    if (updates.props !== undefined) node.props = { ...node.props, ...updates.props };
    if (updates.key !== undefined) {
      const trimmed = updates.key.trim();
      node.key = trimmed === '' ? undefined : trimmed;
    }
  }
  return cloned;
}

/** 更新指定分支 */
export function updateBranch(
  process: FlowProcess,
  branchId: string,
  updates: Partial<Pick<FlowBranch, 'name' | 'conditions' | 'priority' | 'caseValue'>>,
): FlowProcess {
  const cloned = deepClone(process);
  traverseAll(cloned.initiator, (node) => {
    if (node.branches) {
      const branch = node.branches.find(b => b.id === branchId);
      if (branch) {
        if (updates.name !== undefined) branch.name = updates.name;
        if (updates.conditions !== undefined) branch.conditions = updates.conditions;
        if (updates.priority !== undefined) branch.priority = updates.priority;
        if (updates.caseValue !== undefined) branch.caseValue = updates.caseValue;
      }
    }
  });
  return cloned;
}

/** 重置路由分支节点下所有非默认分支的 caseValue（用于切换路由字段后清理脏数据） */
export function resetRouteCaseValues(process: FlowProcess, routeNodeId: string): FlowProcess {
  const cloned = deepClone(process);
  const node = findNodeById(cloned.initiator, routeNodeId);
  if (node?.branches) {
    for (const b of node.branches) {
      if (!b.isDefault) b.caseValue = '';
    }
  }
  return cloned;
}

/** 添加分支到分支节点 */
export function addBranch(process: FlowProcess, branchNodeId: string, newBranch: FlowBranch): FlowProcess {
  const cloned = deepClone(process);
  const node = findNodeById(cloned.initiator, branchNodeId);
  if (node?.branches) {
    // 条件分支 / 包容分支：在"其它情况"之前插入
    if (node.type === 'conditionBranch' || node.type === 'inclusiveBranch') {
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

/** 上移/下移分支（仅在非默认分支之间交换；默认分支始终保持末尾） */
export function moveBranch(
  process: FlowProcess,
  branchNodeId: string,
  branchId: string,
  direction: 'up' | 'down',
): FlowProcess {
  const cloned = deepClone(process);
  const node = findNodeById(cloned.initiator, branchNodeId);
  if (!node?.branches) return cloned;
  const branches = node.branches;
  const idx = branches.findIndex(b => b.id === branchId);
  if (idx < 0 || branches[idx].isDefault) return cloned;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= branches.length) return cloned;
  if (branches[swapIdx].isDefault) return cloned; // 不与默认分支交换位置
  [branches[idx], branches[swapIdx]] = [branches[swapIdx], branches[idx]];
  // 重新编号 priority（保持与展示一致）
  branches.forEach((b, i) => {
    if (node.type !== 'parallelBranch') b.priority = i + 1;
  });
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

/**
 * 复制节点：在源节点之后插入一个深拷贝副本（重新生成 id，剥离 children）。
 * 用于设计器的「复制节点」功能。
 */
export function duplicateNode(process: FlowProcess, nodeId: string): FlowProcess {
  const cloned = deepClone(process);
  const source = findNodeById(cloned.initiator, nodeId);
  if (!source || source.type === 'initiator') return process;
  const copy: FlowNode = {
    ...deepClone(source),
    id: genId(source.type),
    name: source.name ? `${source.name} 副本` : '',
    children: undefined,
  };
  // 分支节点的分支也要重新生成 id
  if (copy.branches) {
    copy.branches = copy.branches.map(b => ({
      ...b,
      id: genId('branch'),
      children: undefined,
    }));
  }
  copy.children = source.children;
  source.children = copy;
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
    source?: 'form' | 'starter';
  } | null;
  conditions?: Array<{
    type: 'and' | 'or';
    rules: Array<{
      field: string;
      operator: string;
      value: string | number | boolean;
      source?: 'form' | 'starter';
    }>;
  }> | null;
  isDefault?: boolean;
}

function normalizeBranchConditions(branch: FlowBranch): FlatEdge['conditions'] {
  const groups = branch.conditions
    ?.map(group => ({
      type: group.type,
      rules: group.rules.filter(rule => rule.field !== ''),
    }))
    .filter(group => group.rules.length > 0);
  return groups?.length ? groups : null;
}

function firstBranchRule(conditions: FlatEdge['conditions']): FlatEdge['condition'] {
  return conditions?.[0]?.rules[0] ?? null;
}

function applyBranchEdgeMeta(edge: FlatEdge, branch: FlowBranch, parentNode?: FlowNode): void {
  edge.label = branch.name;
  edge.isDefault = !!branch.isDefault;

  // 路由分支：把 caseValue 编译成单条 eq 规则的条件组，复用现有引擎
  if (parentNode?.type === 'routeBranch' && !branch.isDefault) {
    const routeFieldKey = (parentNode.props?.routeFieldKey as string | undefined)?.trim();
    const caseValue = branch.caseValue;
    if (routeFieldKey && caseValue !== undefined && caseValue !== '') {
      const conditions: FlatEdge['conditions'] = [{
        type: 'and',
        rules: [{ field: routeFieldKey, operator: 'eq', value: caseValue }],
      }];
      edge.conditions = conditions;
      edge.condition = firstBranchRule(conditions);
    } else {
      edge.conditions = null;
      edge.condition = null;
    }
    return;
  }

  const conditions = normalizeBranchConditions(branch);
  edge.conditions = conditions;
  edge.condition = firstBranchRule(conditions);
}

/**
 * 校验路由分支：
 * - 父节点必须设置 routeFieldKey
 * - 非默认分支必须设置 caseValue，且不重复
 * 返回错误信息列表；空数组表示通过。
 */
export function validateRouteBranches(process: FlowProcess): string[] {
  const errors: string[] = [];
  traverseAll(process.initiator, (node) => {
    if (node.type !== 'routeBranch' || !node.branches) return;
    const routeFieldKey = (node.props?.routeFieldKey as string | undefined)?.trim();
    const label = node.name || '路由分支';
    if (!routeFieldKey) {
      errors.push(`「${label}」未选择路由字段`);
      return;
    }
    const seen = new Set<string>();
    let hasNonDefault = false;
    for (const b of node.branches) {
      if (b.isDefault) continue;
      hasNonDefault = true;
      const v = b.caseValue?.trim();
      if (!v) {
        errors.push(`「${label} / ${b.name}」未设置匹配值`);
      } else if (seen.has(v)) {
        errors.push(`「${label}」分支匹配值「${v}」重复`);
      } else {
        seen.add(v);
      }
    }
    if (!hasNonDefault) errors.push(`「${label}」至少需要一个非默认分支`);
  });
  return errors;
}

/**
 * 校验条件 / 包容分支：每个非默认分支必须配置至少一个条件，
 * 否则该分支会被当成默认分支抢先命中（静默坑）。
 */
export function validateConditionBranches(process: FlowProcess): string[] {
  const errors: string[] = [];
  traverseAll(process.initiator, (node) => {
    if ((node.type !== 'conditionBranch' && node.type !== 'inclusiveBranch') || !node.branches) return;
    const label = node.name || (node.type === 'conditionBranch' ? '条件分支' : '包容分支');
    for (const b of node.branches) {
      if (b.isDefault) continue;
      const ruleCount = (b.conditions ?? []).reduce(
        (sum, g) => sum + g.rules.filter(r => r.field !== '').length,
        0,
      );
      if (ruleCount === 0) {
        errors.push(`「${label} / ${b.name}」未配置任何条件`);
      }
    }
  });
  return errors;
}

/**
 * 校验并行 / 包容分支：分支不能为空（无任何节点），否则运行时汇聚会卡死。
 * 包容分支的默认分支允许为空（作为"无操作"兜底）。
 */
export function validateBranchChildren(process: FlowProcess): string[] {
  const errors: string[] = [];
  traverseAll(process.initiator, (node) => {
    if ((node.type !== 'parallelBranch' && node.type !== 'inclusiveBranch') || !node.branches) return;
    const label = node.name || (node.type === 'parallelBranch' ? '并行分支' : '包容分支');
    for (const b of node.branches) {
      if (node.type === 'inclusiveBranch' && b.isDefault) continue; // 包容默认分支可为空
      if (!b.children) {
        errors.push(`「${label} / ${b.name}」分支为空，请至少添加一个节点`);
      }
    }
  });
  return errors;
}

/** 将树结构转换为扁平 nodes + edges（用于后端保存） */
export function treeToFlat(process: FlowProcess): { nodes: FlatNode[]; edges: FlatEdge[] } {
  const nodes: FlatNode[] = [];
  const edges: FlatEdge[] = [];

  // 添加 start 节点（保留发起人节点的 props，如字段权限 fieldPermissions / 发起人说明）
  const startId = 'node-start';
  nodes.push({
    id: startId,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { ...(process.initiator.props ?? {}), key: 'start', type: 'start', label: '发起' },
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
    let gwType: string;
    if (node.type === 'parallelBranch') gwType = 'parallelGateway';
    else if (node.type === 'inclusiveBranch') gwType = 'inclusiveGateway';
    else if (node.type === 'routeBranch') gwType = 'routeGateway';
    else gwType = 'exclusiveGateway';

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
      const edgeStartIndex = edges.length;
      const branchEndIds = flattenNode(branch.children, forkId, nodes, edges);
      const branchEdges = edges.slice(edgeStartIndex);
      const firstBranchEdge = branchEdges.find(e => e.source === forkId && e.target !== joinId);

      // 分支元数据必须挂在 fork → 分支首节点（或空分支时 fork → join）的边上。
      // 旧实现只取第一条规则，且多节点分支会找不到首边，导致条件丢失。
      if (!branch.children) {
        const edge: FlatEdge = { id: `e-${forkId}-${joinId}-${branch.id}`, source: forkId, target: joinId };
        applyBranchEdgeMeta(edge, branch, node);
        edges.push(edge);
      } else if (firstBranchEdge) {
        applyBranchEdgeMeta(firstBranchEdge, branch, node);
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
  const dataExtra: Record<string, unknown> = { ...node.props };
  // 触发器节点：将顶层 props 收敛到 triggerConfig（与后端类型一致）
  if (node.type === 'trigger') {
    const p = node.props ?? {};
    // 解析可能是 JSON 字符串的 headers / fieldValues
    let headers: unknown = p.headers;
    if (typeof headers === 'string' && headers.trim()) {
      try { headers = JSON.parse(headers); } catch { /* keep string, backend tolerates */ }
    }
    let fieldValues: unknown = p.fieldValues;
    if (typeof fieldValues === 'string' && fieldValues.trim()) {
      try { fieldValues = JSON.parse(fieldValues); } catch { /* ignore */ }
    }
    dataExtra.triggerConfig = {
      triggerType: p.triggerType ?? 'webhook',
      ...(p.webhookUrl ? { webhookUrl: p.webhookUrl } : {}),
      ...(p.httpMethod ? { httpMethod: p.httpMethod } : {}),
      ...(headers ? { headers } : {}),
      ...(p.bodyTemplate ? { bodyTemplate: p.bodyTemplate } : {}),
      ...(p.fieldKeys ? { fieldKeys: p.fieldKeys } : {}),
      ...(fieldValues ? { fieldValues } : {}),
      ...(p.onFailure ? { onFailure: p.onFailure } : {}),
      ...(p.maxRetries == null ? {} : { maxRetries: p.maxRetries }),
      ...(p.timeoutMs == null ? {} : { timeoutMs: p.timeoutMs }),
      ...(p.callbackSignMode ? { callbackSignMode: p.callbackSignMode } : {}),
      ...(p.callbackSecret ? { callbackSecret: p.callbackSecret } : {}),
    };
  }
  // 子流程节点：解析 mapping 字符串为对象，并将 waitChild / 多实例 / 发起人 / 映射放到 data 顶层
  if (node.type === 'subProcess') {
    const p = node.props ?? {};
    let fieldMapping: unknown = p.subProcessFieldMapping;
    if (typeof fieldMapping === 'string' && fieldMapping.trim()) {
      try { fieldMapping = JSON.parse(fieldMapping); } catch { fieldMapping = undefined; }
    }
    let outputMapping: unknown = p.subProcessOutputMapping;
    if (typeof outputMapping === 'string' && outputMapping.trim()) {
      try { outputMapping = JSON.parse(outputMapping); } catch { outputMapping = undefined; }
    }
    if (p.subProcessId != null) dataExtra.subProcessId = p.subProcessId;
    if (p.subProcessName) dataExtra.subProcessName = p.subProcessName;
    dataExtra.subProcessWaitChild = p.subProcessWaitChild !== false;
    dataExtra.isAsync = p.subProcessWaitChild === false;
    if (fieldMapping && typeof fieldMapping === 'object') dataExtra.subProcessFieldMapping = fieldMapping;
    if (outputMapping && typeof outputMapping === 'object') dataExtra.subProcessOutputMapping = outputMapping;
    // 调用模式 / 多实例
    const mode = p.subProcessMode === 'multi' ? 'multi' : 'single';
    dataExtra.subProcessMode = mode;
    if (mode === 'multi') {
      if (p.subProcessMultiSource) dataExtra.subProcessMultiSource = p.subProcessMultiSource;
      dataExtra.subProcessMultiExecution = p.subProcessMultiExecution === 'serial' ? 'serial' : 'parallel';
      dataExtra.subProcessOnChildReject = p.subProcessOnChildReject === 'continue' ? 'continue' : 'abort';
      if (p.subProcessMultiItemKey) dataExtra.subProcessMultiItemKey = p.subProcessMultiItemKey;
    }
    // 子实例发起人
    const initiator = p.subProcessInitiator === 'formField' || p.subProcessInitiator === 'specifiedUser'
      ? p.subProcessInitiator : 'parentInitiator';
    dataExtra.subProcessInitiator = initiator;
    if (initiator === 'formField' && p.subProcessInitiatorField) dataExtra.subProcessInitiatorField = p.subProcessInitiatorField;
    if (initiator === 'specifiedUser' && p.subProcessInitiatorUserId != null) dataExtra.subProcessInitiatorUserId = p.subProcessInitiatorUserId;
    // 驳回处理
    dataExtra.subProcessIgnoreReject = p.subProcessIgnoreReject === true;
    if (!p.subProcessIgnoreReject && p.rejectStrategy) {
      dataExtra.rejectStrategy = p.rejectStrategy;
      if (p.rejectStrategy === 'returnToNode' && p.rejectToNodeKey) dataExtra.rejectToNodeKey = p.rejectToNodeKey;
    }
  }
  // 审批节点：将外部审批相关 props 收敛到 externalApproval
  if (node.type === 'approver') {
    const p = node.props ?? {};
    if (p.externalApproval && typeof p.externalApproval === 'object') {
      dataExtra.externalApproval = p.externalApproval;
    } else if (p.externalApprovalEnabled) {
      dataExtra.externalApproval = {
        enabled: !!p.externalApprovalEnabled,
        url: (p.externalApprovalUrl as string) ?? '',
        secret: (p.externalApprovalSecret as string) ?? '',
        signMode: (p.externalApprovalSignMode as string) ?? 'hmacSha256',
        timeoutMs: p.externalApprovalTimeoutMs ?? 10000,
        fallbackStrategy: (p.externalApprovalFallback as string) ?? 'manual',
      };
    }
    // 操作按钮配置：直接透传 actionButtons 对象
    if (p.actionButtons && typeof p.actionButtons === 'object') {
      dataExtra.actionButtons = p.actionButtons;
    }
  }
  nodes.push({
    id: flatId,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      key: node.key || node.id,
      type: nodeType,
      label: node.name,
      ...dataExtra,
    },
  });
  edges.push({ id: `e-${previousId}-${flatId}`, source: previousId, target: flatId });

  return flattenNode(node.children, flatId, nodes, edges);
}

function mapNodeType(type: FlowNodeType): string {
  switch (type) {
    case 'initiator': return 'start';
    case 'approver': return 'approve';
    case 'handler': return 'handler';
    case 'cc': return 'ccNode';
    case 'delay': return 'delay';
    case 'trigger': return 'trigger';
    case 'subProcess': return 'subProcess';
    default: return 'approve';
  }
}
