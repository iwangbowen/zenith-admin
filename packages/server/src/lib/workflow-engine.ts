/**
 * 工作流 DAG 执行引擎
 *
 * 支持的节点类型：
 * - start: 开始节点
 * - approve: 人工审批节点
 * - end: 结束节点
 * - exclusiveGateway: 排他网关（XOR） — 根据条件走一条路径
 * - parallelGateway: 并行网关（AND） — fork 时创建多个任务，join 时等待全部完成
 * - ccNode: 抄送节点 — 通知但不阻塞流程
 */
import type {
  WorkflowFlowData,
  WorkflowNodeConfig,
  WorkflowEdge,
  WorkflowEdgeCondition,
} from '@zenith/shared';

// ─── 图遍历工具 ───────────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  data: WorkflowNodeConfig;
}

/** 构建邻接表 */
function buildAdjacency(flowData: WorkflowFlowData) {
  const nodeMap = new Map<string, FlowNode>();
  for (const n of flowData.nodes) {
    nodeMap.set(n.id, { id: n.id, data: n.data });
  }

  // source -> [{ target, edge }]
  const outEdges = new Map<string, Array<{ target: string; edge: WorkflowEdge }>>();
  // target -> [source]
  const inEdges = new Map<string, string[]>();

  for (const edge of flowData.edges) {
    const out = outEdges.get(edge.source) ?? [];
    out.push({ target: edge.target, edge });
    outEdges.set(edge.source, out);

    const ins = inEdges.get(edge.target) ?? [];
    ins.push(edge.source);
    inEdges.set(edge.target, ins);
  }

  return { nodeMap, outEdges, inEdges };
}

/** 求值条件表达式 */
export function evaluateCondition(
  condition: WorkflowEdgeCondition,
  formData: Record<string, unknown>,
): boolean {
  const fieldValue = formData[condition.field];
  const target = condition.value;

  // Normalize to primitive for safe comparison
  let fv: string | number | boolean | null;
  if (typeof fieldValue === 'string' || typeof fieldValue === 'number' || typeof fieldValue === 'boolean') {
    fv = fieldValue;
  } else if (fieldValue == null) {
    fv = null;
  } else {
    fv = JSON.stringify(fieldValue);
  }

  switch (condition.operator) {
    case 'eq':
      return fv === target || String(fv ?? '') === String(target);
    case 'neq':
      return fv !== target && String(fv ?? '') !== String(target);
    case 'gt':
      return Number(fv) > Number(target);
    case 'gte':
      return Number(fv) >= Number(target);
    case 'lt':
      return Number(fv) < Number(target);
    case 'lte':
      return Number(fv) <= Number(target);
    case 'in': {
      if (typeof target === 'string') {
        const arr = target.split(',').map(s => s.trim());
        return arr.includes(String(fv ?? ''));
      }
      return false;
    }
    case 'contains':
      return typeof fv === 'string' && fv.includes(String(target));
    default:
      return false;
  }
}

// ─── 引擎核心 ─────────────────────────────────────────────────────────────────

/** 描述引擎推进后需要创建的任务 */
export interface TaskAction {
  nodeKey: string;
  nodeName: string;
  nodeType: WorkflowNodeConfig['type'];
  assigneeId: number | null;
}

/** 引擎推进结果 */
export interface AdvanceResult {
  /** 流程是否结束 */
  finished: boolean;
  /** 需要创建的新任务 */
  tasksToCreate: TaskAction[];
  /** 流程当前所在节点（可能有多个，如并行网关 fork 后） */
  currentNodeKeys: string[];
}

/**
 * 从指定节点推进流程
 *
 * @param flowData  流程定义的图数据
 * @param currentNodeKey 当前完成的节点 key
 * @param formData  表单数据（用于条件判断）
 * @param completedNodeKeys 已完成的所有节点 key（用于并行网关 join 判断）
 */
export function advanceFlow(
  flowData: WorkflowFlowData,
  currentNodeKey: string,
  formData: Record<string, unknown> = {},
  completedNodeKeys: Set<string> = new Set(),
): AdvanceResult {
  const { nodeMap, outEdges, inEdges } = buildAdjacency(flowData);

  // 找到当前节点对应的 flowNode ID
  const currentFlowNode = flowData.nodes.find(n => n.data.key === currentNodeKey);
  if (!currentFlowNode) {
    return { finished: false, tasksToCreate: [], currentNodeKeys: [] };
  }

  const tasksToCreate: TaskAction[] = [];
  const currentNodeKeys: string[] = [];
  let finished = false;

  // BFS 向前推进
  const queue: string[] = [currentFlowNode.id];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const nodeType = node.data.type;

    if (nodeType === 'end') {
      finished = true;
      continue;
    }

    // 获取出边
    const outs = outEdges.get(nodeId) ?? [];
    if (outs.length === 0) continue;

    if (nodeType === 'exclusiveGateway') {
      // 排他网关：找第一个满足条件的出边，或 default 出边
      let chosenTarget: string | null = null;
      let defaultTarget: string | null = null;

      for (const { target, edge } of outs) {
        const targetNode = nodeMap.get(target);
        if (!targetNode) continue;

        if (edge.condition) {
          if (evaluateCondition(edge.condition, formData)) {
            chosenTarget = target;
            break;
          }
        }
        // 对应节点标记了 isDefault
        if (targetNode.data.isDefault) {
          defaultTarget = target;
        }
        // 没有条件的边作为 fallback default
        if (!edge.condition && !defaultTarget) {
          defaultTarget = target;
        }
      }

      const nextId = chosenTarget ?? defaultTarget;
      if (nextId) {
        const nextNode = nodeMap.get(nextId);
        if (nextNode) {
          if (nextNode.data.type === 'approve') {
            tasksToCreate.push({
              nodeKey: nextNode.data.key,
              nodeName: nextNode.data.label,
              nodeType: 'approve',
              assigneeId: nextNode.data.assigneeId ?? null,
            });
            currentNodeKeys.push(nextNode.data.key);
          } else if (nextNode.data.type === 'end') {
            finished = true;
          } else {
            // 网关后接其他网关或 ccNode，继续 BFS
            queue.push(nextId);
          }
        }
      }
    } else if (nodeType === 'parallelGateway') {
      // 并行网关：判断是 fork 还是 join
      const inCount = (inEdges.get(nodeId) ?? []).length;
      const outCount = outs.length;

      if (outCount > 1 || (outCount === 1 && inCount <= 1)) {
        // Fork：向所有出边推进
        for (const { target } of outs) {
          const nextNode = nodeMap.get(target);
          if (!nextNode) continue;

          if (nextNode.data.type === 'approve') {
            tasksToCreate.push({
              nodeKey: nextNode.data.key,
              nodeName: nextNode.data.label,
              nodeType: 'approve',
              assigneeId: nextNode.data.assigneeId ?? null,
            });
            currentNodeKeys.push(nextNode.data.key);
          } else if (nextNode.data.type === 'end') {
            finished = true;
          } else {
            queue.push(target);
          }
        }
      } else {
        // Join：检查所有入边对应的节点是否都已完成
        const inSources = inEdges.get(nodeId) ?? [];
        const allCompleted = inSources.every(srcId => {
          const srcNode = nodeMap.get(srcId);
          return srcNode ? completedNodeKeys.has(srcNode.data.key) : true;
        });

        if (allCompleted) {
          // 所有分支汇聚完成，继续推进
          for (const { target } of outs) {
            const nextNode = nodeMap.get(target);
            if (!nextNode) continue;

            if (nextNode.data.type === 'approve') {
              tasksToCreate.push({
                nodeKey: nextNode.data.key,
                nodeName: nextNode.data.label,
                nodeType: 'approve',
                assigneeId: nextNode.data.assigneeId ?? null,
              });
              currentNodeKeys.push(nextNode.data.key);
            } else if (nextNode.data.type === 'end') {
              finished = true;
            } else {
              queue.push(target);
            }
          }
        }
        // 如果未全部完成，不推进（等待其他分支完成）
      }
    } else if (nodeType === 'ccNode') {
      // 抄送节点：创建抄送任务（自动完成），继续推进
      if (node.data.assigneeIds?.length) {
        for (const ccId of node.data.assigneeIds) {
          tasksToCreate.push({
            nodeKey: node.data.key,
            nodeName: node.data.label,
            nodeType: 'ccNode',
            assigneeId: ccId,
          });
        }
      }
      // 抄送不阻塞，继续向后推进
      for (const { target } of outs) {
        queue.push(target);
      }
    } else {
      // start / approve — 已完成的节点，向后推进
      for (const { target } of outs) {
        const nextNode = nodeMap.get(target);
        if (!nextNode) continue;

        if (nextNode.data.type === 'approve') {
          tasksToCreate.push({
            nodeKey: nextNode.data.key,
            nodeName: nextNode.data.label,
            nodeType: 'approve',
            assigneeId: nextNode.data.assigneeId ?? null,
          });
          currentNodeKeys.push(nextNode.data.key);
        } else if (nextNode.data.type === 'end') {
          finished = true;
        } else {
          // 网关或 ccNode
          queue.push(target);
        }
      }
    }
  }

  return { finished, tasksToCreate, currentNodeKeys };
}

/**
 * 获取流程的第一批待执行节点（从 start 往后推进）
 */
export function getInitialTasks(
  flowData: WorkflowFlowData,
  formData: Record<string, unknown> = {},
): AdvanceResult {
  const startNode = flowData.nodes.find(n => n.data.type === 'start');
  if (!startNode) {
    return { finished: false, tasksToCreate: [], currentNodeKeys: [] };
  }
  return advanceFlow(flowData, startNode.data.key, formData, new Set(['start']));
}

/**
 * 校验流程定义的有效性
 */
export function validateFlowData(flowData: WorkflowFlowData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const startNodes = flowData.nodes.filter(n => n.data.type === 'start');
  if (startNodes.length === 0) errors.push('流程缺少开始节点');
  if (startNodes.length > 1) errors.push('流程只能有一个开始节点');

  const endNodes = flowData.nodes.filter(n => n.data.type === 'end');
  if (endNodes.length === 0) errors.push('流程缺少结束节点');

  const approveNodes = flowData.nodes.filter(n => n.data.type === 'approve');
  if (approveNodes.length === 0) errors.push('流程至少需要一个审批节点');

  // 检查排他网关出边是否配置了条件
  const { outEdges } = buildAdjacency(flowData);
  for (const node of flowData.nodes) {
    if (node.data.type === 'exclusiveGateway') {
      const outs = outEdges.get(node.id) ?? [];
      if (outs.length < 2) {
        errors.push(`排他网关"${node.data.label}"至少需要2条出边`);
      }
      // 至少一条出边需要有条件，或者有一个 default 出边
      const hasCondition = outs.some(o => o.edge.condition);
      if (!hasCondition && outs.length > 1) {
        errors.push(`排他网关"${node.data.label}"的出边需要配置条件`);
      }
    }
    if (node.data.type === 'parallelGateway') {
      const outs = outEdges.get(node.id) ?? [];
      if (outs.length === 0) {
        errors.push(`并行网关"${node.data.label}"缺少出边`);
      }
    }
  }

  // 检查所有节点是否可达
  if (startNodes.length === 1) {
    const visited = new Set<string>();
    const queue = [startNodes[0].id];
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const outs = outEdges.get(id) ?? [];
      for (const { target } of outs) {
        queue.push(target);
      }
    }
    for (const node of flowData.nodes) {
      if (!visited.has(node.id)) {
        errors.push(`节点"${node.data.label}"不可达`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── 兼容旧版线性流程的工具函数 ──────────────────────────────────────────────

/** 按拓扑顺序遍历节点（线性流程后向兼容） */
export function getNodeOrder(flowData: WorkflowFlowData): WorkflowNodeConfig[] {
  const nodeMap = new Map(flowData.nodes.map(n => [n.id, n]));
  const adjacency = new Map<string, string>();
  for (const edge of flowData.edges) {
    adjacency.set(edge.source, edge.target);
  }

  const startNode = flowData.nodes.find(n => n.data.type === 'start');
  if (!startNode) return [];

  const result: WorkflowNodeConfig[] = [];
  let currentId: string | undefined = startNode.id;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodeMap.get(currentId);
    if (!node) break;
    result.push(node.data);
    currentId = adjacency.get(currentId);
  }

  return result;
}
